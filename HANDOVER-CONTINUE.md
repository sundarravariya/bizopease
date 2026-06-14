# ROBIFEL PORTAL - CONTINUATION HANDOVER (updated 2026-06-13 evening)

Paste this whole file into a fresh AI session to continue. The portal is a React UI that is a
COMPLETE replacement for the Odoo 18 backend UI + the flipkart_os / b2b_os custom addons -
same business logic, better UI/UX. Odoo stays the backend; the portal is a thin JSON-RPC client.
(The original full project bible is handover.md in this same folder - read it too for deep model details.)

Read this fully, then read the addon source + existing UI, produce a gap report, and execute
screen-by-screen. PLAN with Opus, WRITE code with Sonnet, use parallel sub-agents for independent screens.

================================================================================
## INFRASTRUCTURE
================================================================================
- Local project: C:\Users\Sachi\.gemini\antigravity-ide\scratch\robifel_portal
- Stack: React 18 + TS 5 + Vite 5 + Tailwind 3 + React Router v6 (basename="/portal"), Recharts, Lucide.
  Dark theme: page #0f1422, cards #161b2e / border #2a3250, accent #7367f0.
- Production: https://odoo.robifel.in/portal/   (DO NOT BREAK)
- Server: root@82.180.144.9 (SSH key trusted). Odoo DB: robifel. Service: odoo.service (:8069).
- Custom addons: /opt/odoo/custom_addons/ -> flipkart_os (primary), b2b_os, plus accounting_pdf_reports,
  material_theme, product_quantity_pricing, sr_product_multiple_barcode.
