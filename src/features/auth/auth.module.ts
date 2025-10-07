import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommonModule } from '../../common/common.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PassportModule } from '@nestjs/passport';
import { FacebookStrategy } from './facebook.strategy';
import { GoogleStrategy } from './google.strategy';
import { MailModule } from '../mail/mail.module';

/**
 * Authentication module for user sign up and sign in
 * using Supabase Auth service + Google/Facebook OAuth
 */
@Module({
  imports: [
    HttpModule,
    SupabaseModule,
    CommonModule,
    MailModule,
    PassportModule.register({ session: false }), // add Passport
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    FacebookStrategy, // add Passport strategies
    GoogleStrategy,
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
