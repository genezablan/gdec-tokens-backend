import { IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/**
 * Used for PATCH /token-requests/:id/resubmit
 * Only rejected requests can be resubmitted.
 * Send only the fields relevant to the request type — unrecognised fields are ignored.
 *
 * task_offloading:  { attachmentUrl }
 * coaching:         { coachId?, notes?, attachmentUrl? }
 * learning_subsidy: { courseName?, provider?, subsidyAmount?, attachmentUrl? }
 */
export class ResubmitTokenRequestDto {
  // ── task_offloading ──────────────────────────────────────────────────────────

  /** New S3 URL for the completed form (task_offloading). */
  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  // ── coaching ─────────────────────────────────────────────────────────────────

  /** Replace the selected coach (coaching). */
  @IsOptional()
  @IsUUID()
  coachId?: string;

  /** Update coaching goals/notes (coaching). */
  @IsOptional()
  @IsString()
  notes?: string;

  // ── learning_subsidy ─────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  courseName?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  /** Updated subsidy amount in PHP (1000–3000). */
  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(3000)
  subsidyAmount?: number;
}
