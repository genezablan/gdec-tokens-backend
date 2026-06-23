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
      scope: ['user.read'],
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
      // Short-lived Graph token — used once to sync the profile photo on login.
      accessToken,
    };

    done(null, user);
  }
}
