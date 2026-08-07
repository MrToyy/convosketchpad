/** Test whether OpenClaw Gateway is reachable and an optional shared token is accepted. */
export async function testGatewayConnection(
  url: string,
  token?: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const healthResp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (!healthResp.ok) {
      return { ok: false, message: `Gateway returned HTTP ${healthResp.status}` };
    }

    if (!token?.trim()) return { ok: true, message: 'Gateway reachable' };

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
  } catch (error) {
    return {
      ok: false,
      message: `Cannot reach gateway: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
