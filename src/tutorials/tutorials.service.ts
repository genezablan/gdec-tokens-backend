import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, Repository } from 'typeorm';
import { Tutorial } from '../entities/tutorial.entity';
import { User } from '../entities/user.entity';
import { S3Service } from '../common/services/s3.service';
import { EmailService } from '../common/services/email.service';
import { CreateTutorialDto } from './dto/create-tutorial.dto';
import { UpdateTutorialDto } from './dto/update-tutorial.dto';

/** How long pre-signed playback/thumbnail URLs stay valid (2 hours). */
const PRESIGNED_URL_TTL_SECONDS = 7200;

const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Largest tutorial video we accept (1 GB). Keep in sync with the frontend. */
export const MAX_VIDEO_UPLOAD_BYTES = 1024 * 1024 * 1024;
/** Largest tutorial thumbnail we accept (5 MB). */
export const MAX_THUMBNAIL_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * How long an upload's pre-signed PUT URL stays valid. The signature has to
 * outlive the whole transfer, so videos get an hour — enough for 1 GB on a
 * ~2.5 Mbps uplink. Thumbnails are small, so 5 minutes is plenty.
 */
const UPLOAD_URL_TTL_SECONDS = { video: 3600, thumbnail: 300 } as const;

/** "1 GB" / "5 MB" — for size-limit error messages. */
const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024 * 1024
    ? `${bytes / 1024 / 1024 / 1024} GB`
    : `${bytes / 1024 / 1024} MB`;

