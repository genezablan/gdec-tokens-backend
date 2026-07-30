import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export interface SendEmailRequest {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  htmlBody?: string;
  textBody?: string;
  fromName?: string;
  replyTo?: string;
}

export interface SendEmailResponse {
  messageId: string;
  success: boolean;
  message: string;
}

/** Use-it-or-lose-it reminder tiers, in calendar order. */
export type TokenReminderCheckpoint = 'Q1' | 'Q2' | 'Q3' | 'OCT' | 'NOV' | 'FINAL';

/**
 * Approval SLA policy (calendar days per approval stage). Referenced by the
 * reminder email copy and the ApprovalSlaService cron.
 */
export const APPROVAL_SLA_DAYS = 3;
export const APPROVAL_ESCALATION_DAYS = 6;

/**
 * How long an approver has to reverse their own approve/reject decision.
 * Measured from the moment the decision was written (TokenRequest.lastDecisionAt),
 * not from page load or email delivery.
 *
 * This is a ceiling, not a guarantee — an undo also dies the moment anything
 * downstream acts on the decision (HR approves, the employee resubmits or
 * cancels, a coaching session gets booked). See TokenRequestsService.undoDecision.
 *
 * The frontend mirrors this value in `src/constants/approval.js`; keep them in sync.
 */
export const APPROVAL_UNDO_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ─── Constants ────────────────────────────────────────────────────────────────

