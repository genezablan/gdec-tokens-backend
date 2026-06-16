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
}));
