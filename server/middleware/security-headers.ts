/**
 * Security headers middleware.
 *
 * Adds essential security headers to all responses:
 * - Content-Security-Policy (CSP)
 * - X-Frame-Options
 * - X-Content-Type-Options
 * - Strict-Transport-Security (HSTS)
 * - Referrer-Policy
 * - X-XSS-Protection
 */

import type { MiddlewareHandler } from 'hono';
import { isSecureRequest } from './rate-limit.js';

/**
 * Content Security Policy
 * 
 * - default-src 'self': Only allow resources from same origin by default
 * - script-src 'self': Only allow scripts from same origin
 * - style-src: Allow self, inline styles (needed for some UI libraries), and Google Fonts
 * - font-src: Allow self and Google Fonts CDN
 * - connect-src: Browser traffic is same-origin HTTP/SSE only
 * - img-src: Allow self, data URIs, and blob URLs (for generated images)
 * - frame-ancestors 'none': Prevent framing (like X-Frame-Options: DENY)
 */
/**
 * Build CSP directives string lazily — env vars may not be loaded at import time
 * (dotenv/config runs in config.ts which may be imported after this module).
 */
let _cspDirectives: string | null = null;

function getCspDirectives(): string {
  if (_cspDirectives) return _cspDirectives;

  _cspDirectives = [
    "default-src 'self'",
    "script-src 'self' https://s3.tradingview.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",  // Allow local attachment previews.
    "frame-src 'self' https://s3.tradingview.com https://www.tradingview.com https://www.tradingview-widget.com https://s.tradingview.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  return _cspDirectives;
}

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();

  // Content Security Policy - defense in depth against XSS
  c.header('Content-Security-Policy', getCspDirectives());

  // Prevent clickjacking
  c.header('X-Frame-Options', 'SAMEORIGIN');

  // Prevent MIME type sniffing
  c.header('X-Content-Type-Options', 'nosniff');

  // Enable legacy XSS filter (mostly for older browsers)
  c.header('X-XSS-Protection', '1; mode=block');

  // Enforce HTTPS (1 year, include subdomains) — production only
  if (process.env.NODE_ENV === 'production' && isSecureRequest(c)) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Control referrer information
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Prevent browsers from caching sensitive responses
  // (can be overridden by cache-headers middleware for specific routes)
  if (!c.res.headers.get('Cache-Control')) {
    c.header('Cache-Control', 'no-store');
  }
};