- Deploy: from project root run `npm run deploy` (tsc + vite build --base=/portal/ + scp dist/* to
  root@82.180.144.9:/var/www/robifel-portal/). Verify: ssh ... "ls -t /var/www/robifel-portal/assets/".
- PERMISSIONS: ssh/scp are allowlisted. systemctl restart odoo is BLOCKED for the agent - the USER
  must run any service restart in their own terminal.

================================================================================
## HOW SYNC WORKS
================================================================================
The portal has NO database of its own. Every read/write hits the same Odoo DB via src/services/odoo.ts:
searchRead<T>(model,{fields,domain,limit,order}) [ALWAYS limit:0 for lists], readRecord, createRecord->id,
writeRecord, unlinkRecord, odooCall/callMethod(model,method,args,kwargs), searchCount, readGroup.
UI<->Odoo are inherently in sync (one source of truth); UI re-fetches on load / Sync button.
"Out of sync" is almost always a CREATE failing on a wrong field name -> verify field names vs the
model source before writing.

================================================================================
## SESSION 2026-06-13 EVENING — WHAT WAS DONE
================================================================================

### 1. Order line tables — mobile UX fix (overflow-x-auto + larger inputs)
Applied identical pattern to ALL these files:
- src/components/modules/Sales/SalesOrders.tsx
- src/components/modules/FlipkartOS/QuickSaleOrder.tsx
- src/components/modules/Sales/Quotations.tsx  (detail modal only)
- src/components/modules/Purchase/PurchaseOrders.tsx  (create form + detail view)
- src/components/modules/Purchase/Rfq.tsx
- src/components/modules/Accounting/Invoices.tsx
- src/components/modules/Accounting/Bills.tsx

Pattern used:
```tsx
// Wrapper: overflow-x-auto (was overflow-hidden)
<div className={`rounded-xl border overflow-x-auto ...`}>
  // Table: explicit min-width so columns never collapse
  <table className="w-full min-w-[560px]">  // 640 for Invoices (extra tax col), 820 for SalesOrders
    // Header: text-xs py-3  (was text-[10px] py-2)
    // Product td: min-w-[200px]
    // Inputs: text-sm py-3  (was text-xs py-1.5)
    // Dropdown items: py-2 text-sm  (was py-1.5 text-xs)
    // Trash icon: size={14}  (was size={12})
    // Totals footer: text-sm py-3, text-base font-black
```

### 2. Money Manager (SettlementStudio) floating buttons — desktop layout fix
File: src/components/modules/Settlements/SettlementStudio.tsx

Problem: buttons used `fixed bottom-5 left-3 right-3` which spans full viewport including sidebar on desktop.
Fix: added `lg:left-[296px] lg:right-6 lg:gap-3 lg:bottom-6` (sidebar is `w-72` = 288px + 8px gap).
Also bumped icon size to 14, height to `lg:h-12`, text to `lg:text-sm`.

```tsx
<div className="fixed bottom-5 left-3 right-3 z-40 flex items-stretch gap-2 lg:left-[296px] lg:right-6 lg:gap-3 lg:bottom-6">
```

### 3. QZ Tray direct print — ConsignmentManager
File: src/components/modules/FlipkartOS/ConsignmentManager.tsx
File: index.html

**index.html** — added QZ Tray CDN:
```html
<script src="https://cdn.qz.io/qz-tray/2.2.4/qz-tray.js"></script>
```

**ConsignmentManager** changes:
- Added state: `qzPrinter` (localStorage `qz_printer_name`), `showPrinterPicker`, `availablePrinters`, `loadingPrinters`
- Added helpers:
  - `connectQz()` — connects to `window.qz` WebSocket, sets unsigned cert/signature
  - `loadPrinters()` — lists printers from QZ Tray, shows picker modal
  - `getAttachmentIdFromResult(result)` — extracts attachment ID from `ir.actions.act_url` URL or `ir.actions.client` params
  - `printTsplViaQz(result)` — fetches `ir.attachment.datas` (base64), decodes, sends raw TSPL to selected printer
- Updated 3 handlers to call `printTsplViaQz` instead of `handleActionUrl`:
  - `handlePrintDirectQz` (barcode labels)
  - `handlePrintBoxSlipQz` (per-box packing slip)
  - `handlePrintAllBoxSlips` (all boxes at once)
- Added "Set Printer" button (amber = printer set, red = no printer) in detail view action buttons
- Added `{showPrinterPicker && ...}` modal at end of JSX

**NOTE**: if QZ actions return a different result structure than expected, log `result` and adjust `getAttachmentIdFromResult`. The TSPL content is always base64-encoded in `ir.attachment.datas`.

### 4. Persistent login
**Server**: added `session_lifetime = 7776000` (90 days) to `/etc/odoo/odoo.conf`, restarted Odoo.
**Frontend** (src/context/AuthContext.tsx): added 4-minute keep-alive ping:
```tsx
useEffect(() => {
  if (!user) return;
  const interval = setInterval(() => {
    odooGetSession().catch(() => {});
  }, 4 * 60 * 1000);
  return () => clearInterval(interval);
}, [user]);
```

================================================================================
## DONE + DEPLOYED (verified this session)
================================================================================
- Purchase Orders: RFQ->Confirm(button_confirm)->Receive(real stock.picking validate -> fires
  carrying-agent ledger)->Create Bill(action_create_invoice). Custom fields carrying_agent_id,
  exchange_rate(15), deposit_paid, shipping_cost, total_inr/net_agent_liability_inr.
- RFQ: button_confirm, action_rfq_send, action_compare_prices, custom fields.
- Vendor Price List (NEW, /purchase/price-list): product.supplierinfo incl price_inr, exchange_rate_used.
- Sales Orders + Quick Sale (NEW, /flipkart/quick-sale): create+action_confirm (auto delivery+invoice+
  dashboard). Quotations stay draft. Added pricelist_id, payment_term_id, client_order_ref.
- Invoices + Bills: account.move create+action_post, per-line tax_ids, invoice_payment_term_id, due
  date, ref; payment via account.payment.register -> action_create_payments.
- Transfers: stock.picking create + Reserve + Validate (backorder wizard handled).
- Reordering: stock.warehouse.orderpoint inline min/max + action_replenish + run_scheduler.
- Products: FIXED Odoo-18 type bug (type is consu/service only; storable = is_storable bool) + barcode.
- Unified Ledger: summary + 4 ledgers. Vendors load from flipkart.bill.payment.vendor (NOT res.partner)
  - that was the "beauty vendor missing" bug.
- Create Entry wizard (CreateEntry.tsx + Unified Ledger create tab): FIXED. Real
  flipkart.bill.payment.entry.wizard fields: entry_type(bank_transfer/receive_payment/agent_payment/
  expense/associate_transfer), vendor_id, transaction_id, transfer_amount, deduction_percent,
  received_by_id, to_associate_id, actual_cash_received (NOT payment_received/expense_amount),
  agent_payment_source ('vendor'|'associate', NOT 'self'), carrying_agent_id, agent_payment_amount, note.
  manual_partner -> business.manual.entry.wizard (partner_id,date,narration,amount,entry_type
  debit/credit/setoff) -> action_post_entry.
- Consignment Manager: REWORKED box creation to single-page editor (dimensions + pre-filled pending-SKU
  table, qty capped to qty_remaining) -> createRecord('flipkart.box') then flipkart.box.line per row.
  Preserved 5 state methods, CSV action_parse_csv, barcode, QZ/PDF slips, delete, add-items,
  add-all-pending. QC columns + search bar added.
- FBF Live Stock: brand, warehouse_config_id, fulfilment_type, f_assured cols + filters.
- Supplier Reorders: action_required filter, reorder/next-order/pipeline cols (bulk generate-PO).
- Returns Management: bulk confirm_inward/reject + scan + reverse.
- Login: removed default "admin". Mojibake swept across many screens.
- /dashboard OLD React build: REMOVED. Was flipkart_os/controllers/api.py (HeadlessApiController:
  /dashboard + /api/headless/execute). Trimmed to empty controller; backup api.py.bak; odoo restarted;
  /dashboard now 404; /portal untouched.
- Capacitor: NATIVE SHELL loading https://odoo.robifel.in/portal/ (server.url in capacitor.config.ts;
  appId in.robifel.portal; android/ Gradle project present; `npx cap sync android` done).

================================================================================
## REMAINING TODO
================================================================================
1. VISUAL-VERIFY (compiled+deployed but not eyeballed vs Odoo views): B2B Orders, B2B Partner Ledger
   (read b2b_os models+views first), Dead Stock, Stock Valuation, Daily Orders, Sales Dashboard.
   For each: read the model + its *_views.xml and confirm every column/filter/button is present+wired.
2. BUTTON SWEEP of action_* methods in daily_order.py, sales_dashboard.py, returns_management.py,
   ai_assistant.py, carrying_agent.py, stock_move.py - each backend button needs a UI control.
3. CAPACITOR APK COMPILE - project ready; needs Android toolchain (JDK 17 + Android SDK). Build via
   Android Studio (open android/ folder -> Build APK) OR `cd android && gradlew.bat assembleDebug`
   (APK at android/app/build/outputs/apk/debug/app-debug.apk) OR a GitHub Actions cloud build (needs
   the project turned into a git repo first).
4. QZ TRAY PRINT VERIFY - test that `getAttachmentIdFromResult()` correctly parses the result object
   returned by `action_print_qz` and `action_print_packing_slip_qz`. Log `result` to console on first
   test. The TSPL content lives in `ir.attachment.datas` (base64). Unsigned mode requires QZ Tray to
   be configured to allow unsigned requests on the printing computer.
5. Expense Manager CSV export — currently client-side only (downloads from in-memory data). Consider
   a server-side export if needed for large datasets.
6. Tasks module packing-task auto-creation — was discussed but not implemented.

================================================================================
## RULES
================================================================================
- PURE ASCII in all TSX ("Rs." not rupee glyph, "--" not em-dash, "..." not ellipsis). Mojibake breaks
  the build; clean UTF-8 is fine but ASCII is safest.
- ALWAYS limit:0 on list searchRead. Many2one [id,name]|false -> guard Array.isArray.
- Wizard pattern: createRecord(wizardModel,vals) -> odooCall(wizardModel,method,[[id]],{}).
- NEVER invent backend fields/methods - grep the addon source to confirm first.
- try/catch every Odoo call with a toast. Re-sync after every mutation. Build (green) + deploy after
  each screen. Do not break /portal. Sub-agents read their model+view before editing.

================================================================================
## START HERE
================================================================================
1. Confirm ssh/scp. 2. Sub-agents read remaining flipkart_os + b2b_os models AND views.
3. Visual-verify REMAINING #1-2, fix gaps screen-by-screen (build+deploy each). 4. Then the APK.
Goal: every Odoo screen/button/field present + synced, with better UI/UX.
