import { ConfigService } from '@nestjs/config';
import { CourseGeneratorService, GeneratedCourse } from './course-generator.service';
import { CourseProvider, CoursePricingModel } from '../common/enums';

/**
 * Covers `parse`, which is the only place untrusted model output crosses into
 * the database. Reached through the index signature rather than made public:
 * the boundary being tested is real, but nothing outside the service should
 * call it.
 */
describe('CourseGeneratorService.parse', () => {
  let service: CourseGeneratorService;

  const parse = (text: string): GeneratedCourse[] =>
    (
      service as unknown as {
        parse(text: string, position: string): GeneratedCourse[];
      }
    ).parse(text, 'Back-end Developer');

  const course = (over: Record<string, unknown> = {}) => ({
    title: 'NestJS Zero to Hero',
    provider: 'udemy',
    url: 'https://www.udemy.com/course/nestjs-zero-to-hero/',
    whyItFits: 'Matches the stack named in the job description.',
    pricingModel: 'one_time',
    estimatedTokenCost: 1,
    ...over,
  });

  const json = (courses: unknown[]) => JSON.stringify({ courses });

  beforeEach(() => {
    const config = {
      get: (key: string) =>
        key === 'anthropic.apiKey' ? 'test-key' : 'claude-opus-5',
    } as unknown as ConfigService;
    service = new CourseGeneratorService(config);
  });

  it('strips web-search citation markup out of prose', () => {
    const [row] = parse(
      json([
        course({
          whyItFits:
            'The role owns schema design. <cite index="22-1,22-2">This course covers indexing.</cite> Useful.',
        }),
      ]),
    );
    expect(row.whyItFits).not.toContain('<cite');
    expect(row.whyItFits).not.toContain('</cite>');
    expect(row.whyItFits).toContain('This course covers indexing.');
  });

  it('keeps generic syntax that merely looks like a tag', () => {
    const [row] = parse(
      json([course({ whyItFits: 'Teaches Repository<User> patterns in TypeORM.' })]),
    );
    expect(row.whyItFits).toContain('Repository<User>');
  });

  it('drops rows missing a title, url or reason', () => {
    expect(
      parse(
        json([
          course({ title: '' }),
          course({ url: '', title: 'B' }),
          course({ whyItFits: '   ', title: 'C', url: 'https://www.udemy.com/course/c/' }),
        ]),
      ),
    ).toHaveLength(0);
  });

  it('collapses duplicate urls so the unique constraint cannot be violated', () => {
    const rows = parse(json([course(), course({ title: 'Same link, other name' })]));
    expect(rows).toHaveLength(1);
  });

  it('takes the provider from the url host, not the model’s label', () => {
    const [row] = parse(
      json([
        course({
          provider: 'udemy',
          url: 'https://www.coursera.org/learn/postgresql',
        }),
      ]),
    );
    expect(row.provider).toBe(CourseProvider.COURSERA);
  });

  it('gives a subscription no token cost', () => {
    const [row] = parse(
      json([
        course({
          url: 'https://www.coursera.org/specializations/graphic-design',
          pricingModel: 'subscription',
          estimatedTokenCost: 2,
        }),
      ]),
    );
    expect(row.pricingModel).toBe(CoursePricingModel.SUBSCRIPTION);
    expect(row.estimatedTokenCost).toBeNull();
  });

  it('discards an estimate above the three-token cap rather than showing it', () => {
    const [row] = parse(json([course({ estimatedTokenCost: 7 })]));
    expect(row.estimatedTokenCost).toBeNull();
  });

  it('keeps at most four courses', () => {
    const rows = parse(
      json(
        Array.from({ length: 9 }, (_, i) =>
          course({ url: `https://www.udemy.com/course/c-${i}/` }),
        ),
      ),
    );
    expect(rows).toHaveLength(4);
  });

  it('finds the payload even when the model wraps it in prose', () => {
    expect(
      parse(`Here are my picks:\n${json([course()])}\nLet me know.`),
    ).toHaveLength(1);
  });

  it('returns nothing rather than throwing on unusable output', () => {
    expect(parse('no json at all')).toEqual([]);
    expect(parse('{ not valid json ]')).toEqual([]);
    expect(parse(json([]))).toEqual([]);
  });
});
