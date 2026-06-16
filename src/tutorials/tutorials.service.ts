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
import { S3Service } from '../common/services/s3.service';
import { CreateTutorialDto } from './dto/create-tutorial.dto';
import { UpdateTutorialDto } from './dto/update-tutorial.dto';

/** How long pre-signed playback/thumbnail URLs stay valid (2 hours). */
const PRESIGNED_URL_TTL_SECONDS = 7200;

const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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
    private readonly s3Service: S3Service,
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
    Object.assign(tutorial, dto);
    const saved = await this.tutorialRepository.save(tutorial);
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
  ): Promise<{ uploadUrl: string; fileUrl: string; key: string }> {
    await this.getEntity(id);

    const allowed = assetType === 'video' ? VIDEO_MIME_TYPES : IMAGE_MIME_TYPES;
    if (!allowed.includes(contentType)) {
      throw new BadRequestException(
        `Invalid ${assetType} file type. Allowed: ${allowed.join(', ')}`,
      );
    }

    return this.s3Service.generateTutorialAssetPresignedUploadUrl(
      id,
      assetType,
      fileName,
      contentType,
    );
  }

  /**
   * Admin: save the video S3 key after the browser has uploaded it directly to S3.
   */
  async saveVideo(id: string, key: string): Promise<TutorialResponse> {
    const tutorial = await this.getEntity(id);
    tutorial.videoKey = key;
    const saved = await this.tutorialRepository.save(tutorial);
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

  /**
   * Maps an entity to the API response, swapping S3 keys for short-lived pre-signed URLs.
   */
  private async toResponse(tutorial: Tutorial): Promise<TutorialResponse> {
    const [videoUrl, thumbnailUrl] = await Promise.all([
      tutorial.videoKey
        ? this.s3Service.getPresignedDownloadUrl(
            tutorial.videoKey,
            PRESIGNED_URL_TTL_SECONDS,
          )
        : Promise.resolve(null),
      tutorial.thumbnailKey
        ? this.s3Service.getPresignedDownloadUrl(
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
