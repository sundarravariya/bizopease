import axios from 'axios';
import { getOdooDb } from '../config/tenant';

const BASE_URL = import.meta.env.VITE_ODOO_URL || '';

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
  timeout: 30000,
});

/** Override base URL at runtime (used by the standalone Kiosk APK). */
export function setOdooBaseUrl(url: string) {
  api.defaults.baseURL = url;
}

let _reqId = 1;
const nextId = () => _reqId++;

// ---------- Core JSON-RPC ----------
async function jsonRpc<T>(endpoint: string, params: Record<string, any>): Promise<T> {
  const payload = {
    jsonrpc: '2.0',
    method: 'call',
    id: nextId(),
    params,
  };
  const { data } = await api.post<{ result?: T; error?: any }>(endpoint, payload);
  if (data.error) {
    const msg = data.error?.data?.message || data.error?.message || 'Odoo error';
    throw new Error(msg);
  }
  return data.result as T;
}

// ---------- Auth ----------
export async function odooLogin(login: string, password: string, db = getOdooDb()) {
  return jsonRpc<any>('/web/session/authenticate', { db, login, password });
}

export async function odooLogout() {
  return jsonRpc<any>('/web/session/destroy', {});
}

export async function odooGetSession() {
  return jsonRpc<any>('/web/session/get_session_info', {});
}

// ---------- Model CRUD ----------
export interface SearchReadOptions {
  fields?: string[];
  domain?: any[];
  limit?: number;
  offset?: number;
  order?: string;
}

export async function searchRead<T = any>(
  model: string,
  opts: SearchReadOptions = {}
): Promise<T[]> {
  const { domain = [], fields = [], limit = 0, offset = 0, order } = opts;
  return jsonRpc<T[]>('/web/dataset/call_kw', {
    model,
    method: 'search_read',
    args: [domain],
    kwargs: { fields, limit, offset, ...(order ? { order } : {}) },
  });
}

export async function readRecord<T = any>(model: string, ids: number[], fields: string[] = []): Promise<T[]> {
  return jsonRpc<T[]>('/web/dataset/call_kw', {
    model,
    method: 'read',
    args: [ids],
    kwargs: { fields },
  });
}

export async function createRecord(model: string, values: Record<string, any>): Promise<number> {
  return jsonRpc<number>('/web/dataset/call_kw', {
    model,
    method: 'create',
    args: [values],
    kwargs: {},
  });
}

export async function writeRecord(model: string, ids: number[], values: Record<string, any>): Promise<boolean> {
  return jsonRpc<boolean>('/web/dataset/call_kw', {
    model,
    method: 'write',
    args: [ids, values],
    kwargs: {},
  });
}

export async function unlinkRecord(model: string, ids: number[]): Promise<boolean> {
  return jsonRpc<boolean>('/web/dataset/call_kw', {
    model,
    method: 'unlink',
    args: [ids],
    kwargs: {},
  });
}

export async function callMethod<T = any>(
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {}
): Promise<T> {
  return jsonRpc<T>('/web/dataset/call_kw', {
    model,
    method,
    args,
    kwargs,
  });
}

export const odooCall = callMethod;

// True when the current Odoo user is a manager/admin (Settings access).
// Prefer the session_info flags (authoritative); fall back to a group check.
export async function userIsManager(): Promise<boolean> {
  try {
    const s: any = await odooGetSession();
    if (s && typeof s.is_system !== 'undefined') return !!s.is_system;
    if (s && typeof s.is_admin !== 'undefined') return !!s.is_admin;
  } catch { /* ignore */ }
  try {
    return await callMethod<boolean>('res.users', 'has_group', ['base.group_system']);
  } catch {
    return false;
  }
}

