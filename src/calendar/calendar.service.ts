import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalendarConnection } from '../entities/calendar-connection.entity';
import { CalendarCryptoService } from './calendar-crypto.service';

/** Delegated Microsoft Graph scopes required for the calendar integration. */
const CALENDAR_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite',
  'OnlineMeetings.ReadWrite',
];

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

/** Signed payload carried in the OAuth `state` parameter. */
interface CalendarState {
  purpose?: string;
  sub?: string;
}

interface GraphUser {
  mail?: string;
  userPrincipalName?: string;
}

interface GraphCreatedEvent {
  id: string;
  onlineMeeting?: { joinUrl?: string };
}

interface GraphCalendarEvent {
  isCancelled?: boolean;
  showAs?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
}

interface GraphCalendarView {
  value?: GraphCalendarEvent[];
}

/** Format a Date as Graph's local-style dateTime ("YYYY-MM-DDTHH:mm:ss") in UTC. */
function toGraphDateTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '');
}

/** Parse a Graph dateTime (no offset, implicitly the requested timezone = UTC). */
function parseGraphUtc(dt?: string): Date | null {
  if (!dt) return null;
  const iso = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(dt) ? dt : `${dt}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    @InjectRepository(CalendarConnection)
    private readonly connectionRepo: Repository<CalendarConnection>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly crypto: CalendarCryptoService,
  ) {}

  // ─── Config helpers ────────────────────────────────────────────────────────

  private get tenant(): string {
    return this.configService.get<string>('MICROSOFT_TENANT') || 'common';
  }

  private get clientId(): string {
    return this.configService.get<string>('MICROSOFT_CLIENT_ID') || '';
  }

  private get clientSecret(): string {
    return this.configService.get<string>('MICROSOFT_CLIENT_SECRET') || '';
  }

  private get redirectUri(): string {
    return (
      this.configService.get<string>('MICROSOFT_CALENDAR_CALLBACK_URL') ||
      'http://localhost:3000/api/calendar/microsoft/callback'
    );
  }

  private get frontendUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173'
    );
  }

  private authBase(path: string): string {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/${path}`;
  }

  // ─── OAuth: build authorize URL ──────────────────────────────────────────────

  /**
   * Build the Microsoft authorize URL for a coach to connect their calendar.
   * The signed `state` carries the userId so the callback can attribute the
   * resulting tokens without an authenticated session.
   */
  buildAuthorizeUrl(userId: string): string {
    if (!this.clientId) {
      throw new BadRequestException(
        'Microsoft calendar integration is not configured.',
      );
    }

    const state = this.jwtService.sign(
      { sub: userId, purpose: 'calendar_connect' },
      { expiresIn: '10m' },
    );

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      response_mode: 'query',
      scope: CALENDAR_SCOPES.join(' '),
      state,
    });

    return `${this.authBase('authorize')}?${params.toString()}`;
  }

  // ─── OAuth: handle callback ──────────────────────────────────────────────────

  /**
   * Exchange the authorization code for tokens and persist the connection.
   * Returns a frontend redirect URL (success or error).
   */
  async handleCallback(code?: string, state?: string): Promise<string> {
    const failure = `${this.frontendUrl}/coach-availability?calendar=error`;

    if (!code || !state) return failure;

    let userId: string;
    try {
      const payload = this.jwtService.verify<CalendarState>(state);
      if (payload.purpose !== 'calendar_connect' || !payload.sub)
        return failure;
      userId = payload.sub;
    } catch {
      this.logger.warn(
        'Calendar OAuth callback received an invalid state token',
      );
      return failure;
    }

    try {
      const tokens = await this.exchangeCode(code);
      await this.persistTokens(userId, tokens);
      return `${this.frontendUrl}/coach-availability?calendar=connected`;
    } catch (err) {
      this.logger.error(
        `Calendar token exchange failed for user ${userId}: ${(err as Error).message}`,
      );
      return failure;
    }
  }

  private async exchangeCode(code: string): Promise<TokenResponse> {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      scope: CALENDAR_SCOPES.join(' '),
    });
  }

  private async tokenRequest(
    extra: Record<string, string>,
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      ...extra,
    });

    const res = await fetch(this.authBase('token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token endpoint ${res.status}: ${text}`);
    }

    return (await res.json()) as TokenResponse;
  }

  private async persistTokens(
    userId: string,
    tokens: TokenResponse,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    let conn = await this.connectionRepo.findOne({ where: { userId } });
    if (!conn) {
      conn = this.connectionRepo.create({ userId, provider: 'microsoft' });
    }

    conn.accessTokenEnc = this.crypto.encrypt(tokens.access_token);
    if (tokens.refresh_token) {
      conn.refreshTokenEnc = this.crypto.encrypt(tokens.refresh_token);
    }
    conn.expiresAt = expiresAt;
    conn.scopes = tokens.scope ?? CALENDAR_SCOPES.join(' ');
    conn.connectedAt = conn.connectedAt ?? new Date();

    const saved = await this.connectionRepo.save(conn);

    // Best-effort: fetch the connected account's email for display.
    try {
      const me = await this.graphGet<GraphUser>('/me', tokens.access_token);
      saved.accountEmail = me.mail || me.userPrincipalName || null;
      await this.connectionRepo.save(saved);
    } catch (err) {
      this.logger.warn(
        `Could not fetch /me for user ${userId}: ${(err as Error).message}`,
      );
    }
  }

  private async graphGet<T>(path: string, accessToken: string): Promise<T> {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Graph GET ${path} ${res.status}`);
    return (await res.json()) as T;
  }

  private async graphRequest<T>(
    method: string,
    path: string,
    accessToken: string,
    body?: unknown,
  ): Promise<T | null> {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph ${method} ${path} ${res.status}: ${text}`);
    }
    // DELETE returns 204 No Content.
    if (res.status === 204) return null;
    return (await res.json()) as T;
  }

  // ─── Calendar events (Outlook + Teams) ───────────────────────────────────────

  /**
   * Create a coaching-session event on the coach's calendar with a Teams link
   * and the employee invited. Returns the Graph event id and Teams join URL.
   */
  async createCoachingEvent(
    coachId: string,
    event: {
      subject: string;
      bodyHtml: string;
      start: Date;
      end: Date;
      attendeeEmail?: string | null;
      attendeeName?: string | null;
    },
  ): Promise<{ eventId: string; joinUrl: string | null }> {
    const accessToken = await this.getValidAccessToken(coachId);

    const payload: Record<string, unknown> = {
      subject: event.subject,
      body: { contentType: 'HTML', content: event.bodyHtml },
      start: { dateTime: toGraphDateTime(event.start), timeZone: 'UTC' },
      end: { dateTime: toGraphDateTime(event.end), timeZone: 'UTC' },
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
    };

    if (event.attendeeEmail) {
      payload.attendees = [
        {
          emailAddress: {
            address: event.attendeeEmail,
            name: event.attendeeName ?? undefined,
          },
          type: 'required',
        },
      ];
    }

    const created = await this.graphRequest<GraphCreatedEvent>(
      'POST',
      '/me/events',
      accessToken,
      payload,
    );
    if (!created) throw new Error('Graph returned no event');
    return {
      eventId: created.id,
      joinUrl: created.onlineMeeting?.joinUrl ?? null,
    };
  }

  /** Cancel/delete a previously created calendar event (sends cancellation to attendees). */
  async cancelEvent(coachId: string, eventId: string): Promise<void> {
    const accessToken = await this.getValidAccessToken(coachId);
    await this.graphRequest('DELETE', `/me/events/${eventId}`, accessToken);
  }

  /**
   * Return the coach's busy intervals (UTC) between two dates, from their Outlook
   * calendar. Free/cancelled events are excluded.
   */
  async getBusyIntervals(
    coachId: string,
    from: Date,
    to: Date,
  ): Promise<{ start: Date; end: Date }[]> {
    const accessToken = await this.getValidAccessToken(coachId);

    const params = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: 'start,end,showAs,isCancelled',
      $top: '200',
      $orderby: 'start/dateTime',
    });

    const data = await this.graphGet<GraphCalendarView>(
      `/me/calendarView?${params.toString()}`,
      accessToken,
    );

    const events: GraphCalendarEvent[] = data.value ?? [];
    const intervals: { start: Date; end: Date }[] = [];
    for (const e of events) {
      if (e.isCancelled || e.showAs === 'free') continue;
      const start = parseGraphUtc(e.start?.dateTime);
      const end = parseGraphUtc(e.end?.dateTime);
      if (start && end) intervals.push({ start, end });
    }
    return intervals;
  }

  // ─── Status / disconnect ─────────────────────────────────────────────────────

  async getStatus(userId: string): Promise<{
    connected: boolean;
    accountEmail: string | null;
    connectedAt: Date | null;
  }> {
    const conn = await this.connectionRepo.findOne({ where: { userId } });
    if (!conn?.refreshTokenEnc) {
      return { connected: false, accountEmail: null, connectedAt: null };
    }
    return {
      connected: true,
      accountEmail: conn.accountEmail,
      connectedAt: conn.connectedAt,
    };
  }

  async disconnect(userId: string): Promise<{ disconnected: boolean }> {
    await this.connectionRepo.delete({ userId });
    return { disconnected: true };
  }

  // ─── Token access (used by push/pull features) ───────────────────────────────

  /** Whether a coach currently has a usable calendar connection. */
  async isConnected(userId: string): Promise<boolean> {
    const conn = await this.connectionRepo.findOne({ where: { userId } });
    return !!conn?.refreshTokenEnc;
  }

  /**
   * Return a valid (refreshed if needed) Microsoft Graph access token for a user.
   * Throws UnauthorizedException if the user has no calendar connection.
   */
  async getValidAccessToken(userId: string): Promise<string> {
    const conn = await this.connectionRepo.findOne({ where: { userId } });
    if (!conn?.refreshTokenEnc) {
      throw new UnauthorizedException('Calendar is not connected');
    }

    const stillValid =
      conn.expiresAt && conn.expiresAt.getTime() - Date.now() > 60_000;
    if (stillValid && conn.accessTokenEnc) {
      return this.crypto.decrypt(conn.accessTokenEnc);
    }

    // Refresh.
    const refreshToken = this.crypto.decrypt(conn.refreshTokenEnc);
    const tokens = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: CALENDAR_SCOPES.join(' '),
    });

    conn.accessTokenEnc = this.crypto.encrypt(tokens.access_token);
    if (tokens.refresh_token) {
      conn.refreshTokenEnc = this.crypto.encrypt(tokens.refresh_token);
    }
    conn.expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    if (tokens.scope) conn.scopes = tokens.scope;
    await this.connectionRepo.save(conn);

    return tokens.access_token;
  }
}
