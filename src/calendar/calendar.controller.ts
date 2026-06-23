import { Controller, Get, Delete, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CalendarService } from './calendar.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { User } from '../entities/user.entity';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  /**
   * GET /calendar/connect
   * Returns the Microsoft authorize URL for the current coach to connect their
   * Outlook calendar. The frontend redirects the browser to this URL.
   */
  @Get('connect')
  getConnectUrl(@CurrentUser() user: User) {
    return { url: this.calendarService.buildAuthorizeUrl(user.id) };
  }

  /**
   * GET /calendar/microsoft/callback
   * OAuth redirect target hit by Microsoft (no app session — identity is carried
   * in the signed `state`). Exchanges the code, stores tokens, then redirects
   * back to the frontend.
   */
  @Public()
  @Get('microsoft/callback')
  async microsoftCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const redirectUrl = await this.calendarService.handleCallback(code, state);
    return res.redirect(redirectUrl);
  }

  /**
   * GET /calendar/status
   * Whether the current coach has connected their calendar.
   */
  @Get('status')
  getStatus(@CurrentUser() user: User) {
    return this.calendarService.getStatus(user.id);
  }

  /**
   * DELETE /calendar/disconnect
   * Remove the current coach's stored calendar tokens.
   */
  @Delete('disconnect')
  disconnect(@CurrentUser() user: User) {
    return this.calendarService.disconnect(user.id);
  }
}
