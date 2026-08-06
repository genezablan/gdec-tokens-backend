import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

/**
 * Turns any failure in an SSO callback into a redirect to the app's error page.
 *
 * Passport throws *inside the guard* when the provider rejects the callback — a
 * reused or expired authorization code, a `redirect_uri` that doesn't match the
 * one the flow started with, revoked consent. That happens before the route
 * handler runs, so a try/catch in the handler cannot see it, and with no filter
 * bound the user was shown a raw `500 Internal Server Error` from the API host
 * instead of the app's error screen.
 *
 * A filter bound to the route catches guard, pipe and handler exceptions alike,
 * which makes it the only place that can cover the whole callback.
 *
 * The provider's own diagnostics (AADSTS codes, `invalid_grant`, trace ids) are
 * logged in full — they are what actually identifies the misconfiguration — while
 * the user gets something they can act on.
 */
@Injectable()
@Catch()
export class OAuthErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(OAuthErrorFilter.name);

  constructor(private readonly configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<{ path?: string }>();

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';

    // `UnauthorizedException` here is ours: validateOAuthUser raises it when no
    // account matches the verified identity. Everything else is a genuine fault
    // and must not be reported to the user as an account problem — that sends
    // them to HR for something HR cannot fix.
    const noAccount = exception instanceof UnauthorizedException;

    const detail =
      exception instanceof Error
        ? `${exception.name}: ${exception.message}`
        : String(exception);
    // OAuth libraries hang the useful part off non-standard properties.
    const extra = exception as { code?: string; oauthError?: unknown };
    const code = extra?.code ? ` [${extra.code}]` : '';

    this.logger.error(
      `SSO callback failed at ${req?.path ?? 'unknown route'}${code}: ${detail}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    const message = noAccount
      ? 'No account found with this email. Please contact HR.'
      : 'Sign-in failed. Please try again, or contact your administrator if it persists.';

    res.redirect(
      `${frontendUrl}/auth/error?message=${encodeURIComponent(message)}`,
    );
  }
}
