import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { CourseProvider, CoursePricingModel } from '../common/enums';
import { JobDescription } from '../entities/job-description.entity';

/** PHP value of one Development Token. Mirrors the Learning Subsidy rules. */
const TOKEN_PHP = 1000;
/** Most tokens a single Learning Subsidy request may spend. */
const MAX_TOKENS_PER_REQUEST = 3;
/** How many courses to keep per job description. */
const COURSES_PER_ROLE = 4;

/** One course as returned by the model, before it is trusted. */
interface RawCourse {
  title?: unknown;
  provider?: unknown;
  url?: unknown;
  level?: unknown;
  durationHours?: unknown;
  whyItFits?: unknown;
  skillTargeted?: unknown;
  pricingModel?: unknown;
  estimatedTokenCost?: unknown;
  priceNote?: unknown;
}

export interface GeneratedCourse {
  provider: CourseProvider;
  title: string;
  url: string;
  level: string | null;
  durationHours: number | null;
  whyItFits: string;
  skillTargeted: string | null;
  pricingModel: CoursePricingModel;
  estimatedTokenCost: number | null;
  priceNote: string | null;
}

/**
 * Turns a job description into course suggestions, grounded in web search.
 *
 * Grounding is not optional. Asked to recommend courses from memory, the model
 * produces plausible titles, instructors and URLs that do not exist — and an
 * employee filing a PHP 3,000 subsidy for an invented course is a failure an
 * approver has no way to catch. Search is restricted to the two providers the
 * program allows, and the prompt tells the model to drop anything it cannot
 * verify rather than pad the list.
 *
 * Prices are estimates and are stored as such. Udemy renders pricing in
 * JavaScript so neither search nor a page fetch returns a figure, and the Udemy
 * Affiliate API was discontinued on 2025-01-01. Real peso amounts come from
 * what colleagues actually paid — see CourseRecommendationsService.
 */
