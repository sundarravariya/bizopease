const QUEEN_RPC = '/api/queen/rpc';
const QUEEN_TOKEN_KEY = 'bizopease_queen_token';

/** Persist / read / clear the queen JWT issued by /api/queen/authenticate. */
export const setQueenToken = (t: string) => localStorage.setItem(QUEEN_TOKEN_KEY, t);
export const getQueenToken = () => localStorage.getItem(QUEEN_TOKEN_KEY) || '';
export const clearQueenToken = () => localStorage.removeItem(QUEEN_TOKEN_KEY);

/**
 * True when the active portal user is a queen tenant AND holds a queen JWT.
 * Both conditions are required so a stale token alone can never reroute a
 * robifel user's traffic to queenfinger. Used by odoo.ts (call_kw reroute),
 * odooReports.ts (PDF) and asset URLs below — the single source of truth.
 */
export function isQueenSession(): boolean {
  try {
    if (!getQueenToken()) return false;
    const u = JSON.parse(localStorage.getItem('robifel-user') || '{}');
    return u?.is_queen_tenant === true;
  } catch {
    return false;
  }
}

/**
 * Build a queenfinger /web/content URL routed through the auth-gated queen proxy.
 * Used for inline images/attachments (raw <img>/<a> that cannot send a header),
 * so the token rides as a query param. Returns null when not a queen session.
 */
export function queenContentUrl(params: Record<string, string | number>): string | null {
  if (!isQueenSession()) return null;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  qs.set('token', getQueenToken());
  return `/api/queen/content?${qs.toString()}`;
}

export async function queenCall<T = any>(
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {}
): Promise<T> {
  const token = getQueenToken();
  const r = await fetch(QUEEN_RPC, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify({ model, method, args, kwargs }),
  });
  const j = await r.json();
  if (j.error) {
    const msg = typeof j.error === 'string'
      ? j.error
      : (j.error.data?.message || j.error.message || 'B2B RPC error');
    throw new Error(msg);
  }
  return j.result;
}

export async function queenSearchRead<T = any>(
  model: string,
  opts: {
    domain?: any[];
    fields: string[];
    limit?: number;
    offset?: number;
    order?: string;
  }
): Promise<T[]> {
  return queenCall<T[]>(model, 'search_read', [], {
    domain: opts.domain ?? [],
    fields: opts.fields,
    limit: opts.limit ?? 80,
    offset: opts.offset ?? 0,
    order: opts.order ?? '',
  });
}

export async function queenReadGroup(
  model: string,
  domain: any[],
  fields: string[],
  groupby: string[]
): Promise<any[]> {
  return queenCall(model, 'read_group', [], { domain, fields, groupby, lazy: false });
}
