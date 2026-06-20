// Native Odoo QWeb PDF reports, downloaded via the report controller using the
// active portal session (same origin, cookies sent). Report names verified on
// the production instance. Queen tenants are routed through the auth-gated queen
// proxy so the PDF is rendered from the queenfinger DB, never robifel.

import { isQueenSession, getQueenToken } from '../services/queen';

export const REPORTS = {
  saleOrder: 'sale.report_saleorder',                  // Sales Order / Quotation
  purchaseOrder: 'purchase.report_purchaseorder',      // Purchase Order
  rfq: 'purchase.report_purchasequotation',            // Request for Quotation
  invoice: 'account.report_invoice_with_payments',     // Customer Invoice / Vendor Bill
} as const;

/** Build the Odoo report download URL (absolute from the domain root). */
export function odooReportUrl(reportName: string, id: number): string {
  return `/report/pdf/${reportName}/${id}`;
}

/**
 * Download a record's PDF report. Fetches with the session cookie (works in the
 * web app and the native WebView), then saves it with a friendly filename.
 */
export async function downloadOdooReport(reportName: string, id: number, filename: string): Promise<void> {
  const queen = isQueenSession();
  const reportUrl = queen
    ? `/api/queen/report/pdf/${reportName}/${id}`
    : odooReportUrl(reportName, id);
  const res = await fetch(reportUrl, {
    credentials: 'include',
    headers: queen ? { Authorization: 'Bearer ' + getQueenToken() } : undefined,
  });
  if (!res.ok) throw new Error(`Could not generate PDF (HTTP ${res.status})`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/pdf')) {
    throw new Error('Session expired or report unavailable — please refresh and log in again');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