// Internal (non-portal) users available as task assignees.
export async function listInternalUsers(): Promise<{ id: number; name: string }[]> {
  try {
    const r = await searchRead<{ id: number; name: string }>('res.users', {
      fields: ['id', 'name'],
      domain: [['share', '=', false], ['active', '=', true]],
      limit: 0,
      order: 'name',
    });
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

/** res.users ids that belong to the system/admin group (base.group_system). */
export async function listAdminUserIds(): Promise<number[]> {
  try {
    const gd = await searchRead<{ res_id: number }>('ir.model.data', {
      domain: [['module', '=', 'base'], ['name', '=', 'group_system']], fields: ['res_id'], limit: 1,
    });
    const gid = gd?.[0]?.res_id;
    if (!gid) return [];
    const us = await searchRead<{ id: number }>('res.users', {
      domain: [['groups_id', 'in', [gid]]], fields: ['id'], limit: 0,
    });
    return (us || []).map(u => u.id);
  } catch {
    return [];
  }
}

/**
 * Real staff employees — hr.employee records, excluding any whose linked login
 * is an admin (admins get an hr.employee on account creation but aren't staff).
 */
export async function listStaffEmployees<T = any>(fields: string[] = ['id', 'name']): Promise<T[]> {
  const f = Array.from(new Set([...fields, 'user_id']));
  const [emps, adminIds] = await Promise.all([
    searchRead<any>('hr.employee', { fields: f, domain: [['active', '=', true]], order: 'name', limit: 0 }),
    listAdminUserIds(),
  ]);
  return (emps || []).filter((e: any) => !(e.user_id && adminIds.includes(e.user_id[0]))) as T[];
}

export async function searchCount(model: string, domain: any[] = []): Promise<number> {
  return jsonRpc<number>('/web/dataset/call_kw', {
    model,
    method: 'search_count',
    args: [domain],
    kwargs: {},
  });
}

export interface ReadGroupOptions {
  domain?: any[];
  fields: string[];
  groupby: string[];
  limit?: number;
  offset?: number;
  orderby?: string;
  lazy?: boolean;
}

export async function readGroup<T = any>(model: string, opts: ReadGroupOptions): Promise<T[]> {
  const { domain = [], fields, groupby, limit = false, offset = 0, orderby, lazy = false } = opts;
  return jsonRpc<T[]>('/web/dataset/call_kw', {
    model,
    method: 'read_group',
    args: [domain, fields, groupby],
    kwargs: { limit, offset, ...(orderby ? { orderby } : {}), lazy },
  });
}

export async function getSum(model: string, domain: any[], field: string): Promise<number> {
  try {
    const result = await readGroup<any>(model, {
      domain,
      fields: [`${field}:sum`],
      groupby: [],
      limit: 1,
    });
    return Number(result?.[0]?.[field]) || 0;
  } catch {
    return 0;
  }
}

// ---------- Dashboard / Reporting ----------
export async function getDashboardStats() {
  try {
    const [salesCount, purchaseCount, invoiceCount, productCount] = await Promise.all([
      searchCount('sale.order', [['state', 'in', ['sale', 'done']]]),
      searchCount('purchase.order', [['state', 'in', ['purchase', 'done']]]),
      searchCount('account.move', [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']]),
      searchCount('product.template', [['active', '=', true]]),
    ]);
    return { salesCount, purchaseCount, invoiceCount, productCount };
  } catch {
    return { salesCount: 0, purchaseCount: 0, invoiceCount: 0, productCount: 0 };
  }
}

// ---------- Custom Addon: Flipkart OS ----------
export async function getFbfReplenishment() {
  return searchRead('flipkart.fbf.replenishment', { fields: ['id', 'name', 'product_id', 'warehouse_id', 'recommended_qty', 'current_qty', 'velocity', 'state'], limit: 100 });
}

export async function getSettlementVendors() {
  return searchRead('flipkart.bill.payment.vendor', { fields: ['id', 'name', 'phone', 'deduction_percent', 'balance'], limit: 100 });
}

export async function getMoneyAssociates() {
  return searchRead('flipkart.money.associate', { fields: ['id', 'name', 'phone', 'balance'], limit: 100 });
}

export async function getCarryingAgents() {
  return searchRead('flipkart.carrying.agent', { fields: ['id', 'name', 'contact_details', 'outstanding_balance'], limit: 100 });
}

export async function getDeadStock() {
  return searchRead('flipkart.dead.stock', { fields: ['id', 'product_id', 'quantity', 'days_idle', 'warehouse_id', 'suggested_action'], limit: 100 });
}

export async function getConsignments() {
  return searchRead('flipkart.consignment', { fields: ['id', 'name', 'partner_id', 'state', 'date_from', 'date_to', 'amount_total'], limit: 100 });
}

export default api;
