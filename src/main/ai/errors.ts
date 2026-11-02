export class AiError extends Error {
  constructor(
    message: string,
    readonly code: 'no_key' | 'bad_key' | 'offline' | 'refused' | 'rate_limited' | 'cancelled' | 'invalid_output' | 'api',
    /** rate_limited: when the provider's quota comes back (epoch ms), if it said so. */
    readonly retryAt?: number,
  ) {
    super(message);
  }
}
