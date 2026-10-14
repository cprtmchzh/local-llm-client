export interface RetryOptions {
  attempts: number;
  initialDelayMs: number;
  factor?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let delay = options.initialDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts) break;
      options.onRetry?.(attempt, error);
      await new Promise((resolve) => window.setTimeout(resolve, delay));
      delay *= options.factor ?? 1.7;
    }
  }

  throw lastError;
}
