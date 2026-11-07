/**
 * Error with an HTTP status and a stable machine-readable code.
 * The error handler turns it into { error: { code, message } }.
 */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code stable machine-readable code
   * @param {string} message safe, human-readable message
   * @param {object} [details] optional structured detail, for example policy reasons
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The downstream system (for example the order service) failed. The action is marked failed and can be retried. */
export class DownstreamError extends AppError {
  constructor(message) {
    super(502, 'DOWNSTREAM_ERROR', message);
    this.name = 'DownstreamError';
  }
}

/**
 * The model replied, but not with usable JSON (for example a refusal or truncated text).
 * This is an invalid reply, not a provider failure: the triage service retries it and then escalates.
 */
export class ModelOutputError extends Error {
  /** @param {string} rawText the text the model returned, if any */
  constructor(rawText) {
    super('Model reply was not a valid JSON object');
    this.name = 'ModelOutputError';
    this.rawText = rawText;
  }
}

/** Raised when the AI provider fails, times out, or returns unusable output. */
export class ProviderError extends AppError {
  constructor(message) {
    super(502, 'AI_PROVIDER_ERROR', message);
    this.name = 'ProviderError';
  }
}
