import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Req,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, ChangePasswordDto } from './dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
// import { GoogleAuthGuard } from './guards/google-auth.guard';
// import { MicrosoftAuthGuard } from './guards/microsoft-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from '../entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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

  // OAuth endpoints - enable when OAuth is configured
  /*
  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  async googleAuth() {
    // Initiates Google OAuth flow
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthCallback(@Req() req) {
    const { providerId, email, firstName, lastName } = req.user;
    const user = await this.authService.validateOAuthUser(
      providerId,
      email,
      'google',
      firstName,
      lastName,
    );
    return this.authService.login(user);
  }

  @Public()
  @Get('microsoft')
  @UseGuards(MicrosoftAuthGuard)
  async microsoftAuth() {
    // Initiates Microsoft OAuth flow
  }

  @Public()
  @Get('microsoft/callback')
  @UseGuards(MicrosoftAuthGuard)
  async microsoftAuthCallback(@Req() req) {
    const { providerId, email, firstName, lastName } = req.user;
    const user = await this.authService.validateOAuthUser(
      providerId,
      email,
      'microsoft',
      firstName,
      lastName,
    );
    return this.authService.login(user);
  }
  */

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
