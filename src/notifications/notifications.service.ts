import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subject, Observable, finalize } from 'rxjs';
import { MessageEvent } from '@nestjs/common';
import { Notification, NotificationType } from '../entities/notification.entity';

export interface CreateNotificationDto {
  title: string;
  message: string;
  type?: NotificationType;
  requestId?: string;
  /** Optional metadata. Use `deeplink` key for the frontend path the CTA should navigate to. */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  // One Set of Subjects per userId — supports multiple browser tabs
  private readonly streams = new Map<string, Set<Subject<MessageEvent>>>();

  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  // ─── SSE stream ─────────────────────────────────────────────────────────────

  /**
   * Returns an SSE Observable for the given user.
   * Replays the last 10 unread notifications on connect, then pushes live events.
   */
  getStream(userId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();

    if (!this.streams.has(userId)) {
      this.streams.set(userId, new Set());
    }
    this.streams.get(userId)!.add(subject);
    this.logger.log(`SSE connected: ${userId} (${this.streams.get(userId)!.size} connections)`);

    // Send recent unread notifications on connect so the client is immediately up to date
    this.findUnread(userId).then((notifications) => {
      if (notifications.length > 0) {
        subject.next({ data: { type: 'init', notifications } } as MessageEvent);
      }
    });

    return subject.asObservable().pipe(
      finalize(() => {
        const set = this.streams.get(userId);
        if (set) {
          set.delete(subject);
          if (set.size === 0) this.streams.delete(userId);
        }
        this.logger.log(`SSE disconnected: ${userId}`);
      }),
    );
  }

  // ─── Ephemeral push (no persistence) ─────────────────────────────────────────

  /**
   * Push a live event to a user's open SSE connections WITHOUT persisting a
   * notification. Used for real-time UI updates (new post / comment / reaction)
   * that should not become bell entries. No-op if the user isn't connected.
   */
  pushEvent(userId: string, data: Record<string, unknown>): void {
    const set = this.streams.get(userId);
    if (!set) return;
    const event = { data } as MessageEvent;
    set.forEach((subject) => subject.next(event));
  }

  /** Push the same live event to many users (deduplicated). */
  pushEventToMany(userIds: string[], data: Record<string, unknown>): void {
    for (const userId of new Set(userIds)) this.pushEvent(userId, data);
  }

  // ─── Create ─────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateNotificationDto): Promise<Notification> {
    const notification = await this.repo.save(
      this.repo.create({
        userId,
        title: dto.title,
        message: dto.message,
        type: dto.type ?? NotificationType.INFO,
        requestId: dto.requestId,
        metadata: dto.metadata,
      }),
    );

    // Push to all active SSE connections for this user
    const set = this.streams.get(userId);
    if (set) {
      const event: MessageEvent = { data: { type: 'notification', notification } } as MessageEvent;
      set.forEach((subject) => subject.next(event));
    }

    return notification;
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  findAll(userId: string): Promise<Notification[]> {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  findUnread(userId: string): Promise<Notification[]> {
    return this.repo.find({
      where: { userId, isRead: false },
      order: { createdAt: 'DESC' },
      take: 10,
    });
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.repo.count({ where: { userId, isRead: false } });
    return { count };
  }

  // ─── Mutations ──────────────────────────────────────────────────────────────

  async markRead(notificationId: string, userId: string): Promise<Notification> {
    const notification = await this.repo.findOne({
      where: { id: notificationId, userId },
    });
    if (!notification) throw new Error('Notification not found');
    notification.isRead = true;
    return this.repo.save(notification);
  }

  async markAllRead(userId: string): Promise<void> {
    await this.repo.update({ userId, isRead: false }, { isRead: true });
  }

  async remove(notificationId: string, userId: string): Promise<void> {
    await this.repo.delete({ id: notificationId, userId });
  }

  /**
   * Delete the notifications a since-reversed action generated, so the bell
   * doesn't keep showing an outcome that no longer holds (e.g. "Request
   * Approved 🎉" after the approver undid the approval).
   *
   * Matched by title rather than by a `createdAt` cutoff on purpose: `createdAt`
   * is written by the database (`@CreateDateColumn`) while the decision timestamp
   * it would be compared against is written by the application, so any clock
   * drift between the two silently matches nothing. Callers pass the titles from
   * shared constants, so the create and delete sides can't drift apart.
   *
   * Returns the number deleted.
   */
  async deleteForRequestByTitles(
    requestId: string,
    userIds: string[],
    titles: string[],
  ): Promise<number> {
    if (userIds.length === 0 || titles.length === 0) return 0;

    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where('"requestId" = :requestId', { requestId })
      .andWhere('"userId" IN (:...userIds)', { userIds: [...new Set(userIds)] })
      .andWhere('title IN (:...titles)', { titles })
      .execute();

    return result.affected ?? 0;
  }
}
