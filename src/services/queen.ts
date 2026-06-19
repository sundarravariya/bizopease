const QUEEN_RPC = '/api/queen/rpc';
const QUEEN_TOKEN_KEY = 'bizopease_queen_token';

/** Persist / read / clear the queen JWT issued by /api/queen/authenticate. */
export const setQueenToken = (t: string) => localStorage.setItem(QUEEN_TOKEN_KEY, t);
export const getQueenToken = () => localStorage.getItem(QUEEN_TOKEN_KEY) || '';
export const clearQueenToken = () => localStorage.removeItem(QUEEN_TOKEN_KEY);

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
