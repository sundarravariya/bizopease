import { searchRead } from './odoo';

// A selectable GST rate backed by a real Odoo account.tax record so that
// confirmed orders / invoices carry the correct tax in the Odoo backend.
export interface GstRate {
  rate: number;        // percentage, e.g. 18
  taxId: number;       // account.tax id
  label: string;       // e.g. "18% GST"
}

// Pick, for each percentage, the best matching tax. Intra-state combined GST
// (CGST+SGST, shown as "X% GST S") is preferred; inter-state IGST is the
// fallback when a plain GST tax does not exist for that rate (e.g. 5% sale).
// Reverse-charge / CESS / SEZ / export-LUT variants are excluded.
export async function loadGstRates(use: 'sale' | 'purchase'): Promise<GstRate[]> {
  let taxes: any[] = [];
  try {
    taxes = await searchRead<any>('account.tax', {
      domain: [['type_tax_use', '=', use], ['active', '=', true], ['amount_type', '=', 'percent']],
      fields: ['id', 'name', 'amount'],
      limit: 0,
      order: 'amount asc',
    });
  } catch {
    return [];
  }
  if (!Array.isArray(taxes)) return [];

  const priorityFor = (name: string): number => {
    if (/RC\b|RCM|CESS|SEZ|EX-LUT|EXPORT/i.test(name)) return -1; // excluded
    if (/\bGST\b/i.test(name) && !/IGST/i.test(name)) return 2;   // intra-state combined
    if (/IGST/i.test(name)) return 1;                             // inter-state fallback
    return 0;                                                     // other percent taxes
  };

  const best = new Map<number, { taxId: number; prio: number }>();
  for (const t of taxes) {
    const amt = Math.round((Number(t.amount) || 0) * 100) / 100;
    if (amt <= 0) continue;
    const prio = priorityFor(String(t.name || ''));
    if (prio < 0) continue;
    const cur = best.get(amt);
    if (!cur || prio > cur.prio) best.set(amt, { taxId: t.id, prio });
  }

  return Array.from(best.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({ rate, taxId: v.taxId, label: `${rate}% GST` }));
}

// ----- line math shared by every order form -----
export interface TaxableLine {
  qty: number;
  price: number;
  discount: number; // percent 0-100
  gstRate: number;  // percent; 0 = no tax
}

export function lineUntaxed(l: TaxableLine): number {
  const disc = Math.min(Math.max(l.discount || 0, 0), 100);
  return (l.qty || 0) * (l.price || 0) * (1 - disc / 100);
}

export function lineTax(l: TaxableLine, gstEnabled: boolean): number {
  if (!gstEnabled) return 0;
  return lineUntaxed(l) * (Math.max(l.gstRate || 0, 0) / 100);
}

export interface OrderTotals { untaxed: number; tax: number; total: number; }

export function computeTotals(lines: TaxableLine[], gstEnabled: boolean): OrderTotals {
  let untaxed = 0, tax = 0;
  for (const l of lines) {
    untaxed += lineUntaxed(l);
    tax += lineTax(l, gstEnabled);
  }
  return { untaxed, tax, total: untaxed + tax };
}

// Build the Odoo tax_id command for an order line.
// GST off, or rate 0 -> clear all taxes; otherwise set exactly the chosen tax.
export function taxCommand(gstEnabled: boolean, taxId: number | null): [number, number, number[]][] {
  if (gstEnabled && taxId) return [[6, 0, [taxId]]];
  return [[6, 0, []]];
}
