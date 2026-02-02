export interface RetryOptions {
  maxAttempts?: number;      // Default: 3
  baseDelayMs?: number;      // Default: 1000
  maxDelayMs?: number;       // Default: 10000
  isRetryable?: (error: Error) => boolean;
}

// Default: retry on network/timeout errors, not on 4xx client errors
export function defaultIsRetryable(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Retryable errors
  if (message.includes('timeout')) return true;
  if (message.includes('network')) return true;
  if (message.includes('econnrefused')) return true;
  if (message.includes('econnreset')) return true;
  if (message.includes('503')) return true;
  if (message.includes('502')) return true;
  if (message.includes('429')) return true;  // Rate limited

  // Non-retryable errors
  if (message.includes('401')) return false;
  if (message.includes('403')) return false;
  if (message.includes('404')) return false;
  if (message.includes('cancelled')) return false;

  // Default to retryable for unknown errors
  return true;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    isRetryable = defaultIsRetryable,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt + 1 >= maxAttempts || !isRetryable(lastError)) {
        throw lastError;
      }

      // Calculate delay with jitter
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 200,
        maxDelayMs
      );

      console.log(`Retrying (attempt ${attempt + 2}/${maxAttempts}) after ${Math.round(delay)}ms: ${lastError.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
