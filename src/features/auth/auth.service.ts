import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignupDto, SigninDto } from './dto';
import { SupabaseService } from '../supabase/supabase.service';
import { EmailService } from '../../common/services/email.service';
import { verifyToken } from '@clerk/clerk-sdk-node';

/**
 * Handles Supabase error responses and converts them to user-friendly messages
 */
function handleSupabaseError(error: any): {
  message: string;
  statusCode: number;
} {
  let message = error.message || 'An error occurred';
  let statusCode = HttpStatus.BAD_REQUEST;

  // Handle specific Supabase error codes
  switch (error.code) {
    case 'email_address_invalid':
      message =
        'The email address provided is invalid. Please enter a valid email.';
      break;
    case 'user_already_registered':
    case 'user_already_exists':
      message =
        'This email is already registered. Please sign in or use a different email.';
      statusCode = HttpStatus.CONFLICT;
      break;
    case 'invalid_credentials':
    case 'invalid_grant':
      message =
        'Invalid email or password. Please check your credentials and try again.';
      statusCode = HttpStatus.UNAUTHORIZED;
      break;
    case 'invalid_token':
    case 'expired_token':
      message = 'Your session has expired. Please sign in again.';
      statusCode = HttpStatus.UNAUTHORIZED;
      break;
    case 'password_recovery_email_sent':
      // This is actually a success case
      return {
        message: 'Password recovery email sent. Please check your inbox.',
        statusCode: HttpStatus.OK,
      };
  }

  return { message, statusCode };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    this.logger.log('Auth service initialized with Supabase');
  }

  /**
   * Register a new user with Supabase Auth
   * Returns raw Supabase response
   */
  async signup(signupDto: SignupDto) {
    try {
      this.logger.log(`Attempting to register user: ${signupDto.email}`);

      const supabase = this.supabaseService.getClient();
      const response = await supabase.auth.signUp({
        email: signupDto.email,
        password: signupDto.password,
        options: {
          data: signupDto.data || { name: signupDto.email.split('@')[0] },
        },
      });

      if (response.error) throw response.error;

      this.logger.log(`User registered successfully: ${signupDto.email}`);

      try {
        const firstName = (
          signupDto.data?.name || signupDto.email.split('@')[0]
        ).split(' ')[0];
        await this.emailService.sendWelcomeEmail({
          toEmail: signupDto.email,
          toName: signupDto.data?.name || signupDto.email,
          firstName,
        });
      } catch (notifyErr: any) {
        this.logger.warn(
          `Welcome email failed for ${signupDto.email}: ${notifyErr?.message || notifyErr}`,
        );
      }

      return response;
    } catch (error) {
      this.logger.error(
        `Signup failed for ${signupDto.email}: ${error.message}`,
      );
      const { message, statusCode } = handleSupabaseError(error);
      throw new HttpException(message, statusCode);
    }
  }

  /**
   * Sign in a user with email and password
   * Returns raw Supabase response
   */
  async signin(signinDto: SigninDto) {
    try {
      const supabase = this.supabaseService.getClient();
      const response = await supabase.auth.signInWithPassword({
        email: signinDto.email,
        password: signinDto.password,
      });

      if (response.error) throw response.error;

      // Return raw Supabase response
      return response;
    } catch (error) {
      this.logger.error(
        `Signin failed for ${signinDto.email}: ${error.message}`,
      );
      const { message, statusCode } = handleSupabaseError(error);
      throw new HttpException(message, statusCode);
    }
  }

  /**
   * Sign in a user with a one-time password (magic link)
   * Returns raw Supabase response
   */
  async signinWithOtp(email: string) {
    try {
      const supabase = this.supabaseService.getClient();
      const response = await supabase.auth.signInWithOtp({
        email: email,
      });

      if (response.error) throw response.error;

      // Return raw Supabase response
      return response;
    } catch (error) {
      this.logger.error(`OTP signin failed for ${email}: ${error.message}`);
      const { message, statusCode } = handleSupabaseError(error);
      throw new HttpException(message, statusCode);
    }
  }

  /**
   * Send a password reset email
   * Returns raw Supabase response
   */
  async resetPassword(email: string) {
    try {
      const supabase = this.supabaseService.getClient();
      const response = await supabase.auth.resetPasswordForEmail(email);

      if (response.error) throw response.error;

      // Return raw response
      return response;
    } catch (error) {
      this.logger.error(`Password reset failed for ${email}: ${error.message}`);
      const { message, statusCode } = handleSupabaseError(error);
      throw new HttpException(message, statusCode);
    }
  }

  /**
   * Sign out a user
   * Returns raw Supabase response
   */
  async signout(token: string) {
    try {
      const supabase = this.supabaseService.getClient();

      // Set the session token
      if (token) {
        await supabase.auth.setSession({
          access_token: token,
          refresh_token: '',
        });
      }

      const response = await supabase.auth.signOut();

      if (response.error) throw response.error;

      return response;
    } catch (error) {
      this.logger.error(`Signout failed: ${error.message}`);
      const { message, statusCode } = handleSupabaseError(error);
      throw new HttpException(message, statusCode);
    }
  }

  /**
   * Get current user information
   * Returns raw Supabase response
   */
  async getUser(token: string, refresh_token: string) {
    try {
      const supabase = this.supabaseService.getClient();

      // Set the session token
      if (token) {
        await supabase.auth.setSession({
          access_token: token,
          refresh_token: refresh_token,
        });
      }

      // Get the user and return raw response
      const response = await supabase.auth.getUser();

      if (response.error) throw response.error;

      return response;
    } catch (error) {
      this.logger.error(`Get user failed: ${error.message}`);
      const { message, statusCode } = handleSupabaseError(error);
      throw new HttpException(message, statusCode);
    }
  }

  async oauthLogin(
    req: import('express').Request,
    res: import('express').Response,
  ) {
    try {
      const supabase = this.supabaseService.getClient();

      const { token } = req.body as unknown as { token: string }; // Clerk frontend will send this
      console.log(token);
      const decoded = await verifyToken(token, {
        apiKey: 'sk_test_zUDuy2jFtUZmefHF3AOQPbpdpTNz1MEhM6dc7eqh3O',
        issuer: 'https://healthy-ringtail-2.clerk.accounts.dev',
      });

      const emailAddresses = decoded.email_addresses as Array<{
        email_address: string;
      }>;
      const email = emailAddresses[0].email_address;

      // 🔹 Check if user exists in Supabase
      let { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

      if (!existingUser) {
        // Create Supabase user
        const { data: createdUser, error } =
          await supabase.auth.admin.createUser({
            email,
            email_confirm: true,
          });

        if (error) throw error;
        existingUser = createdUser.user;
      }

      const { data: linkData, error: linkError } =
        await supabase.auth.admin.generateLink({
          type: 'magiclink',
          email,
        });

      if (linkError) throw linkError;

      return res.json({
        success: true,
        supabaseToken: linkData?.user.action_link,
      });
    } catch (err) {
      console.error(err);
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
  }
}