export interface TutorialResponse {
  id: string;
  title: string;
  category: string;
  description: string | null;
  durationSeconds: number | null;
  displayOrder: number;
  isActive: boolean;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Default tutorials shown in the Video Guide. The video & thumbnail files must be uploaded
 * to S3 (via the admin upload endpoints, or out-of-band) under these keys; the API only reads them.
 */
const SEED_TUTORIALS: Array<Partial<Tutorial>> = [
  {
    title: 'Getting Started: Understanding Development Options',
    category: 'Quick Start Tutorials',
    videoKey: 'tutorials/getting-started-development-options/video.mp4',
    thumbnailKey: 'tutorials/getting-started-development-options/thumbnail.jpg',
    durationSeconds: 572,
    displayOrder: 1,
  },
  {
    title: 'Getting Started: Learn About the Learning Development Program',
    category: 'How Token Works',
    videoKey: 'tutorials/learning-development-program/video.mp4',
    thumbnailKey: 'tutorials/learning-development-program/thumbnail.jpg',
    durationSeconds: 572,
    displayOrder: 2,
  },
  {
    title: 'Development Program: Submit requests with ease.',
    category: 'Request Guide',
    videoKey: 'tutorials/submit-requests/video.mp4',
    thumbnailKey: 'tutorials/submit-requests/thumbnail.jpg',
    durationSeconds: 572,
    displayOrder: 3,
  },
];

@Injectable()
export class TutorialsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TutorialsService.name);

  constructor(
    @InjectRepository(Tutorial)
    private readonly tutorialRepository: Repository<Tutorial>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly s3Service: S3Service,
    private readonly emailService: EmailService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seed();
  }

  /**
   * Returns tutorials ordered by displayOrder.
   * Public consumers (activeOnly=true) only see active tutorials that have a video uploaded.
   * Admins (activeOnly=false) see every tutorial, including drafts without a video yet.
   */
  async findAll(activeOnly = true): Promise<TutorialResponse[]> {
    const where = activeOnly ? { isActive: true, videoKey: Not(IsNull()) } : {};
    const tutorials = await this.tutorialRepository.find({
      where,
      order: { displayOrder: 'ASC' },
    });
    return Promise.all(tutorials.map((t) => this.toResponse(t)));
  }

  /**
   * Returns a single tutorial by ID.
   */
  async findOne(id: string): Promise<TutorialResponse> {
    const tutorial = await this.getEntity(id);
    return this.toResponse(tutorial);
  }

  /**
   * Admin: create a tutorial record. The video/thumbnail are uploaded separately
   * via the presigned-upload + save endpoints.
   */
  async create(dto: CreateTutorialDto): Promise<TutorialResponse> {
    const tutorial = this.tutorialRepository.create(dto);
    const saved = await this.tutorialRepository.save(tutorial);
    this.logger.log(`Created tutorial: ${saved.title}`);
    return this.toResponse(saved);
  }

  /**
   * Admin: update title, category, description, durationSeconds, displayOrder, or isActive.
   */
  async update(id: string, dto: UpdateTutorialDto): Promise<TutorialResponse> {
    const tutorial = await this.getEntity(id);
    const wasVisible = this.isPubliclyVisible(tutorial);
    Object.assign(tutorial, dto);
    const saved = await this.tutorialRepository.save(tutorial);
    if (!wasVisible && this.isPubliclyVisible(saved)) {
      this.notifyPublished(saved).catch(() => {});
    }
    return this.toResponse(saved);
  }

  /**
   * Admin: delete a tutorial.
   */
  async remove(id: string): Promise<{ deleted: true }> {
    const tutorial = await this.getEntity(id);
    await this.tutorialRepository.remove(tutorial);
    this.logger.log(`Deleted tutorial: ${tutorial.title}`);
    return { deleted: true };
  }

  /**
   * Admin: get a presigned PUT URL for uploading a video or thumbnail directly from the browser.
   */
  async getAssetPresignedUpload(
    id: string,
    assetType: 'video' | 'thumbnail',
    fileName: string,
    contentType: string,
    fileSize?: number,
  ): Promise<{ uploadUrl: string; fileUrl: string; key: string }> {
    await this.getEntity(id);

    const allowed = assetType === 'video' ? VIDEO_MIME_TYPES : IMAGE_MIME_TYPES;
    if (!allowed.includes(contentType)) {
      throw new BadRequestException(
        `Invalid ${assetType} file type. Allowed: ${allowed.join(', ')}`,
      );
    }

    // fileSize is the size the client declares. Optional for backwards
    // compatibility, but when sent it lets us reject an oversized upload before
    // handing out a signature rather than after the bytes are already in S3.
    const maxBytes =
      assetType === 'video'
        ? MAX_VIDEO_UPLOAD_BYTES
        : MAX_THUMBNAIL_UPLOAD_BYTES;
    if (fileSize !== undefined && fileSize > maxBytes) {
      throw new BadRequestException(
        `${assetType === 'video' ? 'Video' : 'Thumbnail'} exceeds the ${formatBytes(maxBytes)} limit.`,
      );
    }

    return this.s3Service.generateTutorialAssetPresignedUploadUrl(
      id,
      assetType,
      fileName,
      contentType,
      UPLOAD_URL_TTL_SECONDS[assetType],
    );
  }

  /**
   * Admin: save the video S3 key after the browser has uploaded it directly to S3.
   */
  async saveVideo(id: string, key: string): Promise<TutorialResponse> {
    const tutorial = await this.getEntity(id);
    const wasVisible = this.isPubliclyVisible(tutorial);
    tutorial.videoKey = key;
    const saved = await this.tutorialRepository.save(tutorial);
    if (!wasVisible && this.isPubliclyVisible(saved)) {
      this.notifyPublished(saved).catch(() => {});
    }
    return this.toResponse(saved);
  }

  /**
   * Admin: save the thumbnail S3 key after the browser has uploaded it directly to S3.
   */
  async saveThumbnail(id: string, key: string): Promise<TutorialResponse> {
    const tutorial = await this.getEntity(id);
    tutorial.thumbnailKey = key;
    const saved = await this.tutorialRepository.save(tutorial);
    return this.toResponse(saved);
  }

  /**
   * Loads the raw entity or throws 404.
   */
  private async getEntity(id: string): Promise<Tutorial> {
    const tutorial = await this.tutorialRepository.findOne({ where: { id } });
    if (!tutorial) {
      throw new NotFoundException('Tutorial not found');
    }
    return tutorial;
  }

  /** A tutorial is visible to employees once it's active AND has a video uploaded. */
  private isPubliclyVisible(tutorial: Tutorial): boolean {
    return tutorial.isActive && !!tutorial.videoKey;
  }

  /**
   * Fan out an email to every active employee the first time a tutorial
   * becomes publicly visible. Best-effort — failures are logged, never thrown.
   */
  private async notifyPublished(tutorial: Tutorial): Promise<void> {
    try {
      const users = await this.userRepository.find({
        where: { isActive: true },
        select: { email: true },
      });
      const recipients = users.map((u) => u.email).filter((e): e is string => !!e);
      if (recipients.length === 0) return;

      await this.emailService.sendTutorialPublishedEmail({
        recipients,
        title: tutorial.title,
        excerpt: tutorial.description ?? tutorial.title,
      });
    } catch (err) {
      this.logger.warn(`Tutorial publish email fan-out failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Maps an entity to the API response, swapping S3 keys for renderable URLs.
   * `tutorials/` is public, so these come back permanent and unsigned — a long
   * video can no longer have its URL expire mid-playback.
   */
  private async toResponse(tutorial: Tutorial): Promise<TutorialResponse> {
    const [videoUrl, thumbnailUrl] = await Promise.all([
      tutorial.videoKey
        ? this.s3Service.resolveObjectUrl(
            tutorial.videoKey,
            PRESIGNED_URL_TTL_SECONDS,
          )
        : Promise.resolve(null),
      tutorial.thumbnailKey
        ? this.s3Service.resolveObjectUrl(
            tutorial.thumbnailKey,
            PRESIGNED_URL_TTL_SECONDS,
          )
        : Promise.resolve(null),
    ]);

    return {
      id: tutorial.id,
      title: tutorial.title,
      category: tutorial.category,
      description: tutorial.description ?? null,
      durationSeconds: tutorial.durationSeconds ?? null,
      displayOrder: tutorial.displayOrder,
      isActive: tutorial.isActive,
      videoUrl,
      thumbnailUrl,
      createdAt: tutorial.createdAt,
      updatedAt: tutorial.updatedAt,
    };
  }

  /**
   * Seeds the default Video Guide tutorials if they don't exist.
   * Idempotent: a tutorial is matched by its title.
   */
  async seed(): Promise<void> {
    for (const data of SEED_TUTORIALS) {
      const exists = await this.tutorialRepository.findOne({
        where: { title: data.title },
      });
      if (exists) {
        continue;
      }
      await this.tutorialRepository.save(this.tutorialRepository.create(data));
      this.logger.log(`Seeded tutorial: ${data.title}`);
    }
  }
}
