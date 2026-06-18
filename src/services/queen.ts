const QUEEN_RPC = '/api/queen/rpc';

export async function queenCall<T = any>(
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {}
): Promise<T> {
  const r = await fetch(QUEEN_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
