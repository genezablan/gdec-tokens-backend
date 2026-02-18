export enum UserRole {
  EMPLOYEE = 'employee',
  COACH = 'coach',
  APPROVER = 'approver',    // Manager-level approver (immediate supervisor)
  HR_APPROVER = 'hr_approver', // HR second-level approver
  ADMIN = 'admin',
}

export enum EmployeeType {
  MANAGER = 'Manager',
  RANK_AND_FILE = 'Rank and file',
  OFFICER = 'Officer',
}

export enum EmployeeStatus {
  REGULAR = 'Regular',
  PROBATIONARY = 'Probationary',
  RESIGNED = 'Resigned',
  AWOL = 'AWOL',
  TERMINATED = 'Terminated',
}

export enum Gender {
  MALE = 'Male',
  FEMALE = 'Female',
}

export enum AuthProvider {
  LOCAL = 'local',
  MICROSOFT = 'microsoft',
  GOOGLE = 'google',
}

export enum DevelopmentOptionType {
  TASK_OFFLOADING = 'task_offloading',
  COACHING = 'coaching',
  LEARNING_SUBSIDY = 'learning_subsidy',
}

export enum RequestStatus {
  PENDING = 'pending',                    // Awaiting manager approval
  MANAGER_APPROVED = 'manager_approved',  // Manager approved, awaiting HR
  APPROVED = 'approved',                  // HR approved, tokens deducted
  REJECTED = 'rejected',                  // Rejected by manager or HR
  CANCELLED = 'cancelled',                // Cancelled by employee
}
