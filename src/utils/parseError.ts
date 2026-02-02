// Parse and clean up error messages from various APIs
export function parseErrorMessage(status: number, errorText: string): string {
  // Try to parse as JSON first
  try {
    const json = JSON.parse(errorText);
    // ZenRows format
    if (json.title) return `${status}: ${json.title}`;
    // Browserless format
    if (json.message) return `${status}: ${json.message}`;
    if (json.error) return `${status}: ${json.error}`;
    if (json.detail) return `${status}: ${json.detail}`;
  } catch {
    // Not JSON, continue to text parsing
  }

  // Common HTTP status messages
  const statusMessages: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized - check API key',
    403: 'Forbidden - access denied',
    404: 'Not Found',
    429: 'Rate Limited - too many requests',
    500: 'Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };

  // If it's HTML, just return status message
  if (errorText.includes('<html') || errorText.includes('<!DOCTYPE')) {
    return `${status}: ${statusMessages[status] || 'Error'}`;
  }

  // Truncate long text errors
  const cleanText = errorText.replace(/\s+/g, ' ').trim();
  if (cleanText.length > 100) {
    return `${status}: ${statusMessages[status] || cleanText.slice(0, 80) + '...'}`;
  }

  return `${status}: ${cleanText || statusMessages[status] || 'Unknown error'}`;
}
