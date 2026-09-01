import { registerAs } from '@nestjs/config';

/**
 * Configuration for the Anthropic Claude API, used for the AI chat feature.
 * The key never reaches the browser — all calls are made server-side.
 *
 * When `apiKey` is missing, the chat endpoint reports itself as unavailable
 * (503) so the frontend can show a graceful error message.
 */
export default registerAs('anthropic', () => ({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // Default to the cheapest model; override with ANTHROPIC_MODEL.
  model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
  /**
   * Model for the course recommender, separate from chat on purpose. The
   * recommender needs the current web-search tool, which requires Opus 4.6+ or
   * Sonnet 4.6+ — the chat model (Haiku) cannot use it. Keeping them apart
   * means raising one does not silently change the cost of the other.
   */
  recommenderModel: process.env.ANTHROPIC_RECOMMENDER_MODEL || 'claude-opus-5',
}));
