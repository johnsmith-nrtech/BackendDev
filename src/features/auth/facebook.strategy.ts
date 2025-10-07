// src/auth/facebook.strategy.ts
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { Strategy, Profile } from 'passport-facebook';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor() {
    super({
      clientID: process.env.FACEBOOK_CLIENT_ID,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
      callbackURL: 'http://localhost:4000/auth/facebook/callback',
      profileFields: ['id', 'displayName', 'emails'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile) {
    return {
      provider: 'facebook',
      providerId: profile.id,
      email: profile.emails?.[0].value,
      name: profile.displayName,
    };
  }
}
