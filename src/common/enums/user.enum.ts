export enum UserRole {
  EMPLOYEE = 'employee',
  COACH = 'coach',
  APPROVER = 'approver',
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
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}
