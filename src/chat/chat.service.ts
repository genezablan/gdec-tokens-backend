import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ChatMessageDto } from './dto/chat-request.dto';
import { ChatToolsService } from './chat-tools.service';
import { User } from '../entities/user.entity';
import {
  CoachingSessionStatus,
  RequestStatus,
  UserRole,
} from '../common/enums';

export interface ChatReply {
  reply: string;
}

const BASE_PROMPT = [
  'You are the friendly AI assistant for the Great Deals Academy Development Token platform, an internal employee coaching and development tool.',
  'You help users navigate the app, understand the token/coaching programs, and answer questions about their own data using the tools provided.',
  'Use the tools for ANY question about token balances, requests, coaching sessions, or platform statistics — never invent or guess numbers.',
  'Personal tools return only the signed-in user\'s own data. Platform-wide analytics are restricted to admin and HR users; if a tool reports the user is not permitted, explain that politely.',
  'Be concise, warm, and practical. If you are unsure about something not covered by your context or tools, say so and point the user to the FAQ page or an administrator.',
].join('\n');

/** Roles allowed to query platform-wide aggregates via chat. */
const ANALYTICS_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.HR_APPROVER];

const REQUEST_STATUSES = [
  'pending',
  'manager_approved',
  'approved',
  'rejected',
  'cancelled',
] as const;

const SESSION_STATUSES = [
  'pending_coach_approval',
  'scheduled',
  'completed',
  'no_show',
  'cancelled',
  'declined',
] as const;

const PLATFORM_METRICS = [
  'requests_by_status',
  'requests_by_type',
  'requests_by_department',
  'sessions_by_status',
  'top_coaches',
  'token_usage',
] as const;

