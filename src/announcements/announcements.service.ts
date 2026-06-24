import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Announcement } from '../entities/announcement.entity';
import { User } from '../entities/user.entity';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { CommunitySanitizerService } from '../common/services/community-sanitizer.service';
import { S3Service } from '../common/services/s3.service';
import { EmailService } from '../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';

export interface ApiAnnouncementAuthor {
  id: string;
  name: string;
  avatarUrl: string | null;
  position: string | null;
}

export interface ApiAnnouncementAttachment {
  url: string;
  name: string | null;
}

export interface ApiAnnouncement {
  id: string;
  title: string;
  body: string | null;
  bodyHtml: string | null;
  attachments: ApiAnnouncementAttachment[];
  pinned: boolean;
  author: ApiAnnouncementAuthor | null;
  createdAt: Date;
  updatedAt: Date;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(
    @InjectRepository(Announcement)
    private readonly announcementRepo: Repository<Announcement>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly sanitizer: CommunitySanitizerService,
    private readonly s3Service: S3Service,
    private readonly emailService: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Everyone: pinned first, then newest. */
  async findAll(): Promise<ApiAnnouncement[]> {
    const rows = await this.announcementRepo.find({
      relations: { author: true },
      order: { pinned: 'DESC', createdAt: 'DESC' },
    });
    return this.mapMany(rows);
  }

  async findOne(id: string): Promise<ApiAnnouncement> {
    const row = await this.announcementRepo.findOne({
      where: { id },
      relations: { author: true },
    });
    if (!row) throw new NotFoundException('Announcement not found');
    return this.mapOne(row);
  }

  /** Admin / HR only (enforced at the controller). */
  async create(
    user: User,
    dto: CreateAnnouncementDto,
  ): Promise<ApiAnnouncement> {
    const bodyHtml = this.sanitizer.sanitize(dto.bodyHtml);
    const body = dto.body?.trim() || this.sanitizer.toPlainText(bodyHtml);

    const saved = await this.announcementRepo.save(
      this.announcementRepo.create({
        authorId: user.id,
        title: dto.title.trim(),
        body: body || null,
        bodyHtml: bodyHtml || null,
        attachments: this.normalizeAttachments(dto.attachments),
        pinned: dto.pinned ?? false,
      }),
    );
    const created = await this.findOne(saved.id);

    // Best-effort fan-out (in-app bell + email). Never block/fail the request.
    void this.notifyNewAnnouncement(created, user);

    return created;
  }

  /**
   * Fan out a new announcement to every active employee: a persistent in-app
   * notification (bell + SSE) and an email. Best-effort — failures are logged,
   * never thrown, so a notification hiccup can't fail the create request.
   */
  private async notifyNewAnnouncement(
    announcement: ApiAnnouncement,
    author: User,
  ): Promise<void> {
    let users: { id: string; email: string }[] = [];
    try {
      users = await this.userRepo.find({
        where: { isActive: true },
        select: { id: true, email: true },
      });
    } catch (err) {
      this.logger.warn(`Announcement recipient lookup failed: ${errMsg(err)}`);
      return;
    }

    // In-app notifications — one per active user, excluding the author.
    await Promise.all(
      users
        .filter((u) => u.id !== author.id)
        .map((u) =>
          this.notifications
            .create(u.id, {
              title: 'New announcement',
              message: announcement.title,
              type: NotificationType.INFO,
              metadata: { deeplink: '/announcement', announcementId: announcement.id },
            })
            .catch((err) =>
              this.logger.warn(`Announcement in-app notify failed for ${u.id}: ${errMsg(err)}`),
            ),
        ),
    );

    // Email (BCC, batched).
    try {
      const recipients = users
        .map((u) => u.email)
        .filter((e): e is string => !!e);
      if (recipients.length === 0) return;

      await this.emailService.sendAnnouncementEmail({
        recipients,
        title: announcement.title,
        excerpt: announcement.body ?? '',
        authorName: author.fullName,
        createdAt: announcement.createdAt,
      });
    } catch (err) {
      this.logger.warn(`Announcement email fan-out failed: ${errMsg(err)}`);
    }
  }

  async update(
    id: string,
    dto: UpdateAnnouncementDto,
  ): Promise<ApiAnnouncement> {
    const row = await this.announcementRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Announcement not found');

    if (dto.title !== undefined) row.title = dto.title.trim();
    if (dto.bodyHtml !== undefined) {
      const bodyHtml = this.sanitizer.sanitize(dto.bodyHtml);
      row.bodyHtml = bodyHtml || null;
      row.body = (dto.body?.trim() || this.sanitizer.toPlainText(bodyHtml)) || null;
    } else if (dto.body !== undefined) {
      row.body = dto.body?.trim() || null;
    }
    if (dto.attachments !== undefined) {
      row.attachments = this.normalizeAttachments(dto.attachments);
    }
    if (dto.pinned !== undefined) row.pinned = dto.pinned;

    await this.announcementRepo.save(row);
    return this.findOne(id);
  }

  async remove(id: string): Promise<{ success: true }> {
    const result = await this.announcementRepo.delete(id);
    if (!result.affected) throw new NotFoundException('Announcement not found');
    return { success: true };
  }

  // ─── Mapping ────────────────────────────────────────────────────────────────

  private normalizeAttachments(
    input?: { url: string; name?: string }[],
  ): { url: string; name: string | null }[] {
    return (input ?? [])
      .filter((a) => a?.url)
      .map((a) => ({ url: a.url, name: a.name ?? null }));
  }

  private async mapMany(rows: Announcement[]): Promise<ApiAnnouncement[]> {
    const mapped = rows.map((row) => this.toApi(row));
    await Promise.all([
      this.resolveAvatarUrls(mapped),
      this.resolveAttachmentUrls(mapped),
    ]);
    return mapped;
  }

  private async mapOne(row: Announcement): Promise<ApiAnnouncement> {
    const [mapped] = await this.mapMany([row]);
    return mapped;
  }

  private toApi(row: Announcement): ApiAnnouncement {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      bodyHtml: row.bodyHtml,
      attachments: (row.attachments ?? []).map((a) => ({ url: a.url, name: a.name })),
      pinned: row.pinned,
      author: row.author
        ? {
            id: row.author.id,
            name: row.author.fullName,
            avatarUrl: row.author.profilePicture ?? null,
            position: row.author.position ?? null,
          }
        : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Author avatars are stored as S3 keys — swap each for a short-lived presigned
   * GET URL (already-resolved http(s) values are left untouched). Deduped so each
   * key is signed only once.
   */
  private async resolveAvatarUrls(items: ApiAnnouncement[]): Promise<void> {
    const needsResolving = (url: string | null): url is string =>
      !!url && !url.startsWith('http');

    const keys = [
      ...new Set(
        items
          .map((a) => a.author?.avatarUrl ?? null)
          .filter(needsResolving),
      ),
    ];
    if (keys.length === 0) return;

    const signed = await Promise.all(
      keys.map((key) => this.s3Service.getPresignedDownloadUrl(key, 900)),
    );
    const urlByKey = new Map(keys.map((key, i) => [key, signed[i]]));

    for (const a of items) {
      if (a.author && needsResolving(a.author.avatarUrl)) {
        a.author.avatarUrl = urlByKey.get(a.author.avatarUrl) ?? a.author.avatarUrl;
      }
    }
  }

  /**
   * Attachments are stored as canonical S3 URLs on a private bucket; swap each
   * for a short-lived presigned GET URL. Non-bucket URLs are left untouched.
   * Keys are deduped so each object is signed once per response.
   */
  private async resolveAttachmentUrls(items: ApiAnnouncement[]): Promise<void> {
    const attachments = items.flatMap((a) => a.attachments ?? []);
    const keyByAttachment = new Map<ApiAnnouncementAttachment, string>();
    for (const att of attachments) {
      const key = this.s3Service.extractObjectKey(att.url);
      if (key) keyByAttachment.set(att, key);
    }

    const keys = [...new Set(keyByAttachment.values())];
    if (keys.length === 0) return;

    const signed = await Promise.all(
      keys.map((key) => this.s3Service.getPresignedDownloadUrl(key, 900)),
    );
    const urlByKey = new Map(keys.map((key, i) => [key, signed[i]]));

    for (const att of attachments) {
      const key = keyByAttachment.get(att);
      if (key) att.url = urlByKey.get(key) ?? att.url;
    }
  }
}
