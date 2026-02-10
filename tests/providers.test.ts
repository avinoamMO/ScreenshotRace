import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock both https and http modules
vi.mock('https', () => {
  const mockGet = vi.fn();
  const mockRequest = vi.fn();
  return {
    default: { get: mockGet, request: mockRequest },
    get: mockGet,
    request: mockRequest,
  };
});

vi.mock('http', () => {
  const mockGet = vi.fn();
  return {
    default: { get: mockGet },
    get: mockGet,
  };
});

describe('providers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  describe('screenshotViaBrowserless', () => {
    it('should throw when BROWSERLESS_API_KEY is not set', async () => {
      vi.stubEnv('BROWSERLESS_API_KEY', '');
      const { screenshotViaBrowserless } = await import('../providers');
      await expect(screenshotViaBrowserless('https://example.com'))
        .rejects.toThrow('BROWSERLESS_API_KEY not configured');
    });
  });

  describe('screenshotViaUrlbox', () => {
    it('should throw when URLBOX_API_KEY is not set', async () => {
      vi.stubEnv('URLBOX_API_KEY', '');
      vi.stubEnv('URLBOX_API_SECRET', '');
      const { screenshotViaUrlbox } = await import('../providers');
      await expect(screenshotViaUrlbox('https://example.com'))
        .rejects.toThrow('URLBOX_API_KEY/URLBOX_API_SECRET not configured');
    });

    it('should throw when only URLBOX_API_KEY is set without secret', async () => {
      vi.stubEnv('URLBOX_API_KEY', 'test-key');
      vi.stubEnv('URLBOX_API_SECRET', '');
      const { screenshotViaUrlbox } = await import('../providers');
      await expect(screenshotViaUrlbox('https://example.com'))
        .rejects.toThrow('URLBOX_API_KEY/URLBOX_API_SECRET not configured');
    });
  });

  describe('screenshotViaZenrows', () => {
    it('should throw when ZENROWS_API_KEY is not set', async () => {
      vi.stubEnv('ZENROWS_API_KEY', '');
      const { screenshotViaZenrows } = await import('../providers');
      await expect(screenshotViaZenrows('https://example.com'))
        .rejects.toThrow('ZENROWS_API_KEY not configured');
    });
  });

  describe('ProviderResult interface', () => {
    it('should have correct shape', () => {
      const result = {
        screenshot: 'base64data',
        provider: 'puppeteer',
        timeMs: 2500,
        size: 45000,
      };
      expect(result.provider).toBe('puppeteer');
      expect(result.timeMs).toBe(2500);
      expect(typeof result.screenshot).toBe('string');
      expect(result.size).toBeGreaterThan(0);
    });
  });
});
