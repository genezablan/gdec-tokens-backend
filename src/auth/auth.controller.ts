import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Patch,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, RegisterDto, ResetPasswordDto, UpdateProfileDto } from './dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { MicrosoftAuthGuard } from './guards/microsoft-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums';
import { CalendarService } from '../calendar/calendar.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
    private calendarService: CalendarService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Get('departments')
  getDepartments() {
    return this.authService.getDepartments();
  }

  @Public()
  @Get('supervisors')
  getSupervisorsByDepartment(@Query('department') department: string) {
    return this.authService.getSupervisorsByDepartment(department ?? '');
  }

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Req() req) {
    return this.authService.login(req.user);
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, changePasswordDto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }

  /**
   * GET /auth/profile/presigned-upload?filename=photo.jpg&contentType=image/jpeg
   * Returns a short-lived S3 presigned PUT URL and the key to pass back in PATCH /auth/profile.
   */
  @Get('profile/presigned-upload')
  @UseGuards(JwtAuthGuard)
  async getProfilePictureUploadUrl(
    @CurrentUser('id') userId: string,
    @Query('filename') filename: string,
    @Query('contentType') contentType: string,
  ) {
    return this.authService.generateProfilePictureUploadUrl(userId, filename, contentType);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(userId, dto);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  // Google SSO
  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  async googleAuth() {
    // Passport redirects to Google login — no body needed
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthCallback(@Req() req, @Res() res: Response) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    try {
      const { providerId, email, firstName, lastName } = req.user;
      const user = await this.authService.validateOAuthUser(
        providerId,
        email,
        'google',
        firstName,
        lastName,
      );
      const authResponse = await this.authService.login(user);
      const token = authResponse.accessToken;
      return res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
    } catch {
      return res.redirect(`${frontendUrl}/auth/error?message=Account+not+found.+Please+contact+HR.`);
    }
  }

  // Microsoft SSO
  @Public()
  @Get('microsoft')
  @UseGuards(MicrosoftAuthGuard)
  async microsoftAuth() {
    // Passport redirects to Microsoft login — no body needed
  }

  @Public()
  @Get('microsoft/callback')
  @UseGuards(MicrosoftAuthGuard)
  async microsoftAuthCallback(@Req() req, @Res() res: Response) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    try {
      const { providerId, email, firstName, lastName, accessToken, refreshToken } = req.user;
      const user = await this.authService.validateOAuthUser(
        providerId,
        email,
        'microsoft',
        firstName,
        lastName,
      );
      // Best-effort: pull the Outlook profile photo if the user has none yet.
      await this.authService.syncMicrosoftProfilePicture(user, accessToken);
      // Auto-connect the coach's Outlook calendar using the login tokens.
      if (user.roles?.includes(UserRole.COACH)) {
        try {
          await this.calendarService.saveLoginConnection(user.id, {
            accessToken,
            refreshToken,
            accountEmail: email,
          });
        } catch {
          // Best-effort — calendar connect must never block sign-in.
        }
      }
      const authResponse = await this.authService.login(user);
      const token = authResponse.accessToken;
      return res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
    } catch {
      return res.redirect(`${frontendUrl}/auth/error?message=Account+not+found.+Please+contact+HR.`);
    }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(@CurrentUser() user: User) {
    return {
      id: user.id,
      employeeId: user.employeeId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      department: user.department,
      position: user.position,
      roles: user.roles,
      isPasswordChanged: user.isPasswordChanged,
    };
  }
}
