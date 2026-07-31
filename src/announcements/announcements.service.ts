import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Announcement } from '../entities/announcement.entity';
import { AnnouncementRead } from '../entities/announcement-read.entity';
import { AnnouncementAcknowledgement } from '../entities/announcement-acknowledgement.entity';
import { AnnouncementReaction } from '../entities/announcement-reaction.entity';
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

export interface ApiAnnouncementReaction {
  emoji: string;
  count: number;
  /** Whether the requesting user is one of the reactors. */
  mine: boolean;
}

export interface ApiAnnouncementViewer {
  id: string;
  name: string;
  avatarUrl: string | null;
  position: string | null;
  readAt: Date;
  acknowledgedAt: Date | null;
}

export interface ApiAnnouncementViewers {
  /** Everyone who could see it — the denominator for "N of M have read this". */
  totalAudience: number;
  totalViewers: number;
  totalAcknowledged: number;
  requiresAcknowledgement: boolean;
  viewers: ApiAnnouncementViewer[];
}

export interface ApiAnnouncement {
  id: string;
  title: string;
  body: string | null;
  bodyHtml: string | null;
  attachments: ApiAnnouncementAttachment[];
  pinned: boolean;
  category: string | null;
  requiresAcknowledgement: boolean;
  /** Per-viewer state — false for both when the request isn't user-scoped. */
  isRead: boolean;
  isAcknowledged: boolean;
  /** Aggregated reactions, most-used first. Empty when nobody has reacted. */
  reactions: ApiAnnouncementReaction[];
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
    @InjectRepository(AnnouncementRead)
    private readonly readRepo: Repository<AnnouncementRead>,
    @InjectRepository(AnnouncementAcknowledgement)
    private readonly ackRepo: Repository<AnnouncementAcknowledgement>,
    @InjectRepository(AnnouncementReaction)
    private readonly reactionRepo: Repository<AnnouncementReaction>,
    private readonly sanitizer: CommunitySanitizerService,
    private readonly s3Service: S3Service,
    private readonly emailService: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Everyone: pinned first, then newest. Pass `viewerId` to have each item
   * carry that user's read / acknowledged state — resolved in two set queries
   * rather than a join per row.
   */
  async findAll(viewerId?: string): Promise<ApiAnnouncement[]> {
    const rows = await this.announcementRepo.find({
      relations: { author: true },
      order: { pinned: 'DESC', createdAt: 'DESC' },
    });
    const mapped = await this.mapMany(rows);
    await this.applyViewerState(mapped, viewerId);
    return mapped;
  }

  async findOne(id: string, viewerId?: string): Promise<ApiAnnouncement> {
    const row = await this.announcementRepo.findOne({
      where: { id },
      relations: { author: true },
    });
    if (!row) throw new NotFoundException('Announcement not found');
    const mapped = await this.mapOne(row);
    await this.applyViewerState([mapped], viewerId);
    return mapped;
  }

  /**
   * Stamp each item with whether this viewer has read / acknowledged it.
   * Two queries for the whole page regardless of length — the alternative
   * (a correlated subquery per announcement) scales badly with the board.
   */
  private async applyViewerState(
    items: ApiAnnouncement[],
    viewerId?: string,
  ): Promise<void> {
    if (!viewerId || items.length === 0) return;
    const ids = items.map((a) => a.id);

    const [reads, acks] = await Promise.all([
      this.readRepo.find({
        where: { userId: viewerId, announcementId: In(ids) },
        select: { announcementId: true },
      }),
      this.ackRepo.find({
        where: { userId: viewerId, announcementId: In(ids) },
        select: { announcementId: true },
      }),
    ]);

    const readIds = new Set(reads.map((r) => r.announcementId));
    const ackIds = new Set(acks.map((r) => r.announcementId));
    for (const a of items) {
      a.isRead = readIds.has(a.id);
      a.isAcknowledged = ackIds.has(a.id);
    }

    await this.applyReactions(items, viewerId);
  }

  /**
   * Attach aggregated reaction counts, flagging the ones this viewer made.
   *
   * Grouped in SQL rather than by loading every reaction row — the count is all
   * the UI needs, and a popular announcement shouldn't drag its whole reaction
   * list across the wire to produce a number.
   */
  private async applyReactions(
    items: ApiAnnouncement[],
    viewerId: string,
  ): Promise<void> {
    const ids = items.map((a) => a.id);

    const [counts, mine] = await Promise.all([
      this.reactionRepo
        .createQueryBuilder('r')
        .select('r.announcementId', 'announcementId')
        .addSelect('r.emoji', 'emoji')
        .addSelect('COUNT(*)', 'count')
        .where('r.announcementId IN (:...ids)', { ids })
        .groupBy('r.announcementId')
        .addGroupBy('r.emoji')
        .getRawMany<{ announcementId: string; emoji: string; count: string }>(),
      this.reactionRepo.find({
        where: { userId: viewerId, announcementId: In(ids) },
        select: { announcementId: true, emoji: true },
      }),
    ]);

    const mineKeys = new Set(mine.map((r) => `${r.announcementId}:${r.emoji}`));
    const byAnnouncement = new Map<string, ApiAnnouncementReaction[]>();
    for (const row of counts) {
      const list = byAnnouncement.get(row.announcementId) ?? [];
      list.push({
        emoji: row.emoji,
        count: Number(row.count),
        mine: mineKeys.has(`${row.announcementId}:${row.emoji}`),
      });
      byAnnouncement.set(row.announcementId, list);
    }

    for (const a of items) {
      a.reactions = (byAnnouncement.get(a.id) ?? []).sort(
        (x, y) => y.count - x.count || x.emoji.localeCompare(y.emoji),
      );
    }
  }