@Injectable()
export class CourseGeneratorService {
  private readonly logger = new Logger(CourseGeneratorService.name);
  private readonly client: Anthropic | undefined;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('anthropic.apiKey');
    // 10 minutes: a run makes up to 8 searches plus page fetches and has been
    // observed around 70s, but a slow provider should not abort the batch.
    this.client = apiKey
      ? new Anthropic({ apiKey, timeout: 600_000 })
      : undefined;
    this.model =
      this.configService.get<string>('anthropic.recommenderModel') ||
      'claude-opus-5';
  }

  isConfigured(): boolean {
    return Boolean(this.client);
  }

  get modelName(): string {
    return this.model;
  }

  private buildSystemPrompt(): string {
    return `You recommend online courses to employees of Great Deals E-commerce Corp, a
Philippines-based e-commerce company, under their Development Token program.

BUDGET RULES:
- 1 Development Token = PHP ${TOKEN_PHP}. A single Learning Subsidy request may spend at most
  ${MAX_TOKENS_PER_REQUEST} tokens (PHP ${TOKEN_PHP * MAX_TOKENS_PER_REQUEST}).
- estimatedTokenCost = ceil(price / ${TOKEN_PHP}).

SOURCING RULES:
- Udemy and Coursera only.
- Use web search to find REAL courses. Never invent a course, instructor, URL or price.
- If you cannot verify a course exists, leave it out. Fewer real results beats more invented ones.
- Prefer courses that teach what the job description actually asks the person to do.

PRICING RULES — read carefully:
- You will usually NOT be able to read a real price; Udemy renders prices in JavaScript.
- When you cannot, set estimatedTokenCost to your honest expectation (Udemy sale prices sit around
  PHP 450-900, so 1 is usually right) and say plainly in priceNote that it is an estimate to be
  confirmed at checkout. NEVER state an unverified number as fact.
- Set pricingModel to "subscription" for anything billed monthly (Coursera Specializations and
  Professional Certificates). For those, estimatedTokenCost should be null and priceNote must
  explain that the total depends on how many months the learner takes.
- Ignore promotional banners such as "$70+ in savings" — those are adverts, not prices.

Respond with ONLY a JSON object, no prose and no markdown fence:
{"courses":[{"title","provider","url","level","durationHours","whyItFits","skillTargeted",
"pricingModel","estimatedTokenCost","priceNote"}]}

Return at most ${COURSES_PER_ROLE} courses, best fit first. "provider" is "udemy" or "coursera".
"pricingModel" is "one_time" or "subscription". "durationHours" is a number or null.
"whyItFits" must argue from this specific role and this company's context — never generic filler.`;
  }

  /** Generate suggestions for one job description. Throws if the API is unconfigured. */
  async generate(jobDescription: JobDescription): Promise<GeneratedCourse[]> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'ANTHROPIC_API_KEY is not configured — the course recommender is unavailable.',
      );
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      system: this.buildSystemPrompt(),
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: 8,
          allowed_domains: ['udemy.com', 'coursera.org'],
          user_location: { type: 'approximate', country: 'PH' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Position: "${jobDescription.position}"

Job description:
${jobDescription.content}

Budget ceiling: ${MAX_TOKENS_PER_REQUEST} tokens = PHP ${TOKEN_PHP * MAX_TOKENS_PER_REQUEST} maximum for one request.

Find real, currently-available courses that would make someone in this role measurably better at it.`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(
        `Model declined to answer for "${jobDescription.position}" (${response.stop_details?.category ?? 'unknown'})`,
      );
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const courses = this.parse(text, jobDescription.position);
    this.logger.log(
      `Generated ${courses.length} course(s) for "${jobDescription.position}" ` +
        `(in=${response.usage.input_tokens} out=${response.usage.output_tokens})`,
    );
    return courses;
  }

  /**
   * Pull the JSON payload out of the reply and keep only well-formed rows.
   *
   * The model is told to return bare JSON, but web-search turns sometimes wrap
   * it in prose, so the object is located rather than assumed. Anything missing
   * a title, a URL or a reason is dropped: a half-formed suggestion is worse
   * than one fewer suggestion.
   */
  private parse(text: string, position: string): GeneratedCourse[] {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      this.logger.warn(`No JSON found in reply for "${position}"`);
      return [];
    }

    let payload: { courses?: RawCourse[] };
    try {
      payload = JSON.parse(match[0]) as { courses?: RawCourse[] };
    } catch (err) {
      this.logger.warn(
        `Unparseable JSON for "${position}": ${(err as Error).message}`,
      );
      return [];
    }

    const rows = Array.isArray(payload.courses) ? payload.courses : [];
    const seen = new Set<string>();
    const out: GeneratedCourse[] = [];

    for (const row of rows) {
      const title = this.str(row.title, 300);
      const url = this.str(row.url, 500);
      const whyItFits = this.str(row.whyItFits, 4000);
      const provider = this.provider(row.provider, url);

      if (!title || !url || !whyItFits || !provider) continue;
      // The unique constraint is (jobDescriptionId, url); collapse duplicates
      // here so one bad batch cannot fail the whole insert.
      if (seen.has(url)) continue;
      seen.add(url);

      const pricingModel =
        row.pricingModel === 'subscription'
          ? CoursePricingModel.SUBSCRIPTION
          : CoursePricingModel.ONE_TIME;

      out.push({
        provider,
        title,
        url,
        level: this.str(row.level, 60),
        durationHours: this.positiveInt(row.durationHours),
        whyItFits,
        skillTargeted: this.str(row.skillTargeted, 200),
        pricingModel,
        // A subscription has no single token cost, and an estimate above the
        // cap is not actionable — store null rather than a misleading number.
        estimatedTokenCost:
          pricingModel === CoursePricingModel.SUBSCRIPTION
            ? null
            : this.tokenCost(row.estimatedTokenCost),
        priceNote: this.str(row.priceNote, 2000),
      });

      if (out.length >= COURSES_PER_ROLE) break;
    }

    return out;
  }

  /**
   * Trim, cap and strip citation markup.
   *
   * The web-search tool annotates its own output with <cite index="22-1,22-2">
   * tags. The model copies them into the JSON string values, so without this
   * they reach the database and render as literal angle-bracket text in the
   * card. Only <cite> is targeted — a blunt tag strip would mangle legitimate
   * generic syntax like Repository<User> in a developer course description.
   */
  private str(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const cleaned = value
      .replace(/<\/?cite\b[^>]*>/gi, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    return cleaned ? cleaned.slice(0, max) : null;
  }

  /** Trust the URL over the model's own label — the host is the ground truth. */
  private provider(value: unknown, url: string | null): CourseProvider | null {
    const host = (url ?? '').toLowerCase();
    if (host.includes('udemy.com')) return CourseProvider.UDEMY;
    if (host.includes('coursera.org')) return CourseProvider.COURSERA;
    if (value === 'udemy') return CourseProvider.UDEMY;
    if (value === 'coursera') return CourseProvider.COURSERA;
    return null;
  }

  private positiveInt(value: unknown): number | null {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  private tokenCost(value: unknown): number | null {
    const n = this.positiveInt(value);
    if (n === null) return null;
    return n <= MAX_TOKENS_PER_REQUEST ? n : null;
  }
}
