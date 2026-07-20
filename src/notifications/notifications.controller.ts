import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
   *
   * Written by hand instead of using Nest's @Sse() decorator: combined with
   * the app's global ClassSerializerInterceptor, @Sse() throws "Cannot set
   * headers after they are sent to the client" on every single event — a
   * structural incompatibility between Nest's SSE response handling and its
   * interceptor pipeline (reproduced even with a no-op interceptor, so it's
   * not about what the interceptor does, just that one is registered at all).
   * Writing the stream directly sidesteps that machinery entirely.
   */
  @Get('stream')
  stream(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // keep alive through proxies / CloudFront
    res.flushHeaders();

    const subscription = this.notificationsService.getStream(user.id).subscribe({
      next: (event) => res.write(`data: ${JSON.stringify(event.data)}\n\n`),
    });

    req.on('close', () => subscription.unsubscribe());
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
