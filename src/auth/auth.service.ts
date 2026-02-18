import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { AuthProvider } from '../common/enums';
import { ChangePasswordDto } from './dto';
import { AuthResponse, JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async validateUser(identifier: string, password: string): Promise<User | null> {
    // Find user by email only
    const user = await this.userRepository.findOne({
      where: { email: identifier },
    });

    if (!user) {
      return null;
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    // Verify password
    if (!user.password) {
      throw new UnauthorizedException('Please use OAuth login');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  async login(user: User): Promise<AuthResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      employeeId: user.employeeId,
      email: user.email,
      roles: user.roles,
      firstName: user.firstName,
      lastName: user.lastName,
      department: user.department,
      type: 'access',
    };

    const refreshPayload = { ...payload, type: 'refresh' };

    const accessToken = this.jwtService.sign(payload as any);

    const refreshToken = this.jwtService.sign(refreshPayload as any, {
      expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d') as any,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        employeeId: user.employeeId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        department: user.department,
        position: user.position,
        roles: user.roles,
        isPasswordChanged: user.isPasswordChanged,
      },
      requiresPasswordChange: !user.isPasswordChanged,
    };
  }

  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string; isFirstPasswordChange: boolean }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Track if this is first password change
    const isFirstPasswordChange = !user.isPasswordChanged;

    // If user has a password and it's not first time, verify old password
    if (user.password && user.isPasswordChanged) {
      const isOldPasswordValid = await bcrypt.compare(
        changePasswordDto.oldPassword,
        user.password,
      );

      if (!isOldPasswordValid) {
        throw new BadRequestException('Current password is incorrect');
      }
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(changePasswordDto.newPassword, 10);

    // Update password and mark as changed
    user.password = hashedPassword;
    user.isPasswordChanged = true;

    await this.userRepository.save(user);

    const message = isFirstPasswordChange
      ? 'Password changed successfully. This is your first password change.'
      : 'Password changed successfully';

    return { message, isFirstPasswordChange };
  }

  async validateOAuthUser(
    providerId: string,
    email: string,
    provider: 'google' | 'microsoft',
    firstName?: string,
    lastName?: string,
  ): Promise<User> {
    // First, try to find user by providerId
    let user = await this.userRepository.findOne({
      where: {
        providerId,
        authProvider: provider === 'google' ? AuthProvider.GOOGLE : AuthProvider.MICROSOFT,
      },
    });

    if (user) {
      return user;
    }

    // If not found, try to find by email and link account
    user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException(
        'No account found with this email. Please contact HR.',
      );
    }

    // Link OAuth account to existing user
    user.providerId = providerId;
    user.authProvider = provider === 'google' ? AuthProvider.GOOGLE : AuthProvider.MICROSOFT;
    
    // Update name if provided and empty
    if (firstName && !user.firstName) {
      user.firstName = firstName;
    }
    if (lastName && !user.lastName) {
      user.lastName = lastName;
    }

    await this.userRepository.save(user);

    return user;
  }

  async refreshToken(refreshToken: string): Promise<{ accessToken: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken);

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException('User not found or inactive');
      }

      const newPayload: JwtPayload = {
        sub: user.id,
        employeeId: user.employeeId,
        email: user.email,
        roles: user.roles,
        firstName: user.firstName,
        lastName: user.lastName,
        department: user.department,
        type: 'access',
      };

      const accessToken = this.jwtService.sign(newPayload);

      return { accessToken };
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async getProfile(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['immediateSupervisor'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}
