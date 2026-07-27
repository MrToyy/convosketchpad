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

/** Test if the OpenClaw gateway is reachable and, when provided, the token is actually accepted. */
export async function testGatewayConnection(url: string, token?: string): Promise<{ ok: boolean; message: string }> {
  try {
    const healthResp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (!healthResp.ok) {
      return { ok: false, message: `Gateway returned HTTP ${healthResp.status}` };
    }

    if (!token?.trim()) {
      return { ok: true, message: 'Gateway reachable' };
    }

    const authResp = await fetch(`${url}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tool: 'sessions_list', args: { limit: 1 } }),
      signal: AbortSignal.timeout(5000),
    });

    if (!authResp.ok) {
      if (authResp.status === 401 || authResp.status === 403) {
        return { ok: false, message: 'Gateway auth token rejected' };
      }
      return { ok: false, message: `Could not confirm gateway auth, validation returned HTTP ${authResp.status}` };
    }

    const payload = await authResp.json() as { ok?: boolean; error?: { message?: string } };
    if (payload.ok === true) {
      return { ok: true, message: 'Gateway reachable and token validated' };
    }

    return {
      ok: false,
      message: `Could not confirm gateway auth, tool call failed: ${payload.error?.message || 'unexpected response'}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Cannot reach gateway: ${msg}` };
  }
}
