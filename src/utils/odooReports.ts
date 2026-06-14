// Native Odoo QWeb PDF reports, downloaded via the report controller using the
// active portal session (same origin, cookies sent). Report names verified on
// the production instance.

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
  const res = await fetch(odooReportUrl(reportName, id), { credentials: 'include' });
  if (!res.ok) throw new Error(`Could not generate PDF (HTTP ${res.status})`);
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
