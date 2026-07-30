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

export enum CoachingSessionStatus {
  PENDING_COACH_APPROVAL = 'pending_coach_approval', // Booked by employee, awaiting coach confirmation
  SCHEDULED = 'scheduled',    // Coach confirmed — session is locked in
  PENDING_CANCELLATION = 'pending_cancellation', // Cancel requested by one party, awaiting the other's response
  PENDING_EMPLOYEE_APPROVAL = 'pending_employee_approval', // Coach proposed a (new) time, awaiting employee response
  COMPLETED = 'completed',    // Coach marked the session as done
  NO_SHOW = 'no_show',        // Employee did not attend
  CANCELLED = 'cancelled',    // Session was cancelled
  DECLINED = 'declined',      // Coach declined the booking request
}