const BRAND = {
  primary: '#1E4DD6',
  primaryDark: '#1B3DB5',
  accent: '#FFC83D',
  success: '#36A54F',
  danger: '#FE3B32',
  pending: '#F8C246',
  body: '#F7F9FC',
  white: '#FFFFFF',
  textDark: '#1E1F23',
  textMuted: '#626260',
  border: '#E6EAF2',
};

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly sesClient: SESClient;
  private readonly fromEmail: string;
  private readonly frontendUrl: string;

  constructor(private readonly configService: ConfigService) {
    const accessKeyId = this.configService.get<string>('ses.accessKeyId');
    const secretAccessKey = this.configService.get<string>('ses.secretAccessKey');
    const region = this.configService.get<string>('ses.region') || 'ap-southeast-1';
    this.fromEmail = this.configService.get<string>('ses.fromEmail') || 'tokens@greatdealscorp.com';
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Missing required SES configuration variables');
    }

    this.sesClient = new SESClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  // ─── Core send ──────────────────────────────────────────────────────────────

  async sendEmail(emailRequest: SendEmailRequest): Promise<SendEmailResponse> {
    try {
      if (!emailRequest.to || (Array.isArray(emailRequest.to) && emailRequest.to.length === 0)) {
        throw new Error('Email recipient (to) is required');
      }
      if (!emailRequest.subject) throw new Error('Email subject is required');
      if (!emailRequest.htmlBody && !emailRequest.textBody) {
        throw new Error('Email body is required');
      }

      const toAddresses = Array.isArray(emailRequest.to) ? emailRequest.to : [emailRequest.to];
      const ccAddresses = emailRequest.cc
        ? Array.isArray(emailRequest.cc) ? emailRequest.cc : [emailRequest.cc]
        : [];
      const bccAddresses = emailRequest.bcc
        ? Array.isArray(emailRequest.bcc) ? emailRequest.bcc : [emailRequest.bcc]
        : [];

      const fromName = emailRequest.fromName || 'GDEC Development Tokens';
      const fromAddress = `${fromName} <${this.fromEmail}>`;

      const emailBody: {
        Html?: { Charset: string; Data: string };
        Text?: { Charset: string; Data: string };
      } = {};
      if (emailRequest.htmlBody) emailBody.Html = { Charset: 'UTF-8', Data: emailRequest.htmlBody };
      if (emailRequest.textBody) emailBody.Text = { Charset: 'UTF-8', Data: emailRequest.textBody };

      const command = new SendEmailCommand({
        Source: fromAddress,
        Destination: {
          ToAddresses: toAddresses,
          CcAddresses: ccAddresses.length > 0 ? ccAddresses : undefined,
          BccAddresses: bccAddresses.length > 0 ? bccAddresses : undefined,
        },
        Message: {
          Subject: { Charset: 'UTF-8', Data: emailRequest.subject },
          Body: emailBody,
        },
        ReplyToAddresses: emailRequest.replyTo ? [emailRequest.replyTo] : undefined,
      });

      const response = await this.sesClient.send(command);
      this.logger.log(`Email sent [${response.MessageId}] to ${toAddresses.join(', ')} — ${emailRequest.subject}`);

      return { messageId: response.MessageId || '', success: true, message: 'Email sent successfully' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send email to ${emailRequest.to}: ${msg}`);
      return { messageId: '', success: false, message: `Failed to send email: ${msg}` };
    }
  }

  // ─── Template builder ───────────────────────────────────────────────────────

  private buildTemplate(contentHtml: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>GDEC Development Tokens</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${BRAND.body};font-family:'Inter',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.body};padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${BRAND.white};border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:${BRAND.primary};padding:28px 40px;text-align:center;">
            <img src="${this.frontendUrl}/logo-dark.png" width="160" height="51" alt="Great Deals Academy" style="display:inline-block;border:0;outline:none;text-decoration:none;max-width:160px;height:auto;">
            <p style="margin:12px 0 0;color:${BRAND.white};font-size:20px;font-weight:700;font-family:'Poppins',Helvetica,Arial,sans-serif;letter-spacing:0.5px;">Development Tokens</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;color:${BRAND.textDark};font-size:15px;line-height:1.7;">
            ${contentHtml}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:${BRAND.body};padding:20px 40px;text-align:center;border-top:1px solid ${BRAND.border};">
            <p style="margin:0 0 4px;color:${BRAND.textMuted};font-size:13px;">Best regards,<br><strong style="color:${BRAND.textDark};">Great Deals Academy</strong></p>
            <p style="margin:10px 0 0;color:#9CA3AF;font-size:11px;">This is an automated message. Please do not reply to this email.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  /** Renders a labelled detail row for the details table. */
  private detailRow(label: string, value: string): string {
    return `
      <tr>
        <td style="padding:8px 0;color:${BRAND.textMuted};font-size:13px;width:180px;vertical-align:top;">${label}</td>
        <td style="padding:8px 0;color:${BRAND.textDark};font-size:14px;font-weight:600;vertical-align:top;">${value}</td>
      </tr>`;
  }

  /** Renders a CTA button. Light accent/pending backgrounds get dark text; saturated ones get white. */
  private button(label: string, href: string, color: string = BRAND.primary): string {
    const lightBg = color === BRAND.accent || color === BRAND.pending;
    return `
      <table cellpadding="0" cellspacing="0" style="margin-top:24px;">
        <tr>
          <td style="background:${color};border-radius:8px;padding:12px 28px;">
            <a href="${href}" style="color:${lightBg ? BRAND.primaryDark : BRAND.white};font-size:14px;font-weight:700;text-decoration:none;">${label}</a>
          </td>
        </tr>
      </table>`;
  }

  /** Formats a Date as "February 20, 2026". */
  private formatDate(d: Date): string {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // ─── Notification methods ───────────────────────────────────────────────────

  /**
   * [TO EMPLOYEE] Sent immediately after they submit a token request.
   */
  async sendSubmissionConfirmation(opts: {
    employeeEmail: string;
    employeeName: string;
    optionName: string;
    tokenCost: number;
    submissionDate: Date;
  }): Promise<void> {
    const { employeeEmail, employeeName, optionName, tokenCost, submissionDate } = opts;

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${employeeName}</strong>,</p>
      <p style="margin:0 0 20px;">Your Development Token request has been <strong>successfully submitted</strong>. Here are the details:</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};border-left:none;border-right:none;margin:0 0 24px;">
        ${this.detailRow('Development Option:', optionName)}
        ${this.detailRow('Tokens Used:', `${tokenCost} token${tokenCost !== 1 ? 's' : ''}`)}
        ${this.detailRow('Submission Date:', this.formatDate(submissionDate))}
      </table>

      <p style="margin:0 0 8px;color:${BRAND.textMuted};font-size:14px;">Your request is now under review. You will be notified once your Manager and/or HR has taken action.</p>
      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">You may track the status of your request anytime via the application.</p>

      ${this.button('View My Request', `${this.frontendUrl}/my-request`)}
    `;

    await this.sendEmail({
      to: employeeEmail,
      subject: 'Development Token Request Submitted',
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${employeeName},\n\nYour Development Token request has been successfully submitted.\n\nDevelopment Option: ${optionName}\nTokens Used: ${tokenCost}\nSubmission Date: ${this.formatDate(submissionDate)}\n\nYour request is now under review. You will be notified once your Manager and/or HR has taken action.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO MANAGER/COACH] Sent when a new request needs first-level review.
   */
  async sendFirstLevelReviewNotification(opts: {
    approverEmail: string;
    approverName: string;
    approverRole: 'Manager' | 'Coach';
    employeeName: string;
    optionName: string;
    tokenCost: number;
    submissionDate: Date;
    requestId: string;
  }): Promise<void> {
    const { approverEmail, approverName, approverRole, employeeName, optionName, tokenCost, submissionDate, requestId } = opts;

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${approverName}</strong>,</p>
      <p style="margin:0 0 20px;"><strong>${employeeName}</strong> has submitted a Development Token request that requires your review as their <strong>${approverRole}</strong>.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Employee:', employeeName)}
        ${this.detailRow('Development Option:', optionName)}
        ${this.detailRow('Tokens Requested:', `${tokenCost} token${tokenCost !== 1 ? 's' : ''}`)}
        ${this.detailRow('Submitted On:', this.formatDate(submissionDate))}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">Please log in to the application to review and take action on this request.</p>
      ${this.button('Review Request', `${this.frontendUrl}/approval`)}
    `;

    await this.sendEmail({
      to: approverEmail,
      subject: `Action Required: Development Token Request — ${employeeName}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${approverName},\n\n${employeeName} has submitted a Development Token request requiring your review.\n\nEmployee: ${employeeName}\nDevelopment Option: ${optionName}\nTokens Requested: ${tokenCost}\nSubmitted On: ${this.formatDate(submissionDate)}\n\nLog in to the application to review.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO HR] Sent after manager/coach approves. Awaiting final HR review.
   */
  async sendHrReviewNotification(opts: {
    hrEmail: string;
    hrName: string;
    employeeName: string;
    optionName: string;
    tokenCost: number;
    firstApproverName: string;
    firstApproverRole: 'Manager' | 'Coach';
    requestId: string;
  }): Promise<void> {
    const { hrEmail, hrName, employeeName, optionName, tokenCost, firstApproverName, firstApproverRole, requestId } = opts;

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${hrName}</strong>,</p>
      <p style="margin:0 0 20px;">A Development Token request from <strong>${employeeName}</strong> has been approved by their ${firstApproverRole} (<strong>${firstApproverName}</strong>) and is now awaiting your final review.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Employee:', employeeName)}
        ${this.detailRow('Development Option:', optionName)}
        ${this.detailRow('Tokens to Deduct:', `${tokenCost} token${tokenCost !== 1 ? 's' : ''}`)}
        ${this.detailRow(`${firstApproverRole}:`, firstApproverName)}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">Tokens will only be deducted from the employee's balance upon your final approval.</p>
      ${this.button('Review Request', `${this.frontendUrl}/approval`)}
    `;

    await this.sendEmail({
      to: hrEmail,
      subject: `Action Required: Token Request Pending Final Review — ${employeeName}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${hrName},\n\n${employeeName}'s Development Token request has been approved by their ${firstApproverRole} (${firstApproverName}) and needs your final review.\n\nEmployee: ${employeeName}\nDevelopment Option: ${optionName}\nTokens to Deduct: ${tokenCost}\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO APPROVER or ESCALATION CONTACT] A request has sat in someone's queue
   * past the approval SLA. `escalation` switches the wording from "your queue"
   * to "an overdue request you should chase".
   */
  async sendApprovalSlaReminderEmail(opts: {
    recipientEmail: string;
    recipientName: string;
    employeeName: string;
    optionName: string;
    stage: 'Manager' | 'Coach' | 'HR';
    daysPending: number;
    escalation: boolean;
  }): Promise<void> {
    const { recipientEmail, recipientName, employeeName, optionName, stage, daysPending, escalation } = opts;

    const intro = escalation
      ? `A Development Token request from <strong>${employeeName}</strong> has been waiting for <strong>${stage}</strong> approval for <strong>${daysPending} days</strong> — past the escalation threshold. Please follow up with the approver or action it directly.`
      : `A Development Token request from <strong>${employeeName}</strong> has been waiting in your queue for <strong>${daysPending} days</strong>, which is past the ${APPROVAL_SLA_DAYS}-day approval SLA.`;

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${recipientName}</strong>,</p>
      <p style="margin:0 0 20px;">${intro}</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Employee:', employeeName)}
        ${this.detailRow('Development Option:', optionName)}
        ${this.detailRow('Approval Stage:', stage)}
        ${this.detailRow('Days Waiting:', `${daysPending}`)}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">Employees can't plan their development while a request is undecided — a quick approve or reject keeps the program moving.</p>
      ${this.button('Review Request', `${this.frontendUrl}/approval`)}
    `;

    await this.sendEmail({
      to: recipientEmail,
      subject: escalation
        ? `Escalation: Token Request Overdue ${daysPending} Days — ${employeeName}`
        : `Reminder: Token Request Awaiting Your Review — ${employeeName}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${recipientName},\n\n${employeeName}'s Development Token request (${optionName}) has been waiting ${daysPending} days at the ${stage} approval stage.\n\nPlease log in to review it.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO MANAGER / HR] Sent when an employee withdraws a request that had already
   * been reviewed, so the approvers who acted on it (or still have it queued)
   * know it has left their queue. No tokens were deducted.
   */
  async sendRequestCancelledNotification(opts: {
    approverEmail: string;
    approverName: string;
    employeeName: string;
    optionName: string;
    tokenCost: number;
    wasManagerApproved: boolean;
    /** First-level approver for this request type — 'coach' for coaching. */
    approverRole: 'manager' | 'coach';
  }): Promise<void> {
    const {
      approverEmail,
      approverName,
      employeeName,
      optionName,
      tokenCost,
      wasManagerApproved,
      approverRole,
    } = opts;

    const stage = wasManagerApproved
      ? `after ${approverRole} approval, while it was awaiting HR review`
      : 'while it was awaiting review';

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${approverName}</strong>,</p>
      <p style="margin:0 0 20px;"><strong>${employeeName}</strong> has cancelled their Development Token request ${stage}. No action is needed from you — the request has been removed from your queue.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Employee:', employeeName)}
        ${this.detailRow('Development Option:', optionName)}
        ${this.detailRow('Tokens Reserved:', `${tokenCost} token${tokenCost !== 1 ? 's' : ''}`)}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">No tokens were deducted for this request.</p>
      ${this.button('View Requests', `${this.frontendUrl}/approval`)}
    `;

    await this.sendEmail({
      to: approverEmail,
      subject: `Token Request Cancelled — ${employeeName}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${approverName},\n\n${employeeName} has cancelled their Development Token request ${stage}. No action is needed from you.\n\nEmployee: ${employeeName}\nDevelopment Option: ${optionName}\nTokens Reserved: ${tokenCost}\n\nNo tokens were deducted for this request.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO EMPLOYEE] Sent after HR gives final approval.
   */
  async sendApprovalNotification(opts: {
    employeeEmail: string;
    employeeName: string;
    optionName: string;
    tokenCost: number;
    requestId?: string;
    type?: string;
  }): Promise<void>;
  /** @deprecated use object overload */
  async sendApprovalNotification(email: string, name: string, optionName: string): Promise<void>;
  async sendApprovalNotification(
    optsOrEmail: { employeeEmail: string; employeeName: string; optionName: string; tokenCost: number; requestId?: string; type?: string } | string,
    name?: string,
    optionNameArg?: string,
  ): Promise<void> {
    const opts = typeof optsOrEmail === 'string'
      ? { employeeEmail: optsOrEmail, employeeName: name!, optionName: optionNameArg!, tokenCost: 0 }
      : optsOrEmail;

    const { employeeEmail, employeeName, optionName, tokenCost, requestId, type } = opts;

    const content = `
      <p style="margin:0 0 4px;">Hi <strong>${employeeName}</strong>,</p>
      <p style="margin:0 0 20px;font-size:15px;"><strong>Good news!</strong><br>Your Development Token request has been approved.</p>

      <p style="margin:0 0 8px;font-weight:600;color:${BRAND.textDark};">Request Summary:</p>
      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 20px;">
        ${this.detailRow('Development Option:', optionName)}
        ${this.detailRow('Tokens Deducted:', `${tokenCost} token${tokenCost !== 1 ? 's' : ''}`)}
        ${this.detailRow('Status:', `<span style="color:${BRAND.success};font-weight:600;">Approved</span>`)}
      </table>

      <p style="margin:0 0 12px;color:${BRAND.textDark};">You may now proceed with your development activity. Please remember to upload the required completion documents once finished.</p>
      <p style="margin:0 0 20px;color:${BRAND.textDark};">If coaching sessions are included, scheduling details will be shared separately.</p>

      ${type === 'coaching' && requestId
        ? this.button('View My Sessions', `${this.frontendUrl}/coaching/${requestId}/sessions`, BRAND.success)
        : this.button('View My Request', `${this.frontendUrl}/my-request`, BRAND.success)}
    `;

    await this.sendEmail({
      to: employeeEmail,
      subject: 'Your Development Token Request Has Been Approved',
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${employeeName},\n\nGood news!\nYour Development Token request has been approved.\n\nRequest Summary:\n- Development Option: ${optionName}\n- Tokens Deducted: ${tokenCost} token${tokenCost !== 1 ? 's' : ''}\n- Status: Approved\n\nYou may now proceed with your development activity. Please remember to upload the required completion documents once finished.\n\nIf coaching sessions are included, scheduling details will be shared separately.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO EMPLOYEE] Sent when a request is rejected at any level.
   */
  async sendRejectionNotification(opts: {
    employeeEmail: string;
    employeeName: string;
    optionName: string;
    comment: string;
  }): Promise<void>;
  /** @deprecated use object overload */
  async sendRejectionNotification(email: string, name: string, optionName: string, comment: string): Promise<void>;
  async sendRejectionNotification(
    optsOrEmail: { employeeEmail: string; employeeName: string; optionName: string; comment: string } | string,
    name?: string,
    optionNameArg?: string,
    commentArg?: string,
  ): Promise<void> {
    const opts = typeof optsOrEmail === 'string'
      ? { employeeEmail: optsOrEmail, employeeName: name!, optionName: optionNameArg!, comment: commentArg! }
      : optsOrEmail;

    const { employeeEmail, employeeName, optionName, comment } = opts;

    const content = `
      <p style="margin:0 0 20px;">Hello <strong>${employeeName}</strong>,</p>
      <p style="margin:0 0 20px;color:${BRAND.textDark};">Your Development Token request has been reviewed and was not approved at this time.</p>

      <p style="margin:0 0 8px;font-weight:600;color:${BRAND.textDark};">Reason / Remarks:</p>
      <div style="background:${BRAND.body};border-left:4px solid ${BRAND.danger};padding:12px 16px;margin:0 0 20px;border-radius:0 4px 4px 0;color:${BRAND.textDark};">${comment}</div>

      <p style="margin:0 0 12px;color:${BRAND.textDark};">You may revise and resubmit your request through the application once the necessary updates are made.</p>
      <p style="margin:0 0 20px;color:${BRAND.textDark};">If you need clarification, please reach out to your Manager or HR.</p>

      ${this.button('Resubmit Request', `${this.frontendUrl}/my-request`, BRAND.primary)}
    `;

    await this.sendEmail({
      to: employeeEmail,
      subject: 'Update on Your Development Token Request — Rejected',
      htmlBody: this.buildTemplate(content),
      textBody: `Hello ${employeeName},\n\nYour Development Token request has been reviewed and was not approved at this time.\n\nReason / Remarks:\n${comment}\n\nYou may revise and resubmit your request through the application once the necessary updates are made.\n\nIf you need clarification, please reach out to your Manager or HR.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO EMPLOYEE] Sent when an approver reverses their own approve/reject within
   * the undo window. The employee has almost certainly already been told the
   * original outcome, so this email leads with what changed and why the earlier
   * message no longer applies.
   */
  async sendDecisionReversedNotification(opts: {
    employeeEmail: string;
    employeeName: string;
    optionName: string;
    /** What was undone, from the employee's point of view. */
    reversed: 'approval' | 'rejection';
    /** Where the request sits now. */
    stageLabel: string;
    /** Tokens returned to the balance — 0 when the undone decision never deducted. */
    tokensRefunded: number;
    /** Role of the person who reversed it. */
    actorRole: 'manager' | 'coach' | 'HR' | 'administrator';
  }): Promise<void> {
    const {
      employeeEmail,
      employeeName,
      optionName,
      reversed,
      stageLabel,
      tokensRefunded,
      actorRole,
    } = opts;

    const headline =
      reversed === 'approval'
        ? `The earlier approval of your Development Token request has been withdrawn by your ${actorRole}, so the approval notice you received no longer applies.`
        : `The earlier decision on your Development Token request has been withdrawn by your ${actorRole} — it was not rejected after all, and the rejection notice you received no longer applies.`;

    const refundLine =
      tokensRefunded > 0
        ? `<p style="margin:0 0 20px;color:${BRAND.textDark};"><strong>${tokensRefunded} token${tokensRefunded !== 1 ? 's' : ''}</strong> ${tokensRefunded !== 1 ? 'have' : 'has'} been returned to your balance.</p>`
        : '';

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${employeeName}</strong>,</p>
      <p style="margin:0 0 20px;color:${BRAND.textDark};">${headline}</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 20px;">
        ${this.detailRow('Development Option:', optionName)}
        ${this.detailRow('Current Status:', `<span style="color:${BRAND.pending};font-weight:600;">${stageLabel}</span>`)}
        ${tokensRefunded > 0 ? this.detailRow('Tokens Returned:', `${tokensRefunded} token${tokensRefunded !== 1 ? 's' : ''}`) : ''}
      </table>

      ${refundLine}
      <p style="margin:0 0 20px;color:${BRAND.textDark};">Your request is back in the approval queue and will be reviewed again. No action is needed from you. If you have questions about why this changed, please reach out to your ${actorRole}.</p>

      ${this.button('View My Request', `${this.frontendUrl}/my-request`)}
    `;

    await this.sendEmail({
      to: employeeEmail,
      subject: `Correction: Your Development Token Request Is Back Under Review`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${employeeName},\n\n${headline.replace(/<[^>]+>/g, '')}\n\nDevelopment Option: ${optionName}\nCurrent Status: ${stageLabel}${tokensRefunded > 0 ? `\nTokens Returned: ${tokensRefunded}` : ''}\n\nYour request is back in the approval queue and will be reviewed again. No action is needed from you. If you have questions about why this changed, please reach out to your ${actorRole}.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * @deprecated Use sendFirstLevelReviewNotification instead.
   * Kept for backward compatibility.
   */
  async sendRequestNotification(
    approverEmail: string,
    employeeName: string,
    requestType: string,
    requestId: string,
  ): Promise<void> {
    await this.sendFirstLevelReviewNotification({
      approverEmail,
      approverName: 'Approver',
      approverRole: 'Manager',
      employeeName,
      optionName: requestType,
      tokenCost: 0,
      submissionDate: new Date(),
      requestId,
    });
  }

  /**
   * [TO EMPLOYEE] Sent when a password reset is requested.
   */
  async sendPasswordResetEmail(opts: {
    email: string;
    name: string;
    resetLink: string;
    expiryMinutes: number;
  }): Promise<void> {
    const { email, name, resetLink, expiryMinutes } = opts;

    const content = `
      <p style="margin:0 0 20px;">Hello <strong>${name}</strong>,</p>
      <p style="margin:0 0 20px;color:${BRAND.textDark};">We received a request to reset your password for your Great Deals Academy account. Click the button below to set a new password.</p>

      <p style="margin:0 0 20px;">${this.button('Reset My Password', resetLink, BRAND.primary)}</p>

      <p style="margin:0 0 12px;color:${BRAND.textMuted};font-size:13px;">This link will expire in <strong>${expiryMinutes} minutes</strong>. If you did not request a password reset, you can safely ignore this email — your password will not be changed.</p>
      <p style="margin:0;color:${BRAND.textMuted};font-size:13px;">If you need help, please reach out to HR.</p>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Reset Your Great Deals Academy Password',
      htmlBody: this.buildTemplate(content),
      textBody: `Hello ${name},\n\nWe received a request to reset your password.\n\nReset your password here:\n${resetLink}\n\nThis link expires in ${expiryMinutes} minutes.\n\nIf you did not request this, ignore this email.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  // ─── Coaching Session Notifications ────────────────────────────────────────

  /**
   * [TO COACH] Sent when an employee books a session — awaiting coach confirmation.
   */
  async sendSessionBookingRequestNotification(opts: {
    coachEmail: string;
    coachName: string;
    employeeName: string;
    sessionNumber: number;
    scheduledAt: Date;
  }): Promise<void> {
    const { coachEmail, coachName, employeeName, sessionNumber, scheduledAt } = opts;
    const dateStr = this.formatDateTime(scheduledAt);

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${coachName}</strong>,</p>
      <p style="margin:0 0 20px;"><strong>${employeeName}</strong> has requested to book a coaching session with you. Please review and confirm or decline.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Employee:', employeeName)}
        ${this.detailRow('Session:', `Session ${sessionNumber} of 3`)}
        ${this.detailRow('Requested Date & Time:', dateStr)}
      </table>

      <p style="margin:0 0 20px;color:${BRAND.textMuted};font-size:14px;">Log in to the application to confirm or decline this session request.</p>
      ${this.button('Go to My Sessions', `${this.frontendUrl}/coach/sessions`, BRAND.primary)}
    `;

    await this.sendEmail({
      to: coachEmail,
      subject: `Session Booking Request — ${employeeName} (Session ${sessionNumber})`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${coachName},\n\n${employeeName} has requested to book Session ${sessionNumber} of 3 with you.\n\nDate & Time: ${dateStr}\n\nPlease log in to confirm or decline.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO EMPLOYEE] Sent when the coach confirms a session booking.
   */
  async sendSessionConfirmedNotification(opts: {
    employeeEmail: string;
    employeeName: string;
    coachName: string;
    sessionNumber: number;
    scheduledAt: Date;
    requestId: string;
  }): Promise<void> {
    const { employeeEmail, employeeName, coachName, sessionNumber, scheduledAt, requestId } = opts;
    const dateStr = this.formatDateTime(scheduledAt);

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${employeeName}</strong>,</p>
      <p style="margin:0 0 20px;">Great news! Your coaching session has been <strong style="color:${BRAND.success};">confirmed</strong> by your coach.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Coach:', coachName)}
        ${this.detailRow('Session:', `Session ${sessionNumber} of 3`)}
        ${this.detailRow('Date & Time:', dateStr)}
        ${this.detailRow('Status:', `<span style="color:${BRAND.success};font-weight:600;">Confirmed</span>`)}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">Please make sure to attend on time. You may view your session details in the application.</p>
      ${this.button('View My Sessions', `${this.frontendUrl}/coaching/${requestId}/sessions`, BRAND.success)}
    `;

    await this.sendEmail({
      to: employeeEmail,
      subject: `Coaching Session Confirmed — Session ${sessionNumber}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${employeeName},\n\nYour coaching session has been confirmed.\n\nCoach: ${coachName}\nSession: Session ${sessionNumber} of 3\nDate & Time: ${dateStr}\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO EMPLOYEE] Sent when the coach declines a session booking.
   */
  async sendSessionDeclinedNotification(opts: {
    employeeEmail: string;
    employeeName: string;
    coachName: string;
    sessionNumber: number;
    scheduledAt: Date;
    requestId: string;
  }): Promise<void> {
    const { employeeEmail, employeeName, coachName, sessionNumber, scheduledAt, requestId } = opts;
    const dateStr = this.formatDateTime(scheduledAt);

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${employeeName}</strong>,</p>
      <p style="margin:0 0 20px;">Unfortunately, your coach has <strong style="color:${BRAND.danger};">declined</strong> your session booking request. Please select a different available slot and try again.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Coach:', coachName)}
        ${this.detailRow('Session:', `Session ${sessionNumber} of 3`)}
        ${this.detailRow('Requested Time:', dateStr)}
        ${this.detailRow('Status:', `<span style="color:${BRAND.danger};font-weight:600;">Declined</span>`)}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">The slot has been released — you can now choose another available time from your coach's schedule.</p>
      ${this.button('Book a New Slot', `${this.frontendUrl}/coaching/${requestId}/sessions`, BRAND.accent)}
    `;

    await this.sendEmail({
      to: employeeEmail,
      subject: `Coaching Session Declined — Please Rebook (Session ${sessionNumber})`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${employeeName},\n\nYour coach (${coachName}) has declined your Session ${sessionNumber} booking for ${dateStr}.\n\nThe slot has been released. Please log in to select another available slot.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO EMPLOYEE] Sent when the coach marks a session as completed.
   */
  async sendSessionCompletedNotification(opts: {
    employeeEmail: string;
    employeeName: string;
    coachName: string;
    sessionNumber: number;
    scheduledAt: Date;
    sessionNotes?: string | null;
    requestId: string;
  }): Promise<void> {
    const { employeeEmail, employeeName, coachName, sessionNumber, scheduledAt, sessionNotes, requestId } = opts;
    const dateStr = this.formatDateTime(scheduledAt);

    const notesRow = sessionNotes
      ? `<p style="margin:0 0 8px;font-weight:600;color:${BRAND.textDark};">Coach Notes:</p>
         <div style="background:${BRAND.body};border-left:4px solid ${BRAND.success};padding:12px 16px;margin:0 0 20px;border-radius:0 4px 4px 0;color:${BRAND.textDark};">${sessionNotes}</div>`
      : '';

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${employeeName}</strong>,</p>
      <p style="margin:0 0 20px;">Your coach has marked Session ${sessionNumber} as <strong style="color:${BRAND.success};">completed</strong>.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Coach:', coachName)}
        ${this.detailRow('Session:', `Session ${sessionNumber} of 3`)}
        ${this.detailRow('Date:', dateStr)}
      </table>

      ${notesRow}

      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">Keep up the great work! Check the application to see your overall progress.</p>
      ${this.button('View My Sessions', `${this.frontendUrl}/coaching/${requestId}/sessions`, BRAND.success)}
    `;

    const notesSection = sessionNotes ? `\n\nCoach Notes:\n${sessionNotes}` : '';
    await this.sendEmail({
      to: employeeEmail,
      subject: `Session ${sessionNumber} Completed — Great Job!`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${employeeName},\n\nYour coach has marked Session ${sessionNumber} of 3 as completed.\n\nCoach: ${coachName}\nDate: ${dateStr}${notesSection}\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO EMPLOYEE] Sent when the coach marks the employee as a no-show.
   */
  async sendSessionNoShowNotification(opts: {
    employeeEmail: string;
    employeeName: string;
    coachName: string;
    sessionNumber: number;
    scheduledAt: Date;
    requestId: string;
  }): Promise<void> {
    const { employeeEmail, employeeName, coachName, sessionNumber, scheduledAt, requestId } = opts;
    const dateStr = this.formatDateTime(scheduledAt);

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${employeeName}</strong>,</p>
      <p style="margin:0 0 20px;">Your coach has recorded a <strong style="color:${BRAND.danger};">no-show</strong> for your scheduled coaching session. The slot has been released so you can reschedule.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Coach:', coachName)}
        ${this.detailRow('Session:', `Session ${sessionNumber} of 3`)}
        ${this.detailRow('Scheduled Time:', dateStr)}
        ${this.detailRow('Status:', `<span style="color:${BRAND.danger};font-weight:600;">No-show</span>`)}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">Please book a new slot to complete this session. If you believe this is an error, contact your coach or HR.</p>
      ${this.button('Reschedule Session', `${this.frontendUrl}/coaching/${requestId}/sessions`, BRAND.accent)}
    `;

    await this.sendEmail({
      to: employeeEmail,
      subject: `Coaching Session No-Show Recorded — Session ${sessionNumber}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${employeeName},\n\nA no-show has been recorded for your coaching Session ${sessionNumber} (${dateStr}) with ${coachName}.\n\nThe slot has been released. Please log in to reschedule.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO THE OTHER PARTY] Sent when either the employee or the coach requests
   * to cancel a confirmed session — the recipient must approve or keep it.
   */
  async sendSessionCancelRequestedNotification(opts: {
    recipientEmail: string;
    recipientName: string;
    requesterName: string;
    sessionNumber: number;
    scheduledAt: Date;
    reason?: string | null;
    requestId: string;
  }): Promise<void> {
    const { recipientEmail, recipientName, requesterName, sessionNumber, scheduledAt, reason, requestId } = opts;
    const dateStr = this.formatDateTime(scheduledAt);
    const reasonRow = reason
      ? `<div style="background:${BRAND.body};border-left:4px solid ${BRAND.pending};padding:12px 16px;margin:0 0 20px;border-radius:0 4px 4px 0;color:${BRAND.textDark};">${reason}</div>`
      : '';

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${recipientName}</strong>,</p>
      <p style="margin:0 0 20px;"><strong>${requesterName}</strong> has requested to cancel a confirmed coaching session. It will only be cancelled if you approve — otherwise it stays scheduled.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Requested by:', requesterName)}
        ${this.detailRow('Session:', `Session ${sessionNumber} of 3`)}
        ${this.detailRow('Scheduled Time:', dateStr)}
      </table>
      ${reasonRow}

      <p style="margin:0 0 20px;color:${BRAND.textMuted};font-size:14px;">Log in to approve the cancellation or keep the session as-is.</p>
      ${this.button('Review Request', `${this.frontendUrl}/coaching/${requestId}/sessions`, BRAND.pending)}
    `;

    await this.sendEmail({
      to: recipientEmail,
      subject: `Cancellation Requested — Session ${sessionNumber} (Action Needed)`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${recipientName},\n\n${requesterName} requested to cancel Session ${sessionNumber} of 3 (${dateStr}).${reason ? `\n\nReason: ${reason}` : ''}\n\nIt only cancels if you approve. Please log in to respond.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO REQUESTER] Sent when the other party approves a cancellation request.
   */
  async sendSessionCancelApprovedNotification(opts: {
    recipientEmail: string;
    recipientName: string;
    approverName: string;
    sessionNumber: number;
    scheduledAt: Date;
  }): Promise<void> {
    const { recipientEmail, recipientName, approverName, sessionNumber, scheduledAt } = opts;
    const dateStr = this.formatDateTime(scheduledAt);

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${recipientName}</strong>,</p>
      <p style="margin:0 0 20px;"><strong>${approverName}</strong> approved your request to cancel Session ${sessionNumber}. The session is now <strong style="color:${BRAND.danger};">cancelled</strong> and the slot has been released.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Session:', `Session ${sessionNumber} of 3`)}
        ${this.detailRow('Was scheduled for:', dateStr)}
        ${this.detailRow('Status:', `<span style="color:${BRAND.danger};font-weight:600;">Cancelled</span>`)}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">You can book a new slot for this session whenever you're ready.</p>
    `;

    await this.sendEmail({
      to: recipientEmail,
      subject: `Session ${sessionNumber} Cancellation Approved`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${recipientName},\n\n${approverName} approved your request to cancel Session ${sessionNumber} of 3 (${dateStr}). The slot has been released — you can book a new one anytime.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO REQUESTER] Sent when the other party declines a cancellation request.
   */
  async sendSessionCancelDeclinedNotification(opts: {
    recipientEmail: string;
    recipientName: string;
    declinerName: string;
    sessionNumber: number;
    scheduledAt: Date;
    requestId: string;
  }): Promise<void> {
    const { recipientEmail, recipientName, declinerName, sessionNumber, scheduledAt, requestId } = opts;
    const dateStr = this.formatDateTime(scheduledAt);

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${recipientName}</strong>,</p>
      <p style="margin:0 0 20px;"><strong>${declinerName}</strong> declined your request to cancel Session ${sessionNumber}. The session remains <strong style="color:${BRAND.success};">scheduled</strong> as before.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Session:', `Session ${sessionNumber} of 3`)}
        ${this.detailRow('Scheduled Time:', dateStr)}
        ${this.detailRow('Status:', `<span style="color:${BRAND.success};font-weight:600;">Scheduled</span>`)}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">If you still need to cancel, reach out to them directly or submit a new request.</p>
      ${this.button('View My Sessions', `${this.frontendUrl}/coaching/${requestId}/sessions`, BRAND.primary)}
    `;

    await this.sendEmail({
      to: recipientEmail,
      subject: `Session ${sessionNumber} Cancellation Declined`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${recipientName},\n\n${declinerName} declined your request to cancel Session ${sessionNumber} of 3 (${dateStr}). The session remains scheduled.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO EMPLOYEE] Sent when the coach proposes a (new) time for a session —
   * the employee must accept, reject, or ask for another date.
   */
  async sendSessionTimeProposedNotification(opts: {
    employeeEmail: string;
    employeeName: string;
    coachName: string;
    sessionNumber: number;
    currentScheduledAt: Date;
    proposedAt: Date;
    note?: string | null;
    requestId: string;
  }): Promise<void> {
    const { employeeEmail, employeeName, coachName, sessionNumber, currentScheduledAt, proposedAt, note, requestId } = opts;
    const currentStr = this.formatDateTime(currentScheduledAt);
    const proposedStr = this.formatDateTime(proposedAt);
    const noteRow = note
      ? `<div style="background:${BRAND.body};border-left:4px solid ${BRAND.pending};padding:12px 16px;margin:0 0 20px;border-radius:0 4px 4px 0;color:${BRAND.textDark};">${note}</div>`
      : '';

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${employeeName}</strong>,</p>
      <p style="margin:0 0 20px;"><strong>${coachName}</strong> has proposed a <strong>new time</strong> for your coaching session. Please accept it, reject it, or ask for a different date.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Coach:', coachName)}
        ${this.detailRow('Session:', `Session ${sessionNumber} of 3`)}
        ${this.detailRow('Current Time:', currentStr)}
        ${this.detailRow('Proposed Time:', `<span style="color:${BRAND.primary};font-weight:700;">${proposedStr}</span>`)}
      </table>
      ${noteRow}

      <p style="margin:0 0 20px;color:${BRAND.textMuted};font-size:14px;">Nothing changes until you respond — the session keeps its current time for now.</p>
      ${this.button('Review Proposal', `${this.frontendUrl}/coaching/${requestId}/sessions`, BRAND.pending)}
    `;

    await this.sendEmail({
      to: employeeEmail,
      subject: `New Time Proposed — Session ${sessionNumber} (Action Needed)`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${employeeName},\n\n${coachName} proposed a new time for Session ${sessionNumber} of 3.\n\nCurrent Time: ${currentStr}\nProposed Time: ${proposedStr}${note ? `\n\nNote from your coach: ${note}` : ''}\n\nPlease log in to accept, reject, or ask for a different date.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO COACH] Sent when the employee accepts the proposed time.
   */
  async sendProposalAcceptedNotification(opts: {
    coachEmail: string;
    coachName: string;
    employeeName: string;
    sessionNumber: number;
    scheduledAt: Date;
  }): Promise<void> {
    const { coachEmail, coachName, employeeName, sessionNumber, scheduledAt } = opts;
    const dateStr = this.formatDateTime(scheduledAt);

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${coachName}</strong>,</p>
      <p style="margin:0 0 20px;"><strong>${employeeName}</strong> accepted your proposed time. The session is now <strong style="color:${BRAND.success};">scheduled</strong>.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Employee:', employeeName)}
        ${this.detailRow('Session:', `Session ${sessionNumber} of 3`)}
        ${this.detailRow('New Date & Time:', dateStr)}
        ${this.detailRow('Status:', `<span style="color:${BRAND.success};font-weight:600;">Scheduled</span>`)}
      </table>

      ${this.button('Go to My Sessions', `${this.frontendUrl}/coach/sessions`, BRAND.success)}
    `;

    await this.sendEmail({
      to: coachEmail,
      subject: `Proposed Time Accepted — Session ${sessionNumber}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${coachName},\n\n${employeeName} accepted your proposed time for Session ${sessionNumber} of 3.\n\nNew Date & Time: ${dateStr}\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO COACH] Sent when the employee rejects the proposed time. The copy
   * depends on what the rejection resolved to:
   * - declined  — the underlying booking request was declined
   * - reverted  — the session stays scheduled at its original time
   * - cancelled — the pending cancellation went through
   */
  async sendProposalRejectedNotification(opts: {
    coachEmail: string;
    coachName: string;
    employeeName: string;
    sessionNumber: number;
    outcome: 'declined' | 'reverted' | 'cancelled';
    reason?: string | null;
    requestId: string;
  }): Promise<void> {
    const { coachEmail, coachName, employeeName, sessionNumber, outcome, reason } = opts;
    const outcomeCopy =
      outcome === 'declined'
        ? `The booking request has been <strong style="color:${BRAND.danger};">declined</strong> — the employee can pick a different slot.`
        : outcome === 'cancelled'
          ? `The pending cancellation went through — the session is now <strong style="color:${BRAND.danger};">cancelled</strong>.`
          : `The session stays <strong style="color:${BRAND.success};">scheduled</strong> at its original time.`;
    const outcomeText =
      outcome === 'declined'
        ? 'The booking request has been declined — the employee can pick a different slot.'
        : outcome === 'cancelled'
          ? 'The pending cancellation went through — the session is now cancelled.'
          : 'The session stays scheduled at its original time.';
    const reasonRow = reason
      ? `<div style="background:${BRAND.body};border-left:4px solid ${BRAND.danger};padding:12px 16px;margin:0 0 20px;border-radius:0 4px 4px 0;color:${BRAND.textDark};">${reason}</div>`
      : '';

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${coachName}</strong>,</p>
      <p style="margin:0 0 20px;"><strong>${employeeName}</strong> rejected your proposed time for Session ${sessionNumber}. ${outcomeCopy}</p>
      ${reasonRow}

      ${this.button('Go to My Sessions', `${this.frontendUrl}/coach/sessions`, BRAND.primary)}
    `;

    await this.sendEmail({
      to: coachEmail,
      subject: `Proposed Time Rejected — Session ${sessionNumber}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${coachName},\n\n${employeeName} rejected your proposed time for Session ${sessionNumber} of 3. ${outcomeText}${reason ? `\n\nReason: ${reason}` : ''}\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO COACH] Sent when the employee asks for a different time instead of
   * accepting or rejecting the proposal.
   */
  async sendNewTimeRequestedNotification(opts: {
    coachEmail: string;
    coachName: string;
    employeeName: string;
    sessionNumber: number;
    note?: string | null;
  }): Promise<void> {
    const { coachEmail, coachName, employeeName, sessionNumber, note } = opts;
    const noteRow = note
      ? `<div style="background:${BRAND.body};border-left:4px solid ${BRAND.pending};padding:12px 16px;margin:0 0 20px;border-radius:0 4px 4px 0;color:${BRAND.textDark};">${note}</div>`
      : '';

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${coachName}</strong>,</p>
      <p style="margin:0 0 20px;"><strong>${employeeName}</strong> can't make the time you proposed for Session ${sessionNumber} and is asking for a <strong>different date</strong>. Please propose a new time (or withdraw the proposal).</p>
      ${noteRow}

      ${this.button('Propose a New Time', `${this.frontendUrl}/coach/sessions`, BRAND.pending)}
    `;

    await this.sendEmail({
      to: coachEmail,
      subject: `Different Time Requested — Session ${sessionNumber} (Action Needed)`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${coachName},\n\n${employeeName} asked for a different time for Session ${sessionNumber} of 3.${note ? `\n\nNote: ${note}` : ''}\n\nPlease log in to propose a new time.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO EMPLOYEE] Sent when the coach withdraws their proposed time — the
   * session reverts to whatever it was before the proposal.
   */
  async sendProposalWithdrawnNotification(opts: {
    employeeEmail: string;
    employeeName: string;
    coachName: string;
    sessionNumber: number;
    requestId: string;
  }): Promise<void> {
    const { employeeEmail, employeeName, coachName, sessionNumber, requestId } = opts;

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${employeeName}</strong>,</p>
      <p style="margin:0 0 20px;"><strong>${coachName}</strong> withdrew their proposed time for Session ${sessionNumber}. The session is back to how it was before the proposal — no action is needed from you right now.</p>

      ${this.button('View My Sessions', `${this.frontendUrl}/coaching/${requestId}/sessions`, BRAND.primary)}
    `;

    await this.sendEmail({
      to: employeeEmail,
      subject: `Proposed Time Withdrawn — Session ${sessionNumber}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${employeeName},\n\n${coachName} withdrew their proposed time for Session ${sessionNumber} of 3. The session is back to how it was before the proposal.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /** Formats a Date as "February 20, 2026 · 9:00 AM". */
  private formatDateTime(d: Date): string {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      + ' · '
      + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  // ─── Registration Notifications ────────────────────────────────────────────

  /**
   * [TO EMPLOYEE] Sent when HR approves their registration.
   */
  async sendRegistrationApprovedEmail(opts: {
    email: string;
    name: string;
  }): Promise<void> {
    const { email, name } = opts;
    const loginUrl = `${this.frontendUrl}/login`;

    const content = `
      <p style="margin:0 0 20px;">Hello <strong>${name}</strong>,</p>
      <p style="margin:0 0 20px;color:${BRAND.textDark};">Great news! Your Great Deals Academy account has been <strong style="color:${BRAND.success};">approved by HR</strong>. You can now log in using the credentials you registered with.</p>
      <p style="margin:0 0 20px;">${this.button('Log In Now', loginUrl, BRAND.success)}</p>
      <p style="margin:0;color:${BRAND.textMuted};font-size:13px;">If you have any questions, please contact HR.</p>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Your Account Has Been Approved — Great Deals Academy',
      htmlBody: this.buildTemplate(content),
      textBody: `Hello ${name},\n\nYour Great Deals Academy account has been approved by HR. You can now log in at:\n${loginUrl}\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /**
   * [TO EMPLOYEE] Sent when HR rejects their registration.
   */
  async sendRegistrationRejectedEmail(opts: {
    email: string;
    name: string;
    reason?: string;
  }): Promise<void> {
    const { email, name, reason } = opts;
    const reasonRow = reason
      ? `<p style="margin:0 0 20px;"><strong>Reason:</strong> ${reason}</p>`
      : '';

    const content = `
      <p style="margin:0 0 20px;">Hello <strong>${name}</strong>,</p>
      <p style="margin:0 0 20px;color:${BRAND.textDark};">Unfortunately, your registration for a Great Deals Academy account has not been approved at this time.</p>
      ${reasonRow}
      <p style="margin:0;color:${BRAND.textMuted};font-size:13px;">If you believe this is a mistake or need assistance, please reach out to HR directly.</p>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Your Account Registration Was Not Approved — Great Deals Academy',
      htmlBody: this.buildTemplate(content),
      textBody: `Hello ${name},\n\nYour registration has not been approved.${reason ? '\n\nReason: ' + reason : ''}\n\nPlease contact HR for assistance.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  // ─── Community & Announcement Notifications ────────────────────────────────

  /** HTML-escape user-generated text before embedding it in an email body. */
  private escapeHtml(s: string): string {
    return (s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Collapse whitespace and trim to a short preview suitable for an email snippet. */
  private excerpt(text: string, max = 200): string {
    const clean = (text ?? '').replace(/\s+/g, ' ').trim();
    return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()}…`;
  }

  /** Circular initials avatar (email-safe; degrades to a square in old Outlook). */
  private initialsAvatar(name: string, size = 44): string {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    const initials =
      `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || '?';
    const palette = ['#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#84CC16'];
    const bg = palette[(name?.charCodeAt(0) || 0) % palette.length];
    const fs = Math.round(size * 0.4);
    return `<table cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td align="center" valign="middle" width="${size}" height="${size}" style="width:${size}px;height:${size}px;background:${bg};border-radius:${size}px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:${fs}px;font-weight:700;line-height:${size}px;">${this.escapeHtml(initials)}</td>
    </tr></table>`;
  }

  /**
   * Viva-Engage-style post card: an optional "chip" label, an author row
   * (avatar + name + timestamp), an optional title, and the post body — all
   * inside a rounded, bordered card. User-generated text is escaped.
   */
  private postCard(opts: {
    authorName: string;
    timestamp?: string;
    chip?: string;
    title?: string | null;
    content: string;
    accent?: string;
  }): string {
    const { authorName, timestamp, chip, title, content, accent = BRAND.primary } = opts;
    const chipHtml = chip
      ? `<tr><td colspan="2" style="padding:0 0 14px;">
           <span style="display:inline-block;background:${BRAND.body};color:${accent};font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px;">${this.escapeHtml(chip)}</span>
         </td></tr>`
      : '';
    const titleHtml = title
      ? `<p style="margin:16px 0 6px;font-size:16px;font-weight:700;color:${BRAND.textDark};">${this.escapeHtml(title)}</p>`
      : '';
    const body = this.escapeHtml(this.excerpt(content, 320));
    return `
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid ${BRAND.border};border-radius:12px;background:${BRAND.white};margin:0 0 24px;">
        <tr><td style="padding:20px 22px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            ${chipHtml}
            <tr>
              <td width="44" valign="top" style="padding-right:12px;width:44px;">${this.initialsAvatar(authorName, 44)}</td>
              <td valign="middle">
                <p style="margin:0;font-size:15px;font-weight:700;color:${BRAND.textDark};">${this.escapeHtml(authorName)}</p>
                ${timestamp ? `<p style="margin:2px 0 0;font-size:12px;color:${BRAND.textMuted};">${this.escapeHtml(timestamp)}</p>` : ''}
              </td>
            </tr>
          </table>
          ${titleHtml}
          <p style="margin:${title ? '0' : '16px 0 0'};font-size:14px;line-height:1.65;color:${BRAND.textDark};">${body}</p>
        </td></tr>
      </table>`;
  }

  /**
   * [TO ALL ACTIVE EMPLOYEES] Sent when a new announcement is published.
   * Recipients are BCC'd in batches to respect SES's per-message recipient limit.
   */
  async sendAnnouncementEmail(opts: {
    recipients: string[];
    title: string;
    excerpt: string;
    authorName: string;
    createdAt?: Date;
    announcementId?: string;
  }): Promise<void> {
    const { recipients, title, excerpt, authorName, createdAt, announcementId } = opts;
    const clean = [...new Set(recipients.filter((e) => !!e))];
    if (clean.length === 0) return;
    const announcementUrl = `${this.frontendUrl}/announcement${announcementId ? `/${announcementId}` : ''}`;

    const content = `
      <p style="margin:0 0 6px;font-size:15px;">Hi there,</p>
      <p style="margin:0 0 22px;font-size:15px;color:${BRAND.textMuted};">A new announcement has been posted${authorName ? ` by <strong style="color:${BRAND.textDark};">${this.escapeHtml(authorName)}</strong>` : ''}.</p>
      ${this.postCard({
        authorName: authorName || 'Great Deals Academy',
        timestamp: createdAt ? this.formatDateTime(createdAt) : undefined,
        chip: '📢 Announcement',
        title,
        content: excerpt,
        accent: BRAND.accent,
      })}
      ${this.button('View Announcement', announcementUrl, BRAND.primary)}
    `;
    const htmlBody = this.buildTemplate(content);
    const textBody = `New announcement: ${title}\n\n${this.excerpt(excerpt)}\n\nView it here: ${announcementUrl}\n\nBest regards,\nGreat Deals Academy`;

    // SES caps a single message at 50 recipients; BCC in batches of 45.
    const BATCH = 45;
    for (let i = 0; i < clean.length; i += BATCH) {
      await this.sendEmail({
        to: this.fromEmail,
        bcc: clean.slice(i, i + BATCH),
        subject: `📢 New Announcement: ${title}`,
        htmlBody,
        textBody,
      });
    }
  }

  /** [TO MENTIONED USER] Sent when someone @mentions them in a community post. */
  async sendCommunityMentionEmail(opts: {
    to: string;
    recipientName: string;
    authorName: string;
    communityName: string;
    excerpt: string;
    postId: string;
    postTitle?: string | null;
    createdAt?: Date;
  }): Promise<void> {
    const { to, recipientName, authorName, communityName, excerpt, postId, postTitle, createdAt } = opts;
    const content = `
      <p style="margin:0 0 6px;font-size:15px;">Hi <strong>${this.escapeHtml(recipientName)}</strong>,</p>
      <p style="margin:0 0 22px;font-size:15px;color:${BRAND.textMuted};"><strong style="color:${BRAND.textDark};">${this.escapeHtml(authorName)}</strong> mentioned you in <strong style="color:${BRAND.textDark};">${this.escapeHtml(communityName)}</strong>.</p>
      ${this.postCard({
        authorName,
        timestamp: createdAt ? this.formatDateTime(createdAt) : undefined,
        chip: `Posted in ${communityName}`,
        title: postTitle,
        content: excerpt,
        accent: BRAND.primary,
      })}
      ${this.button('View Post', `${this.frontendUrl}/community/${postId}`, BRAND.primary)}
    `;
    await this.sendEmail({
      to,
      subject: `${authorName} mentioned you in ${communityName}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${recipientName},\n\n${authorName} mentioned you in a post in ${communityName}.\n\n${this.excerpt(excerpt)}\n\nView it here: ${this.frontendUrl}/community/${postId}\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /** [TO PRAISED USER] Sent when someone praises them in a community praise post. */
  async sendCommunityPraiseEmail(opts: {
    to: string;
    recipientName: string;
    authorName: string;
    communityName: string;
    excerpt: string;
    postId: string;
    postTitle?: string | null;
    createdAt?: Date;
  }): Promise<void> {
    const { to, recipientName, authorName, communityName, excerpt, postId, postTitle, createdAt } = opts;
    const content = `
      <p style="margin:0 0 6px;font-size:15px;">Hi <strong>${this.escapeHtml(recipientName)}</strong>,</p>
      <p style="margin:0 0 22px;font-size:15px;color:${BRAND.textMuted};">🎉 <strong style="color:${BRAND.textDark};">${this.escapeHtml(authorName)}</strong> praised you in <strong style="color:${BRAND.textDark};">${this.escapeHtml(communityName)}</strong>!</p>
      ${this.postCard({
        authorName,
        timestamp: createdAt ? this.formatDateTime(createdAt) : undefined,
        chip: `👏 Praise · ${communityName}`,
        title: postTitle,
        content: excerpt,
        accent: BRAND.success,
      })}
      ${this.button('View Post', `${this.frontendUrl}/community/${postId}`, BRAND.success)}
    `;
    await this.sendEmail({
      to,
      subject: `🎉 ${authorName} praised you in ${communityName}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${recipientName},\n\n${authorName} praised you in ${communityName}!\n\n${this.excerpt(excerpt)}\n\nView it here: ${this.frontendUrl}/community/${postId}\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  // ─── Registration Submission Notifications ─────────────────────────────────

  /** [TO APPLICANT] Sent immediately after they submit a registration request. */
  async sendRegistrationSubmittedEmail(opts: { email: string; name: string }): Promise<void> {
    const { email, name } = opts;
    const content = `
      <p style="margin:0 0 20px;">Hello <strong>${name}</strong>,</p>
      <p style="margin:0 0 20px;color:${BRAND.textDark};">Thanks for registering for a Great Deals Academy account. Your request has been <strong>submitted and is pending HR approval</strong>.</p>
      <p style="margin:0;color:${BRAND.textMuted};font-size:13px;">You'll receive another email as soon as HR has reviewed your registration. If you have any questions in the meantime, please reach out to HR.</p>
    `;
    await this.sendEmail({
      to: email,
      subject: 'Registration Received — Pending HR Approval',
      htmlBody: this.buildTemplate(content),
      textBody: `Hello ${name},\n\nThanks for registering for a Great Deals Academy account. Your request has been submitted and is pending HR approval.\n\nYou'll receive another email once HR has reviewed your registration.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /** [TO HR] Sent when a new registration is submitted and needs review. */
  async sendNewRegistrationNotification(opts: {
    hrEmail: string;
    hrName: string;
    applicantName: string;
    applicantEmail: string;
    department?: string;
  }): Promise<void> {
    const { hrEmail, hrName, applicantName, applicantEmail, department } = opts;
    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${hrName}</strong>,</p>
      <p style="margin:0 0 20px;"><strong>${applicantName}</strong> has submitted a new registration that requires your review.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Applicant:', applicantName)}
        ${this.detailRow('Email:', applicantEmail)}
        ${department ? this.detailRow('Department:', department) : ''}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">Please log in to the application to approve or reject this registration.</p>
      ${this.button('Review Registration', `${this.frontendUrl}/hr/registrations`)}
    `;
    await this.sendEmail({
      to: hrEmail,
      subject: `Action Required: New Registration — ${applicantName}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${hrName},\n\n${applicantName} (${applicantEmail}) has submitted a new registration requiring your review.\n\nLog in to the application to approve or reject.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  // ─── Account Change Notifications ──────────────────────────────────────────

  /** [TO EMPLOYEE] Sent when an admin enables or disables their account access. */
  async sendAccountStatusChangedEmail(opts: {
    email: string;
    name: string;
    isActive: boolean;
  }): Promise<void> {
    const { email, name, isActive } = opts;
    const statusLabel = isActive
      ? `<span style="color:${BRAND.success};font-weight:600;">Enabled</span>`
      : `<span style="color:${BRAND.danger};font-weight:600;">Disabled</span>`;

    const content = `
      <p style="margin:0 0 20px;">Hello <strong>${name}</strong>,</p>
      <p style="margin:0 0 20px;color:${BRAND.textDark};">Your Great Deals Academy account access has been <strong>${isActive ? 'enabled' : 'disabled'}</strong> by an administrator.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Account Status:', statusLabel)}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:13px;">If you believe this is a mistake, please contact HR.</p>
      ${isActive ? this.button('Log In Now', `${this.frontendUrl}/login`, BRAND.success) : ''}
    `;
    await this.sendEmail({
      to: email,
      subject: `Your Account Access Has Been ${isActive ? 'Enabled' : 'Disabled'}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hello ${name},\n\nYour Great Deals Academy account access has been ${isActive ? 'enabled' : 'disabled'} by an administrator.\n\nIf you believe this is a mistake, please contact HR.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /** [TO EMPLOYEE] Sent when an admin changes their assigned roles. */
  async sendRolesUpdatedEmail(opts: {
    email: string;
    name: string;
    roles: string[];
  }): Promise<void> {
    const { email, name, roles } = opts;
    const rolesLabel = roles.map((r) => this.escapeHtml(r)).join(', ') || 'None';

    const content = `
      <p style="margin:0 0 20px;">Hello <strong>${name}</strong>,</p>
      <p style="margin:0 0 20px;color:${BRAND.textDark};">Your account permissions on Great Deals Academy have been updated by an administrator.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Current Roles:', rolesLabel)}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:13px;">If you believe this is a mistake, please contact HR.</p>
      ${this.button('Log In Now', `${this.frontendUrl}/login`)}
    `;
    await this.sendEmail({
      to: email,
      subject: 'Your Account Permissions Have Been Updated',
      htmlBody: this.buildTemplate(content),
      textBody: `Hello ${name},\n\nYour account permissions have been updated. Current roles: ${rolesLabel}\n\nIf you believe this is a mistake, please contact HR.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /** [TO REQUESTER] Sent when their community join request is approved or declined. */
  async sendJoinRequestDecisionEmail(opts: {
    to: string;
    recipientName: string;
    communityName: string;
    approved: boolean;
  }): Promise<void> {
    const { to, recipientName, communityName, approved } = opts;
    const content = approved
      ? `
        <p style="margin:0 0 20px;">Hi <strong>${this.escapeHtml(recipientName)}</strong>,</p>
        <p style="margin:0 0 20px;color:${BRAND.textDark};">Your request to join <strong>${this.escapeHtml(communityName)}</strong> has been <strong style="color:${BRAND.success};">approved</strong>. You're in!</p>
        ${this.button('Go to Community', `${this.frontendUrl}/community`, BRAND.success)}
      `
      : `
        <p style="margin:0 0 20px;">Hi <strong>${this.escapeHtml(recipientName)}</strong>,</p>
        <p style="margin:0 0 20px;color:${BRAND.textDark};">Your request to join <strong>${this.escapeHtml(communityName)}</strong> was <strong style="color:${BRAND.danger};">declined</strong>.</p>
        <p style="margin:0;color:${BRAND.textMuted};font-size:13px;">If you have questions, please reach out to a community moderator.</p>
      `;
    await this.sendEmail({
      to,
      subject: approved
        ? `You've Joined ${communityName}`
        : `Your Request to Join ${communityName} Was Declined`,
      htmlBody: this.buildTemplate(content),
      textBody: approved
        ? `Hi ${recipientName},\n\nYour request to join ${communityName} has been approved. You're in!\n\nBest regards,\nGreat Deals Academy`
        : `Hi ${recipientName},\n\nYour request to join ${communityName} was declined.\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  // ─── Tutorial Notifications ─────────────────────────────────────────────────

  /**
   * [TO ALL ACTIVE EMPLOYEES] Sent when a new tutorial is published.
   * Recipients are BCC'd in batches to respect SES's per-message recipient limit.
   */
  async sendTutorialPublishedEmail(opts: {
    recipients: string[];
    title: string;
    excerpt: string;
    authorName?: string;
  }): Promise<void> {
    const { recipients, title, excerpt, authorName } = opts;
    const clean = [...new Set(recipients.filter((e) => !!e))];
    if (clean.length === 0) return;

    const content = `
      <p style="margin:0 0 6px;font-size:15px;">Hi there,</p>
      <p style="margin:0 0 22px;font-size:15px;color:${BRAND.textMuted};">A new tutorial is now available${authorName ? ` from <strong style="color:${BRAND.textDark};">${this.escapeHtml(authorName)}</strong>` : ''}.</p>
      ${this.postCard({
        authorName: authorName || 'Great Deals Academy',
        chip: '🎓 New Tutorial',
        title,
        content: excerpt,
        accent: BRAND.primary,
      })}
      ${this.button('View Tutorial', `${this.frontendUrl}/tutorials`)}
    `;
    const htmlBody = this.buildTemplate(content);
    const textBody = `New tutorial published: ${title}\n\n${this.excerpt(excerpt)}\n\nView it here: ${this.frontendUrl}/tutorials\n\nBest regards,\nGreat Deals Academy`;

    // SES caps a single message at 50 recipients; BCC in batches of 45.
    const BATCH = 45;
    for (let i = 0; i < clean.length; i += BATCH) {
      await this.sendEmail({
        to: this.fromEmail,
        bcc: clean.slice(i, i + BATCH),
        subject: `🎓 New Tutorial: ${title}`,
        htmlBody,
        textBody,
      });
    }
  }

  // ─── Token Balance Notifications ───────────────────────────────────────────

  /** [TO EMPLOYEE] Sent when an admin manually adjusts their boost token balance. */
  async sendTokenBalanceAdjustedEmail(opts: {
    email: string;
    name: string;
    previousBoost: number;
    updatedBoost: number;
    year: number;
  }): Promise<void> {
    const { email, name, previousBoost, updatedBoost, year } = opts;
    const delta = updatedBoost - previousBoost;
    const deltaLabel = delta === 0
      ? 'No change'
      : `<span style="color:${delta > 0 ? BRAND.success : BRAND.danger};font-weight:600;">${delta > 0 ? '+' : ''}${delta} token${Math.abs(delta) !== 1 ? 's' : ''}</span>`;

    const content = `
      <p style="margin:0 0 20px;">Hi <strong>${name}</strong>,</p>
      <p style="margin:0 0 20px;color:${BRAND.textDark};">Your Development Token balance for <strong>${year}</strong> has been manually adjusted by an administrator.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Previous Boost Tokens:', String(previousBoost))}
        ${this.detailRow('Updated Boost Tokens:', String(updatedBoost))}
        ${this.detailRow('Change:', deltaLabel)}
      </table>

      <p style="margin:0;color:${BRAND.textMuted};font-size:13px;">You may view your current balance anytime via the application.</p>
      ${this.button('View My Balance', `${this.frontendUrl}/token-management`)}
    `;
    await this.sendEmail({
      to: email,
      subject: 'Your Development Token Balance Was Adjusted',
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${name},\n\nYour Development Token balance for ${year} has been manually adjusted.\n\nPrevious Boost Tokens: ${previousBoost}\nUpdated Boost Tokens: ${updatedBoost}\nChange: ${delta > 0 ? '+' : ''}${delta}\n\nBest regards,\nGreat Deals Academy`,
    });
  }

  /** Copy + CTA color for each use-it-or-lose-it reminder tier. */
  private tokenReminderCopy(
    checkpoint: TokenReminderCheckpoint,
    remaining: number,
    allocated: number,
    year: number,
  ): { subject: string; intro: string; ctaColor: string } {
    const tokenWord = `token${remaining !== 1 ? 's' : ''}`;
    const remainingLabel = `${remaining} of your ${allocated} Development Tokens`;

    if (checkpoint === 'FINAL') {
      return {
        subject: `Last Chance: ${remaining} Development ${tokenWord[0].toUpperCase()}${tokenWord.slice(1)} Expire Dec 31`,
        intro: `This is your last reminder for ${year} — you still have ${remainingLabel} unused, and they expire at midnight on December 31.`,
        ctaColor: BRAND.danger,
      };
    }
    if (checkpoint === 'OCT' || checkpoint === 'NOV') {
      return {
        subject: `Don't Lose Them: ${remaining} Development ${tokenWord[0].toUpperCase()}${tokenWord.slice(1)} Unused`,
        intro: `With ${year} winding down, you still have ${remainingLabel} sitting unused. Development Tokens don't roll over — anything left on the table resets to 0 on January 1.`,
        ctaColor: BRAND.pending,
      };
    }
    return {
      subject: `Friendly Reminder: ${remaining} Development ${tokenWord[0].toUpperCase()}${tokenWord.slice(1)} Available`,
      intro: `Just a heads up — you still have ${remainingLabel} available for ${year}. They're there whenever you're ready to use them.`,
      ctaColor: BRAND.primary,
    };
  }

  /** [TO EMPLOYEE] Use-it-or-lose-it reminder — sent once per checkpoint tier per year to anyone with an unused balance. */
  async sendTokenUsageReminderEmail(opts: {
    email: string;
    name: string;
    remaining: number;
    allocated: number;
    year: number;
    checkpoint: TokenReminderCheckpoint;
  }): Promise<void> {
    const { email, name, remaining, allocated, year, checkpoint } = opts;
    const { subject, intro, ctaColor } = this.tokenReminderCopy(checkpoint, remaining, allocated, year);
    // OCT/NOV/FINAL copy already states the no-carry-over policy in the intro; avoid repeating it.
    const carryOverNote = checkpoint === 'Q1' || checkpoint === 'Q2' || checkpoint === 'Q3'
      ? `<p style="margin:0;color:${BRAND.textMuted};font-size:13px;">Development Tokens don't carry over — any unused balance resets to 0 when the new year starts.</p>`
      : '';

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${name}</strong>,</p>
      <p style="margin:0 0 20px;">${intro}</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 24px;">
        ${this.detailRow('Unused Tokens:', `${remaining} of ${allocated}`)}
        ${this.detailRow('Year:', String(year))}
      </table>

      ${carryOverNote}
      ${this.button('Use My Tokens', `${this.frontendUrl}/token-management`, ctaColor)}
    `;

    await this.sendEmail({
      to: email,
      subject,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${name},\n\n${intro}\n\nUnused Tokens: ${remaining} of ${allocated}\nYear: ${year}\n\nUse your tokens: ${this.frontendUrl}/token-management\n\nBest regards,\nGreat Deals Academy`,
    });
  }
}
