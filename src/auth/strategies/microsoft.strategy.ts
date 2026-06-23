import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-microsoft';

@Injectable()
export class MicrosoftStrategy extends PassportStrategy(Strategy, 'microsoft') {
  constructor(private configService: ConfigService) {
    super({
      clientID: configService.get<string>('MICROSOFT_CLIENT_ID'),
      clientSecret: configService.get<string>('MICROSOFT_CLIENT_SECRET'),
      callbackURL: configService.get<string>('MICROSOFT_CALLBACK_URL') || 'http://localhost:3000/api/auth/microsoft/callback',
      // Calendar scopes + offline_access are requested at login so coaches'
      // Outlook calendars auto-connect (refresh token captured in the callback).
      // Admin consent covers these, so regular staff see no extra prompt.
      scope: [
        'openid',
        'profile',
        'email',
        'offline_access',
        'User.Read',
        'Calendars.ReadWrite',
        'OnlineMeetings.ReadWrite',
      ],
      tenant: configService.get<string>('MICROSOFT_TENANT') || 'common',
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, emails, name } = profile;

    const user = {
      providerId: id,
      email: emails?.[0]?.value || profile.userPrincipalName,
      firstName: name?.givenName || profile.givenName,
      lastName: name?.familyName || profile.surname,
      provider: 'microsoft',
      // Graph tokens — used to sync the profile photo and auto-connect the
      // coach's Outlook calendar in the callback. (Access-token lifetime isn't
      // exposed via @nestjs/passport's wrapper, so the calendar service defaults
      // the expiry and refreshes on demand.)
      accessToken,
      refreshToken,
    };

    done(null, user);
  }
}
