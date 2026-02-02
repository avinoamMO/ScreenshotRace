export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold?: number;  // Default: 5
  recoveryTimeMs?: number;    // Default: 30000
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: CircuitState = 'closed';
  private name: string;
  private options: CircuitBreakerOptions;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.options = options;
  }

  get failureThreshold(): number {
    return this.options.failureThreshold ?? 5;
  }

  get recoveryTimeMs(): number {
    return this.options.recoveryTimeMs ?? 30000;
  }

  getState(): CircuitState {
    if (this.state === 'open') {
      // Check if recovery time has passed
      if (Date.now() - this.lastFailureTime >= this.recoveryTimeMs) {
        this.state = 'half-open';
        this.failures = 0; // Reset failures when entering half-open to allow fair test
      }
    }
    return this.state;
  }

  isOpen(): boolean {
    return this.getState() === 'open';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      console.warn(`Circuit breaker '${this.name}' opened after ${this.failures} failures`);
    }
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error(`Circuit breaker '${this.name}' is open`);
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}

// Global registry of circuit breakers per provider
const circuitBreakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(providerName: string): CircuitBreaker {
  if (!circuitBreakers.has(providerName)) {
    circuitBreakers.set(providerName, new CircuitBreaker(providerName));
  }
  return circuitBreakers.get(providerName)!;
}

export function resetAllCircuitBreakers(): void {
  circuitBreakers.clear();
}
