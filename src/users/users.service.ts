import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayContains, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  private safeUser(user: User) {
    return {
      id: user.id,
      employeeId: user.employeeId,
      email: user.email,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      fullName: user.fullName,
      gender: user.gender,
      department: user.department,
      location: user.location,
      position: user.position,
      employeeType: user.employeeType,
      employeeStatus: user.employeeStatus,
      roles: user.roles,
      isActive: user.isActive,
      isPasswordChanged: user.isPasswordChanged,
      immediateSupervisorId: user.immediateSupervisorId,
      contact: user.contact,
      separationDate: user.separationDate,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * List users.
   * - ?role=coach|employee|approver|hr_approver|admin  → filter by role (users who have that role)
   * - ?isActive=true|false                              → filter by active status (default: all)
   * Sorted by lastName asc.
   */
  async findAll(role?: UserRole, isActive?: boolean) {
    const where: Record<string, unknown> = {};

    if (role) {
      where.roles = ArrayContains([role]);
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const users = await this.userRepo.find({
      where,
      order: { lastName: 'ASC', firstName: 'ASC' },
    });

    return users.map((u) => this.safeUser(u));
  }

  async findOne(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.safeUser(user);
  }

  async updateRoles(id: string, roles: UserRole[]) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    user.roles = roles;
    await this.userRepo.save(user);
    return this.safeUser(user);
  }

  async toggleActive(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    user.isActive = !user.isActive;
    await this.userRepo.save(user);
    return this.safeUser(user);
  }
}