  /**
   * Add or remove the viewer's reaction with this emoji — the same call does
   * both, since tapping an emoji you've already used means "undo".
   */
  async toggleReaction(
    id: string,
    userId: string,
    emoji: string,
  ): Promise<ApiAnnouncement> {
    const exists = await this.announcementRepo.exists({ where: { id } });
    if (!exists) throw new NotFoundException('Announcement not found');

    const trimmed = emoji.trim();
    if (!trimmed) throw new BadRequestException('An emoji is required');

    const existing = await this.reactionRepo.findOne({
      where: { announcementId: id, userId, emoji: trimmed },
    });

    if (existing) {
      await this.reactionRepo.delete({
        announcementId: id,
        userId,
        emoji: trimmed,
      });
    } else {
      await this.reactionRepo
        .createQueryBuilder()
        .insert()
        .values({ announcementId: id, userId, emoji: trimmed })
        .orIgnore()
        .execute();
    }

    return this.findOne(id, userId);
  }

  /**
   * Who has read an announcement — Admin / HR only (enforced at the controller).
   *
   * `totalAudience` counts active users so the UI can say "12 of 40", which is
   * the number that actually matters for a policy that had to reach everyone.
   * Ordered by most recent read first.
   */
  async findViewers(id: string): Promise<ApiAnnouncementViewers> {
    const announcement = await this.announcementRepo.findOne({ where: { id } });
    if (!announcement) throw new NotFoundException('Announcement not found');

    const [reads, acks, totalAudience] = await Promise.all([
      this.readRepo.find({
        where: { announcementId: id },
        relations: { user: true },
        order: { readAt: 'DESC' },
      }),
      this.ackRepo.find({ where: { announcementId: id } }),
      this.userRepo.count({ where: { isActive: true } }),
    ]);

    const ackAt = new Map(acks.map((a) => [a.userId, a.acknowledgedAt]));

    const viewers: ApiAnnouncementViewer[] = reads
      .filter((r) => r.user)
      .map((r) => ({
        id: r.user.id,
        name: r.user.fullName,
        avatarUrl: r.user.profilePicture ?? null,
        position: r.user.position ?? null,
        readAt: r.readAt,
        acknowledgedAt: ackAt.get(r.userId) ?? null,
      }));

    await this.resolveViewerAvatars(viewers);

    return {
      totalAudience,
      totalViewers: viewers.length,
      totalAcknowledged: acks.length,
      requiresAcknowledgement: announcement.requiresAcknowledgement,
      viewers,
    };
  }

  /** Same presign-and-dedupe treatment the author avatars get. */
  private async resolveViewerAvatars(
    viewers: ApiAnnouncementViewer[],
  ): Promise<void> {
    const needsResolving = (url: string | null): url is string =>
      !!url && !url.startsWith('http');

    const keys = [
      ...new Set(viewers.map((v) => v.avatarUrl).filter(needsResolving)),
    ];
    if (keys.length === 0) return;

    const signed = await Promise.all(
      keys.map((key) => this.s3Service.getPresignedDownloadUrl(key, 900)),
    );
    const urlByKey = new Map(keys.map((key, i) => [key, signed[i]]));

    for (const v of viewers) {
      if (needsResolving(v.avatarUrl)) {
        v.avatarUrl = urlByKey.get(v.avatarUrl) ?? v.avatarUrl;
      }
    }
  }

  /**
   * Mark an announcement read for this user. Idempotent — re-opening something
   * already read is a no-op rather than an error or a moved timestamp.
   */
  async markRead(id: string, userId: string): Promise<{ success: true }> {
    const exists = await this.announcementRepo.exists({ where: { id } });
    if (!exists) throw new NotFoundException('Announcement not found');

    await this.readRepo
      .createQueryBuilder()
      .insert()
      .values({ announcementId: id, userId })
      .orIgnore() // ON CONFLICT DO NOTHING — the composite PK is the guard
      .execute();

    return { success: true };
  }

  /**
   * Record an explicit acknowledgement. Also marks the announcement read: you
   * cannot acknowledge something without having opened it, and leaving it unread
   * would be contradictory.
   */
  async acknowledge(id: string, userId: string): Promise<ApiAnnouncement> {
    const row = await this.announcementRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Announcement not found');
    if (!row.requiresAcknowledgement) {
      throw new BadRequestException(
        'This announcement does not require acknowledgement',
      );
    }

    await this.ackRepo
      .createQueryBuilder()
      .insert()
      .values({ announcementId: id, userId })
      .orIgnore()
      .execute();
    await this.markRead(id, userId);

    return this.findOne(id, userId);
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
        category: dto.category?.trim() || null,
        requiresAcknowledgement: dto.requiresAcknowledgement ?? false,
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
              metadata: { deeplink: `/announcement/${announcement.id}`, announcementId: announcement.id },
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
        announcementId: announcement.id,
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
    if (dto.category !== undefined) row.category = dto.category?.trim() || null;
    if (dto.requiresAcknowledgement !== undefined) {
      row.requiresAcknowledgement = dto.requiresAcknowledgement;
    }

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
      category: row.category ?? null,
      requiresAcknowledgement: row.requiresAcknowledgement ?? false,
      // Overwritten by applyViewerState when the request is user-scoped.
      isRead: false,
      isAcknowledged: false,
      reactions: [],
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
