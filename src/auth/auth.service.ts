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
import * as crypto from 'crypto';
import { User } from '../entities/user.entity';
import { LoginEvent } from '../entities/login-event.entity';
import { AuthProvider, EmployeeStatus, UserRole } from '../common/enums';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './dto';
import { AuthResponse, JwtPayload } from './interfaces/jwt-payload.interface';
import { EmailService } from '../common/services/email.service';
import { S3Service } from '../common/services/s3.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(LoginEvent)
    private loginEventRepository: Repository<LoginEvent>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    private s3Service: S3Service,
  ) {}

  async validateUser(identifier: string, password: string): Promise<User | null> {
    // Find user by email only
    const user = await this.userRepository.findOne({
      where: { email: identifier },
    });

    if (!user) {
      return null;
    }

    // Check if account is pending HR approval
    if (user.isPendingApproval) {
      throw new UnauthorizedException('Your account is pending HR approval. You will be notified by email once approved.');
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
    // Record the login for engagement analytics (last-login + append-only event log).
    // Best-effort: a tracking failure must never block a valid login.
    try {
      await this.userRepository.update(user.id, { lastLoginAt: new Date() });
      await this.loginEventRepository.save(
        this.loginEventRepository.create({ userId: user.id }),
      );
    } catch {
      // swallow — analytics tracking is non-critical
    }

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

  /**
   * Sync the user's profile photo from Microsoft Graph on SSO login.
   * Best-effort: only runs when the user has no picture set (won't overwrite a
   * custom upload), and never blocks login on failure.
   */
  async syncMicrosoftProfilePicture(
    user: User,
    accessToken?: string,
  ): Promise<void> {
    if (!accessToken || user.profilePicture) return;

    try {
      const res = await fetch(
        'https://graph.microsoft.com/v1.0/me/photo/$value',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      // 404 = the account has no photo; anything non-OK → skip silently.
      if (!res.ok) return;

      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0) return;

      const ext = contentType.includes('png') ? 'png' : 'jpg';
      const key = `profile-pictures/${user.id}/${user.id}-${Date.now()}.${ext}`;
      await this.s3Service.uploadFile(buffer, key, { contentType });

      user.profilePicture = key;
      await this.userRepository.save(user);
    } catch {
      // Best-effort — a photo sync failure must never break sign-in.
    }
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

  async getDepartments(): Promise<string[]> {
    const rows = await this.userRepository
      .createQueryBuilder('user')
      .select('DISTINCT user.department', 'department')
      .where('user.isActive = :isActive', { isActive: true })
      .orderBy('user.department', 'ASC')
      .getRawMany<{ department: string }>();

    return rows.map((r) => r.department);
  }

  async getSupervisorsByDepartment(department: string) {
    const users = await this.userRepository
      .createQueryBuilder('user')
      .where('user.department = :department', { department })
      .andWhere('user.isActive = :isActive', { isActive: true })
      .andWhere(':role = ANY(user.roles)', { role: 'approver' })
      .orderBy('user.lastName', 'ASC')
      .addOrderBy('user.firstName', 'ASC')
      .getMany();

    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      position: u.position,
    }));
  }

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const existing = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new BadRequestException('An account with this email already exists');
    }

    // Verify the supervisor exists
    const supervisor = await this.userRepository.findOne({
      where: { id: dto.immediateSupervisorId },
    });
    if (!supervisor) {
      throw new BadRequestException('The selected supervisor does not exist');
    }

    // Auto-generate employeeId: count all users and pad to 3 digits
    const count = await this.userRepository.count();
    const employeeId = `GDC-${String(count + 1).padStart(3, '0')}`;

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = this.userRepository.create({
      employeeId,
      email: dto.email,
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
      department: dto.department,
      immediateSupervisorId: dto.immediateSupervisorId,
      contact: dto.contact,
      roles: [UserRole.EMPLOYEE],
      employeeStatus: EmployeeStatus.PROBATIONARY,
      isActive: false,          // Cannot log in until HR approves
      isPendingApproval: true,  // Flags account for HR review
      isPasswordChanged: true,  // They set their own password at registration
    });

    await this.userRepository.save(user);

    this.emailService
      .sendRegistrationSubmittedEmail({ email: user.email, name: user.fullName })
      .catch(() => {});

    const hrUsers = await this.userRepository
      .createQueryBuilder('hr')
      .where(':role = ANY(hr.roles)', { role: UserRole.HR_APPROVER })
      .andWhere('hr.isActive = true')
      .getMany();

    for (const hrUser of hrUsers) {
      this.emailService
        .sendNewRegistrationNotification({
          hrEmail: hrUser.email,
          hrName: hrUser.fullName,
          applicantName: user.fullName,
          applicantEmail: user.email,
          department: user.department,
        })
        .catch(() => {});
    }

    return { message: 'Registration submitted. Your account is pending HR approval. You will receive an email once your account is approved.' };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({ where: { email: dto.email } });
    const silentSuccess = { message: 'If that email exists, a reset link has been sent.' };

    if (!user || !user.isActive) return silentSuccess;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = await bcrypt.hash(rawToken, 10);
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    user.passwordResetToken = hashedToken;
    user.passwordResetExpiry = expiry;
    await this.userRepository.save(user);

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const resetLink = `${frontendUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

    try {
      await this.emailService.sendPasswordResetEmail({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        resetLink,
        expiryMinutes: 5,
      });
    } catch {
      // Don't expose email errors to caller
    }

    return silentSuccess;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({ where: { email: dto.email } });

    if (!user || !user.passwordResetToken || !user.passwordResetExpiry) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (new Date() > user.passwordResetExpiry) {
      throw new BadRequestException('Reset token has expired');
    }

    const isValid = await bcrypt.compare(dto.token, user.passwordResetToken);
    if (!isValid) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    user.password = await bcrypt.hash(dto.newPassword, 10);
    user.isPasswordChanged = true;
    user.passwordResetToken = null as any;
    user.passwordResetExpiry = null as any;

    await this.userRepository.save(user);

    return { message: 'Password reset successful. You may now log in.' };
  }

  async getProfile(userId: string): Promise<Omit<User, 'password'>> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['immediateSupervisor'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, passwordResetToken, passwordResetExpiry, ...safeUser } = user;
    const resolved = await this.resolveProfilePicture(safeUser);
    return resolved as Omit<User, 'password'>;
  }

  async generateProfilePictureUploadUrl(
    userId: string,
    filename: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    if (!filename || !contentType) {
      throw new BadRequestException('filename and contentType are required');
    }
    const ext = filename.split('.').pop() ?? 'jpg';
    const key = `profile-pictures/${userId}/${userId}-${Date.now()}.${ext}`;
    return this.s3Service.generateProfilePicturePutUrl(key, contentType);
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<Omit<User, 'password'>> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.nickname !== undefined) {
      user.nickname = dto.nickname.trim() || null;
    }

    if (dto.profilePictureKey) {
      user.profilePicture = dto.profilePictureKey;
    }

    // Coach profile fields — send only what changed; empty string/array clears.
    if (dto.headline !== undefined) {
      user.headline = dto.headline.trim() || null;
    }

    if (dto.bio !== undefined) {
      user.bio = dto.bio.trim() || null;
    }

    if (dto.specialties !== undefined) {
      const cleaned = dto.specialties.map((s) => s.trim()).filter(Boolean);
      user.specialties = cleaned.length ? cleaned : null;
    }

    if (dto.yearsExperience !== undefined) {
      user.yearsExperience = dto.yearsExperience;
    }

    if (dto.maxCoachesPerCycle !== undefined) {
      user.maxCoachesPerCycle = dto.maxCoachesPerCycle;
    }

    await this.userRepository.save(user);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, passwordResetToken, passwordResetExpiry, ...safeUser } = user;
    const resolved = await this.resolveProfilePicture(safeUser);
    return resolved as Omit<User, 'password'>;
  }

  /**
   * Replaces the stored S3 key in `profilePicture` with a short-lived (15 min) presigned GET URL.
   * If the field is null or already a full URL (legacy), it is returned as-is.
   */
  private async resolveProfilePicture<T extends { profilePicture?: string | null }>(user: T): Promise<T> {
    if (!user.profilePicture || user.profilePicture.startsWith('http')) {
      return user;
    }
    const signedUrl = await this.s3Service.getPresignedDownloadUrl(user.profilePicture, 900);
    return { ...user, profilePicture: signedUrl };
  }
}
