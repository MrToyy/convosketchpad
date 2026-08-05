/**
 * Input validation functions for the setup CLI.
 */

import net from 'node:net';

/** Check if a string is a valid HTTP(S) URL. */
export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol);
  } catch {
    return false;
  }
}

/** Check if a port number is valid (1–65535). */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Check if a server bind value is an IP literal, localhost, or a valid DNS hostname. */
export function isValidBindHost(host: string): boolean {
  const value = host.trim();
  if (!value) return false;
  if (net.isIP(value) !== 0 || value === 'localhost') return true;
  if (value.length > 253 || value.includes('..')) return false;
  return value.split('.').every(label =>
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

export function isValidIpAddress(value: string): boolean {
  return net.isIP(value.trim()) !== 0;
}

/** Check if a port is available for binding. */
export async function isPortAvailable(port: number, host: string = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, host);
  });
}
