import { useState, useEffect, useCallback, useRef } from 'react';
import { searchRead, SearchReadOptions } from '../services/odoo';

interface UseOdooModelOptions extends SearchReadOptions {
  autoFetch?: boolean;
  /** localStorage key — loads cached data immediately, syncs from Odoo in background */
  cacheKey?: string;
}

interface UseOdooModelReturn<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T[]>>;
}

export function useOdooModel<T = any>(
  model: string,
  opts: UseOdooModelOptions = {}
): UseOdooModelReturn<T> {
  const { autoFetch = true, cacheKey, ...searchOpts } = opts;
  const optsStr = JSON.stringify(searchOpts);

  const [data, setData] = useState<T[]>(() => {
    if (!cacheKey) return [];
    try {
      const raw = localStorage.getItem(cacheKey);
      return raw ? (JSON.parse(raw) as T[]) : [];
    } catch {
      return [];
    }
  });

  // Show loading spinner only when we have no cached data to display
  const hasCached = useRef(cacheKey ? !!localStorage.getItem(cacheKey) : false);
  const [loading, setLoading] = useState(!hasCached.current);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!hasCached.current) setLoading(true);
    setError(null);
    try {
      const result = await searchRead<T>(model, JSON.parse(optsStr) as SearchReadOptions);
      const r = result || [];
      setData(r);
      if (cacheKey) {
        localStorage.setItem(cacheKey, JSON.stringify(r));
        hasCached.current = true;
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
      if (!hasCached.current) setData([]);
    } finally {
      setLoading(false);
    }
  }, [model, optsStr, cacheKey]);

  useEffect(() => {
    if (autoFetch) fetchData();
  }, [fetchData, autoFetch]);

  return { data, loading, error, refetch: fetchData, setData };
}
