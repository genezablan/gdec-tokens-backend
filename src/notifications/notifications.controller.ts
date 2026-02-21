import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Sse,
  MessageEvent,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Response } from 'express';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../entities/user.entity';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /notifications/stream
   * SSE endpoint — browser holds this connection open and receives push events.
   * Each event is JSON: { type: 'notification', notification: {...} }
   *                  or { type: 'init', notifications: [...] }  (on connect)
   */
  @Sse('stream')
  stream(
    @CurrentUser() user: User,
    @Res() res: Response,
  ): Observable<MessageEvent> {
    // Keep SSE connection alive through proxies / CloudFront
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    return this.notificationsService.getStream(user.id);
  }

  /**
   * GET /notifications
   * Last 50 notifications for the current user (newest first).
   */
  @Get()
  findAll(@CurrentUser() user: User) {
    return this.notificationsService.findAll(user.id);
  }

  /**
   * GET /notifications/unread-count
   * Badge count for the bell icon.
   */
  @Get('unread-count')
  unreadCount(@CurrentUser() user: User) {
    return this.notificationsService.unreadCount(user.id);
  }

  /**
   * PATCH /notifications/:id/read
   * Mark a single notification as read.
   */
  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.notificationsService.markRead(id, user.id);
  }

  /**
   * PATCH /notifications/read-all
   * Mark all notifications as read.
   */
  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: User) {
    return this.notificationsService.markAllRead(user.id);
  }

  /**
   * DELETE /notifications/:id
   * Dismiss (delete) a notification.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.notificationsService.remove(id, user.id);
  }
}
