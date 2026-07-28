import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenBalance } from '../entities/token-balance.entity';
import { User } from '../entities/user.entity';
import { currentYearInTz } from './analytics-query.util';

/**
 * Dropdown options for the analytics FilterBar. One roundtrip; the frontend
 * cascades Department/Manager → Employee client-side via the ids carried on
 * each employee row.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(TokenBalance)
    private readonly tokenBalanceRepo: Repository<TokenBalance>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getFilterOptions() {
    const [yearRows, departmentRows, managerRows, employeeRows] =
      await Promise.all([
        this.tokenBalanceRepo
          .createQueryBuilder('b')
          .select('DISTINCT b.year', 'year')
          .orderBy('year', 'DESC')
          .getRawMany<{ year: number }>(),
        this.userRepo
          .createQueryBuilder('u')
          .select('DISTINCT u.department', 'department')
          .where('u.isActive = true')
          .andWhere('u.department IS NOT NULL')
          .orderBy('department', 'ASC')
          .getRawMany<{ department: string }>(),
        this.userRepo
          .createQueryBuilder('m')
          .innerJoin('users', 'r', 'r."immediateSupervisorId" = m.id')
          .select('m.id', 'id')
          .addSelect('m.firstName', 'firstName')
          .addSelect('m.lastName', 'lastName')
          .addSelect('m.department', 'department')
          .where('m.isActive = true')
          .distinct(true)
          .orderBy('m.firstName', 'ASC')
          .getRawMany<{
            id: string;
            firstName: string;
            lastName: string;
            department: string | null;
          }>(),
        this.userRepo
          .createQueryBuilder('u')
          .select('u.id', 'id')
          .addSelect('u.firstName', 'firstName')
          .addSelect('u.lastName', 'lastName')
          .addSelect('u.department', 'department')
          .addSelect('u."immediateSupervisorId"', 'managerId')
          .where('u.isActive = true')
          .orderBy('u.firstName', 'ASC')
          .getRawMany<{
            id: string;
            firstName: string;
            lastName: string;
            department: string | null;
            managerId: string | null;
          }>(),
      ]);

    const years = yearRows.map((r) => Number(r.year));
    const currentYear = currentYearInTz();
    if (!years.includes(currentYear)) years.unshift(currentYear);

    return {
      years,
      departments: departmentRows.map((r) => r.department),
      managers: managerRows.map((r) => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`.trim(),
        department: r.department,
      })),
      employees: employeeRows.map((r) => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`.trim(),
        department: r.department,
        managerId: r.managerId,
      })),
    };
  }
}
