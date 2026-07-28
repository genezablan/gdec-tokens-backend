import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  REIMBURSEMENT_TYPES,
  TRAINING_MODES,
} from './create-learning-subsidy-request.dto';

/**
 * Used for PATCH /token-requests/:id/resubmit
 * Only rejected requests can be resubmitted.
 * Send only the fields relevant to the request type — unrecognised fields are ignored.
 *
 * task_offloading:  { projectTitle?, startDate?, endDate?, projectDescription?,
 *                     scopeOfWork?, successMetrics?, expectedDeliverables?,
 *                     businessAlignment?, developmentGoals?, taskToOffload?,
 *                     colleagueName?, attachmentUrl? }
 * coaching:         { coachId?, notes?, focusArea?, developmentObjective?,
 *                     keyChallenges?, expectedOutcomes?, preferredSchedule?,
 *                     attachmentUrl? }
 * learning_subsidy: { subsidyAmount?, courseName?, provider?, modeOfTraining?,
 *                     totalCost?, learningDescription?, businessAlignment?,
 *                     applicationPlan?, duringWorkHours?, reimbursementType?,
 *                     startDate?, endDate?, attachmentUrl? }
 */
export class ResubmitTokenRequestDto {
  // ── shared ───────────────────────────────────────────────────────────────────

  /** New S3 URL for a supporting document. */
  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  /** Updated start date, ISO `YYYY-MM-DD` (task_offloading / learning_subsidy). */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** Updated end date, ISO `YYYY-MM-DD` (task_offloading / learning_subsidy). */
  @IsOptional()
  @IsDateString()
  endDate?: string;

  /** Updated business alignment (task_offloading / learning_subsidy). */
  @IsOptional()
  @IsString()
  businessAlignment?: string;

  // ── task_offloading ──────────────────────────────────────────────────────────

  /** Updated project title. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectTitle?: string;

  /** Updated request title (legacy key on pre-form-capture requests). */
  @IsOptional()
  @IsString()
  requestSubject?: string;

  /** Updated justification (legacy key on pre-form-capture requests). */
  @IsOptional()
  @IsString()
  reason?: string;

  /** Updated project description. */
  @IsOptional()
  @IsString()
  projectDescription?: string;

  /** Updated scope of work. */
  @IsOptional()
  @IsString()
  scopeOfWork?: string;

  /** Updated success metrics / KPIs. */
  @IsOptional()
  @IsString()
  successMetrics?: string;

  /** Updated expected deliverables. */
  @IsOptional()
  @IsString()
  expectedDeliverables?: string;

  /** Updated development goals. */
  @IsOptional()
  @IsString()
  developmentGoals?: string;

  /** Updated task to be offloaded. */
  @IsOptional()
  @IsString()
  taskToOffload?: string;

  /** Updated colleague taking over the task. */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  colleagueName?: string;

  // ── coaching ─────────────────────────────────────────────────────────────────

  /** Replace the selected coach (coaching). */
  @IsOptional()
  @IsUUID()
  coachId?: string;

  /** Update coaching goals/notes (legacy key). */
  @IsOptional()
  @IsString()
  notes?: string;

  /** Updated coaching focus area. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  focusArea?: string;

  /** Updated development objective. */
  @IsOptional()
  @IsString()
  developmentObjective?: string;

  /** Updated key challenges. */
  @IsOptional()
  @IsString()
  keyChallenges?: string;

  /** Updated expected outcomes after 3 sessions. */
  @IsOptional()
  @IsString()
  expectedOutcomes?: string;

  /** Updated preferred schedule (free text). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  preferredSchedule?: string;

  // ── learning_subsidy ─────────────────────────────────────────────────────────

  /** Updated subsidy amount in PHP (1000–3000). */
  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(3000)
  subsidyAmount?: number;

  /** Updated course name. */
  @IsOptional()
  @IsString()
  courseName?: string;

  /** Updated training provider. */
  @IsOptional()
  @IsString()
  provider?: string;

  /** Updated mode of training. */
  @IsOptional()
  @IsIn(TRAINING_MODES)
  modeOfTraining?: (typeof TRAINING_MODES)[number];

  /** Updated total training cost in PHP. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  totalCost?: number;

  /** Updated learning description. */
  @IsOptional()
  @IsString()
  learningDescription?: string;

  /** Updated application plan. */
  @IsOptional()
  @IsString()
  applicationPlan?: string;

  /** Updated during-work-hours flag. */
  @IsOptional()
  @IsBoolean()
  duringWorkHours?: boolean;

  /** Updated reimbursement type. */
  @IsOptional()
  @IsIn(REIMBURSEMENT_TYPES)
  reimbursementType?: (typeof REIMBURSEMENT_TYPES)[number];
}