/**
 * AI chat backed by the Anthropic Claude API. Calls are made server-side so
 * the API key never reaches the browser. The conversation is stateless on the
 * backend — the frontend sends the full history each turn.
 *
 * The model runs an agentic tool loop (handled by the SDK's tool runner):
 * it can call the read-only analytics tools in ChatToolsService to answer
 * data questions before producing its reply.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly client: Anthropic | undefined;
  private readonly model: string;
  private readonly navigationContext: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly chatTools: ChatToolsService,
  ) {
    const apiKey = this.configService.get<string>('anthropic.apiKey');
    this.client = apiKey ? new Anthropic({ apiKey }) : undefined;
    this.model =
      this.configService.get<string>('anthropic.model') || 'claude-haiku-4-5';
    this.navigationContext = this.loadNavigationContext();
  }

  isConfigured(): boolean {
    return Boolean(this.client);
  }

  /**
   * App navigation & domain knowledge for the system prompt. Lives in
   * assistant-context.md (copied to dist as a build asset) so it can be
   * edited without touching code.
   */
  private loadNavigationContext(): string {
    try {
      return readFileSync(join(__dirname, 'assistant-context.md'), 'utf8');
    } catch (err) {
      this.logger.warn(
        `assistant-context.md not found — chat runs without navigation context (${(err as Error).message})`,
      );
      return '';
    }
  }

  private buildSystemPrompt(user: User): string {
    return [
      BASE_PROMPT,
      '',
      this.navigationContext,
      '',
      '## Current user',
      `Name: ${user.firstName} ${user.lastName}`,
      `Roles: ${user.roles.join(', ')}`,
      `Today's date: ${new Date().toISOString().slice(0, 10)}`,
      'Tailor navigation directions to this role — never direct the user to a page their role cannot access.',
    ].join('\n');
  }

  /** Read-only tools, closed over the requesting user so scoping is server-enforced. */
  private buildTools(user: User) {
    return [
      betaZodTool({
        name: 'get_my_token_balance',
        description:
          "Get the signed-in user's development-token balance for a year: allocated, boost tokens, used, and remaining. Call this when the user asks about their tokens.",
        inputSchema: z.object({
          year: z
            .number()
            .int()
            .optional()
            .describe('Defaults to the current year'),
        }),
        run: async ({ year }) =>
          JSON.stringify(await this.chatTools.getMyTokenBalance(user.id, year)),
      }),
      betaZodTool({
        name: 'get_my_token_requests',
        description:
          "List the signed-in user's own token requests (type, status, token cost, dates). Call this when the user asks about the status, count, or history of their requests.",
        inputSchema: z.object({
          status: z
            .enum(REQUEST_STATUSES)
            .optional()
            .describe('Filter by request status'),
          year: z.number().int().optional().describe('Filter by token year'),
        }),
        run: async ({ status, year }) =>
          JSON.stringify(
            await this.chatTools.getMyTokenRequests(
              user.id,
              status as RequestStatus | undefined,
              year,
            ),
          ),
      }),
      betaZodTool({
        name: 'get_my_coaching_sessions',
        description:
          "List the signed-in user's coaching sessions (coaches see sessions they give; everyone else sees sessions they receive). Call this for questions about upcoming, completed, or past sessions.",
        inputSchema: z.object({
          status: z
            .enum(SESSION_STATUSES)
            .optional()
            .describe('Filter by session status'),
        }),
        run: async ({ status }) =>
          JSON.stringify(
            await this.chatTools.getMyCoachingSessions(
              user.id,
              user.isCoach(),
              status as CoachingSessionStatus | undefined,
            ),
          ),
      }),
      betaZodTool({
        name: 'get_platform_analytics',
        description:
          'Platform-wide aggregate statistics (request counts by status/type/department, session counts, top coaches by completed sessions, total token usage). Only admin and HR users are permitted — for other roles this returns a permission error you should relay politely.',
        inputSchema: z.object({
          metric: z.enum(PLATFORM_METRICS),
          year: z
            .number()
            .int()
            .optional()
            .describe('Defaults to the current year'),
        }),
        run: async ({ metric, year }) => {
          if (!ANALYTICS_ROLES.some((role) => user.hasRole(role))) {
            return JSON.stringify({
              error:
                'Not permitted: platform-wide analytics are only available to admin and HR users.',
            });
          }
          return JSON.stringify(
            await this.chatTools.getPlatformStats(metric, year),
          );
        },
      }),
    ];
  }

  /**
   * Sends the conversation to Claude (with the analytics tool loop) and
   * returns the assistant's reply. Throws ServiceUnavailableException when no
   * API key is configured.
   */
  async chat(messages: ChatMessageDto[], user: User): Promise<ChatReply> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'AI chat is not configured. Please try again later.',
      );
    }

    if (messages[0].role !== 'user') {
      throw new BadRequestException('The first message must be from the user');
    }

    try {
      // The tool runner handles the agentic loop: it executes tool calls
      // (DB queries) and feeds results back until the model produces a reply.
      const message = await this.client.beta.messages.toolRunner({
        model: this.model,
        max_tokens: 16000,
        system: this.buildSystemPrompt(user),
        tools: this.buildTools(user),
        messages: messages.map(({ role, content }) => ({ role, content })),
      });

      const reply = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (!reply.trim()) {
        this.logger.error(
          `Claude returned no text (stop_reason: ${message.stop_reason})`,
        );
        throw new BadGatewayException('AI chat returned an empty response.');
      }

      return { reply };
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      if (err instanceof Anthropic.AuthenticationError) {
        this.logger.error('Anthropic API key was rejected');
        throw new ServiceUnavailableException(
          'AI chat is not configured correctly. Please try again later.',
        );
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new HttpException(
          'AI chat is busy right now. Please try again in a moment.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (err instanceof Anthropic.APIError) {
        this.logger.error(`Anthropic API error ${err.status}: ${err.message}`);
        throw new BadGatewayException(
          'AI chat is temporarily unavailable. Please try again later.',
        );
      }
      this.logger.error(`AI chat request failed: ${(err as Error).message}`);
      throw new BadGatewayException(
        'AI chat is temporarily unavailable. Please try again later.',
      );
    }
  }
}
