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

// ─── Constants ────────────────────────────────────────────────────────────────

const BRAND = {
  navy: '#1B2B4B',
  gold: '#F59E0B',
  green: '#10B981',
  red: '#EF4444',
  body: '#F4F6F9',
  white: '#FFFFFF',
  textDark: '#111827',
  textMuted: '#6B7280',
  border: '#E5E7EB',
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
</head>
<body style="margin:0;padding:0;background:${BRAND.body};font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.body};padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${BRAND.white};border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:${BRAND.navy};padding:28px 40px;text-align:center;">
            <p style="margin:0 0 6px;color:${BRAND.gold};font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">GREAT DEALS ACADEMY</p>
            <p style="margin:0;color:${BRAND.white};font-size:20px;font-weight:700;letter-spacing:0.5px;">Development Tokens</p>
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

  /** Renders a CTA button. */
  private button(label: string, href: string, color = BRAND.gold): string {
    return `
      <table cellpadding="0" cellspacing="0" style="margin-top:24px;">
        <tr>
          <td style="background:${color};border-radius:6px;padding:12px 28px;">
            <a href="${href}" style="color:${color === BRAND.gold ? BRAND.navy : BRAND.white};font-size:14px;font-weight:700;text-decoration:none;">${label}</a>
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

      ${this.button('View My Request', `${this.frontendUrl}/my-requests`)}
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
   * [TO EMPLOYEE] Sent after HR gives final approval.
   */
  async sendApprovalNotification(opts: {
    employeeEmail: string;
    employeeName: string;
    optionName: string;
    tokenCost: number;
  }): Promise<void>;
  /** @deprecated use object overload */
  async sendApprovalNotification(email: string, name: string, optionName: string): Promise<void>;
  async sendApprovalNotification(
    optsOrEmail: { employeeEmail: string; employeeName: string; optionName: string; tokenCost: number } | string,
    name?: string,
    optionNameArg?: string,
  ): Promise<void> {
    const opts = typeof optsOrEmail === 'string'
      ? { employeeEmail: optsOrEmail, employeeName: name!, optionName: optionNameArg!, tokenCost: 0 }
      : optsOrEmail;

    const { employeeEmail, employeeName, optionName, tokenCost } = opts;
    const tokenLine = tokenCost > 0
      ? `<p style="margin:8px 0 0;color:${BRAND.textMuted};font-size:14px;"><strong>${tokenCost} token${tokenCost !== 1 ? 's' : ''}</strong> have been deducted from your balance.</p>`
      : '';

    const content = `
      <p style="margin:0 0 8px;">Hi <strong>${employeeName}</strong>,</p>
      <p style="margin:0 0 20px;">Great news! Your Development Token request has been <strong style="color:${BRAND.green};">approved</strong>.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 20px;">
        ${this.detailRow('Development Option:', optionName)}
        ${tokenCost > 0 ? this.detailRow('Tokens Deducted:', `${tokenCost} token${tokenCost !== 1 ? 's' : ''}`) : ''}
        ${this.detailRow('Approved On:', this.formatDate(new Date()))}
      </table>

      ${tokenLine}
      <p style="margin:8px 0 0;color:${BRAND.textMuted};font-size:14px;">You may now proceed with your development activity. Track your remaining balance anytime via the application.</p>

      ${this.button('View My Requests', `${this.frontendUrl}/my-requests`, BRAND.green)}
    `;

    await this.sendEmail({
      to: employeeEmail,
      subject: `Development Token Request Approved — ${optionName}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${employeeName},\n\nYour Development Token request for ${optionName} has been approved.\n${tokenCost > 0 ? `${tokenCost} token(s) have been deducted from your balance.\n` : ''}\nBest regards,\nGreat Deals Academy`,
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
      <p style="margin:0 0 8px;">Hi <strong>${employeeName}</strong>,</p>
      <p style="margin:0 0 20px;">We regret to inform you that your Development Token request has <strong style="color:${BRAND.red};">not been approved</strong> at this time.</p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${BRAND.border};margin:0 0 20px;">
        ${this.detailRow('Development Option:', optionName)}
        ${this.detailRow('Reviewer\'s Comment:', `<em>${comment}</em>`)}
      </table>

      <p style="margin:0 0 8px;color:${BRAND.textMuted};font-size:14px;">No tokens have been deducted from your balance.</p>
      <p style="margin:0;color:${BRAND.textMuted};font-size:14px;">If you have questions about this decision, please reach out to your Manager or HR. You may also resubmit with updated information.</p>

      ${this.button('View My Requests', `${this.frontendUrl}/my-requests`)}
    `;

    await this.sendEmail({
      to: employeeEmail,
      subject: `Development Token Request Not Approved — ${optionName}`,
      htmlBody: this.buildTemplate(content),
      textBody: `Hi ${employeeName},\n\nYour Development Token request for ${optionName} has not been approved.\n\nReviewer's Comment: ${comment}\n\nNo tokens have been deducted from your balance.\n\nBest regards,\nGreat Deals Academy`,
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
}
