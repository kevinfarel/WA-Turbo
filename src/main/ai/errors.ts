export class AiError extends Error {
  constructor(message: string, readonly code: 'no_key' | 'bad_key' | 'offline' | 'refused' | 'rate_limited' | 'cancelled' | 'invalid_output' | 'api') {
    super(message);
  }
}
