# ROBIFEL PORTAL — COMPLETE HANDOVER DOCUMENT
> Last updated: 2026-06-12 | Build: deployed to production

---

## 1. WHAT THIS PROJECT IS

A **React 18 + TypeScript + Vite + Tailwind CSS 3** Single Page Application that is a custom admin portal for **Odoo 18 Community Edition**. Served at `https://odoo.robifel.in/portal/` via nginx (basename="/portal"). Communicates 100% through Odoo's standard JSON-RPC API.

**The master goal**: Replicate ALL Odoo 18 standard functionality + ALL custom addon features with the exact same business logic, but with a dramatically better UI/UX design. Every screen, every button, every field, every workflow state transition must exist in the portal. Nothing missing.

---

## 2. INFRASTRUCTURE

### Server
- **IP**: `82.180.144.9`
- **SSH**: `root@82.180.144.9` (no password needed from dev machine)
- **Odoo version**: 18.0-20260102, running as `odoo` service
- **Odoo JSON-RPC**: `https://odoo.robifel.in/web/dataset/call_kw`
- **Odoo login**: `https://odoo.robifel.in/web`

### Nginx config
- Portal static files: `/var/www/robifel-portal/`
- Served at: `https://odoo.robifel.in/portal/`
- SPA fallback: `try_files $uri $uri/ @portal_fallback` → rewrites to `/portal/index.html`

### Deploy command (run from local project root)
```bash
npm run build
scp -r "dist/." root@82.180.144.9:/var/www/robifel-portal/
```

### Local project
```
C:\Users\Sachi\.gemini\antigravity-ide\scratch\robifel_portal\
```

---

## 3. CUSTOM ADDONS (Server: `/opt/odoo/custom_addons/`)

Six custom addons are installed. The primary one is `flipkart_os`.

### 3a. `flipkart_os` — Business OS (PRIMARY ADDON)
**Manifest**: Version 18.0.3.5.0, depends on base, web, mail, stock, mrp, purchase, purchase_stock

#### Model: `flipkart.account`
```python
name = Char(required, unique)
is_active = Boolean(default True)
```
Represents Flipkart seller accounts (Robifel, Roxxcart).

#### Model: `flipkart.warehouse.config`
```python
name = Char(required)
account_id = Many2one('flipkart.account', required)
backend_warehouse_id = Many2one('stock.warehouse')
flipkart_warehouse_code = Char(required)  # From FBF CSV header
transit_days = Integer(default 3)
is_active = Boolean(default True)
```

#### Model: `flipkart.fbf.stock`
All fields from the FBF CSV upload:
```python
account_id, warehouse_config_id, product_id, sku, fsn, title, brand, selling_price
qty_live, sales_7d, sales_14d, sales_30d, sales_60d, sales_90d
b2b_scheduled, transfers_scheduled, b2b_shipped, transfers_shipped
b2b_receiving, transfers_receiving, reserved_orders, reserved_internal
returns_processing, orders_to_dispatch, recalls_to_dispatch
damaged, qc_reject, catalog_reject, returns_reject, seller_return_reject, miscellaneous
length_cm, breadth_cm, height_cm, weight_kg, fulfilment_type, f_assured
```

#### Model: `flipkart.fbf.replenishment`
```python
account_id, warehouse_config_id, product_id, sku, fsn
selected = Boolean  # Toggle for consignment creation
# Inputs:
fbf_stock, sales_7d, sales_14d, in_transit, transit_days
target_cover_days(default 14), critical_days(default 7), moderate_days(default 21)
# Computed (stored):
daily_sales, qty_to_send, days_cover_after
urgency = Selection(['critical','moderate','healthy'])
urgency_sequence = Integer
```
**Wizard** `flipkart.fbf.replenishment.generate`:
- Field: `account_id` (Many2one flipkart.account)
- Method: `action_generate` — deletes old records for account, regenerates from FBF stock
- **Portal usage**: `createRecord('flipkart.fbf.replenishment.generate', {account_id: N})` then `odooCall(..., 'action_generate', [[wizardId]], {})`

#### Model: `flipkart.supplier.reorder`
```python
product_id, sku
# Stock:
physical_stock, total_fbf_stock, incoming_qty, next_po_arrival_date
# Sales:
daily_avg_sales
# Config:
lead_time_days(default 60), target_cover_days(default 30), order_cycle_days(default 30)
# Computed (stored):
total_available, pipeline_lowest_days, days_in_hand, stockout_date
order_now_qty, next_order_date, next_order_qty, reorder_trigger_date, reorder_qty
action_required = Boolean  # True when order needs to be placed
urgency = Selection(['critical','moderate','healthy'])
urgency_sequence = Integer
```
**Wizard** `flipkart.supplier.reorder.generate`:
- Field: `warehouse_id` (Many2one stock.warehouse)
- Method: `action_generate`

#### Model: `flipkart.consignment`
```python
name = Char(sequence, copy=False)
account = Selection([('robifel','Robifel'),('roxxcart','Roxxcart')], required)
warehouse_id = Many2one('stock.warehouse', required)
pickup_date = Date(required, default today)
state = Selection(['draft','rtd','picked_up','inwarded','rejected'])
csv_file = Binary, csv_file_name = Char
line_ids = One2many('flipkart.consignment.line', 'consignment_id')
box_ids = One2many('flipkart.box', 'consignment_id')
picking_id = Many2one('stock.picking', readonly)
```
**Methods**:
- `action_parse_csv` — parse uploaded CSV, create consignment lines
- `action_generate_barcodes` — generate barcode PDF for all lines
- `action_mark_rtd` — draft → rtd
- `action_mark_picked_up` — rtd → picked_up (creates stock delivery if setting enabled)
- `action_mark_inwarded` — picked_up → inwarded
- `action_mark_rejected` — any → rejected
- `action_print_all_box_packing_slips_qz` — print all box packing slips via QZ Tray

#### Model: `flipkart.consignment.line`
```python
consignment_id, product_name, fsn, sku_id, brand, size, style_code, color
isbn, model_id, quantity_sent, quantity_received
box_line_ids = One2many('flipkart.box.line', 'consignment_line_id')
qty_allocated = Integer(computed, stored)  # sum of box line quantities
qty_remaining = Integer(computed, stored)  # quantity_sent - qty_allocated
inwarded_to_store, qc_fail, qc_in_progress, qc_passed = Char
cost_price, length_cm, breadth_cm, height_cm, weight_kg = Float
```

#### Model: `flipkart.box`
```python
name = Char(required, default 'New Box')
consignment_id = Many2one('flipkart.consignment', ondelete='cascade')
line_ids = One2many('flipkart.box.line', 'box_id')
length, breadth, height, weight = Float  # dimensions
```
**Methods**:
- `action_print_packing_slip` — returns PDF binary attachment
- `action_print_packing_slip_qz` — returns TSPL string for QZ Tray direct print
- `action_add_all_pending` — adds all consignment lines with qty_remaining > 0

#### Model: `flipkart.box.line`
```python
box_id = Many2one('flipkart.box', ondelete='cascade')
consignment_line_id = Many2one('flipkart.consignment.line')
quantity = Integer
```

#### Model: `flipkart.return.management`
```python
account_id, return_id, tracking_id (indexed), fsn, sku, product_id, quantity
return_requested_date, return_type, return_reason
state = Selection(['draft','scanned','processed','rejected','cancelled'])
stock_move_ids = One2many('stock.move', 'return_id')
picking_id = Many2one('stock.picking')
```
**Methods**: `action_confirm_inward` (bulk), `action_reject`

**Wizard** `flipkart.return.upload`:
- Fields: `file_data` (Binary), `file_name`
- Method: `action_import`

**Wizard** `flipkart.return.scan.wizard`:
- Fields: `tracking_id`, `product_name` (computed), `return_record_id`
- Methods: `action_confirm_and_next`, `action_reject_and_next`
- **Portal usage**:
  ```typescript
  const wizardId = await createRecord('flipkart.return.scan.wizard', {tracking_id: '...'});
  const wizard = await searchRead('flipkart.return.scan.wizard', {domain: [['id','=',wizardId]], fields: ['product_name','return_record_id']});
  // confirm: odooCall('flipkart.return.scan.wizard', 'action_confirm_and_next', [[wizardId]], {})
  // reject:  odooCall('flipkart.return.scan.wizard', 'action_reject_and_next', [[wizardId]], {})
  ```

**Wizard** `flipkart.daily.order.upload`:
- Fields: `file_data` (Binary), `file_name`
- Method: `action_import` — parses CSV, creates sale orders with BOM-exploded stock moves

**Wizard** `flipkart.listing.upload`:
- Fields: `xls_file` (Binary), `xls_file_name`
- Method: `action_upload` — parses XLS, upserts `flipkart.listing` records

**Wizard** `flipkart.upload.wizard` (FBF inventory + sales CSV):
- Fields: `upload_type` (fbf_inventory/sales_data), `account_id`, `sales_start_date`, `sales_end_date`, `file_data`, `file_name`
- Method: `action_upload`

#### Model: `flipkart.listing` (Master Listing)
```python
fsn = Char(required, unique, indexed)
sku, name, category, mrp, selling_price = Char/Float
length_cm, breadth_cm, height_cm, weight_kg = Float
manufacturer, packer = Text
```

#### Model: `sr.multi.barcode` (FSN/Barcode mapping)
```python
name = Char  # barcode or FSN
product_id = Many2one('product.product')
barcode = Char
```

#### Model: `flipkart.sales.dashboard`
```python
account_id, partner_id, sale_order_line_id, order_number, order_date
product_id, sku_id, category, brand, vertical, fulfillment_type, location_id
gross_units, gmv, cancellation_units, cancel_amount, return_units, return_amount
final_sale_units, final_sale_amount
```

#### Model: `flipkart.bill.payment.vendor`
```python
name = Char(required)
deduction_percent = Float(default 0.0)
phone, notes = Char/Text
transaction_ids = One2many('flipkart.bill.payment.transaction', 'vendor_id')
ledger_ids = One2many('flipkart.bill.vendor.ledger', 'vendor_id')
balance = Float(computed, not stored)  # transfer - deduction - cash_received - agent_paid
```
Methods: `action_view_transactions`, `action_view_ledger`

#### Model: `flipkart.bill.payment.transaction`
```python
vendor_id = Many2one('flipkart.bill.payment.vendor')
date, name, note = Date/Char/Text
transfer_amount, deduction_amount = Float
payment_received = Boolean
actual_cash_received, expected_cash_amount = Float
agent_payment_source = Selection  # 'vendor' or other
agent_payment_amount = Float
received_by_id = Many2one('flipkart.money.associate')
```

#### Model: `flipkart.money.associate`
```python
name = Char(required)
phone, notes = Char/Text
transaction_ids = One2many('flipkart.bill.payment.transaction', 'received_by_id')
ledger_ids = One2many('flipkart.associate.ledger', 'associate_id')
balance = Float(computed, stored)  # sum of credits - debits
```

#### Model: `flipkart.associate.ledger`
```python
associate_id = Many2one('flipkart.money.associate')
date, entry_type = Date/Selection
# entry_type values: cash_received, transfer_in, agent_payment, expense, transfer_out
amount, reference, note = Float/Char/Text
```

#### Model: `flipkart.carrying.agent`
```python
name = Char(required)
contact_details = Text
outstanding_balance = Float(computed, stored)  # from ledger entries
ledger_ids = One2many('flipkart.agent.ledger', 'agent_id')
```

#### Model: `flipkart.agent.ledger`
```python
agent_id = Many2one('flipkart.carrying.agent')
date = Date(required, default today)
entry_type = Selection([('bill','Purchase Bill (+)'),('payment','Outbound Payment (-)'),('adjustment','Manual Adjustment')])
amount_inr = Float(required)
reference, notes = Char/Text
# Computed non-stored:
debit = Float  # amount_inr if bill/adjustment
credit = Float  # amount_inr if payment
balance = Float  # debit - credit
```

#### Model: `flipkart.unified.ledger.line` (SQL view, read-only)
Combines data from 4 sources:
- `account.move.line` (partner transactions, posted, receivable/payable accounts)
- `flipkart.bill.payment.transaction` (vendor bill/payments)
- `flipkart.associate.ledger` (associate transactions)
- `flipkart.agent.ledger` (agent transactions)

Fields:
```python
date, party_id(Integer), party_type(Selection: partner/vendor/associate/agent)
party_name, source_model, source_record_id, entry_type
reference, details, debit, credit, balance
```

#### Model: `flipkart.unified.ledger.summary` (SQL view, read-only)
```python
# Same data as above but aggregated per party
party_type, party_name, party_id, debit, credit, balance
```

**Create Entry Wizards**:
- `flipkart.bill.payment.entry.wizard`:
  - Fields: `entry_type` (bank_transfer/receive_payment/agent_payment/expense/associate_transfer), `vendor_id`, `agent_id`, `associate_id`, `amount`, `date`, `reference`, `note`, `transaction_id`
  - Method: `action_apply`
- `business.manual.entry.wizard`:
  - Fields: `partner_id`, `amount`, `debit_account_id`, `credit_account_id`, `date`, `reference`, `note`
  - Method: `action_post_entry`

#### Settings (`res.config.settings` inherited)
**Load**: `odooCall('res.config.settings', 'get_values', [], {})`
**Save**: `createRecord('res.config.settings', vals)` → `odooCall('res.config.settings', 'execute', [[id]], {})`

| Field | Config param key | Default |
|-------|-----------------|---------|
| `flipkart_stock_deduction_enabled` | `flipkart_os.stock_deduction_enabled` | False |
| `flipkart_returns_stock_move_enabled` | `flipkart_os.returns_stock_move_enabled` | False |
| `flipkart_consignment_stock_move_enabled` | `flipkart_os.consignment_stock_move_enabled` | True |
| `flipkart_dead_stock_sales_days` | `flipkart_os.dead_stock_sales_days` | 30 |
| `flipkart_fbf_target_cover_days` | `flipkart_os.fbf_target_cover_days` | 14 |
| `flipkart_fbf_critical_days` | `flipkart_os.fbf_critical_days` | 7 |
| `flipkart_fbf_moderate_days` | `flipkart_os.fbf_moderate_days` | 21 |
| `flipkart_supplier_sales_days` | `flipkart_os.supplier_sales_days` | 30 |
| `flipkart_supplier_lead_time_days` | `flipkart_os.supplier_lead_time_days` | 65 |
| `flipkart_supplier_target_cover_days` | `flipkart_os.supplier_target_cover_days` | 30 |
| `flipkart_supplier_order_cycle_days` | `flipkart_os.supplier_order_cycle_days` | 30 |
| `flipkart_ai_enabled` | `flipkart_os.ai_enabled` | False |
| `flipkart_ai_provider_name` | `flipkart_os.ai_provider_name` | 'OpenAI-compatible' |
| `flipkart_ai_api_url` | `flipkart_os.ai_api_url` | (URL) |
| `flipkart_ai_model` | `flipkart_os.ai_model` | 'minimax-m2.5-free' |
| `flipkart_ai_api_key` | `flipkart_os.ai_api_key` | (empty) |
| `flipkart_ai_api_format` | `flipkart_os.ai_api_format` | 'openai_chat' |
| `flipkart_ai_timeout` | `flipkart_os.ai_timeout` | 60 |
| `flipkart_ai_temperature` | `flipkart_os.ai_temperature` | 0.2 |

---

### 3b. `b2b_os` — B2B Operations

#### Model: `b2b.ledger` (SQL view)
```python
date, partner_id, move_id, name, ref
debit, credit, balance, amount_currency, currency_id
account_id, company_id
```
Source: `account_move_line` where `account_type IN ('asset_receivable','liability_payable')` and `move.state = 'posted'`
Special: `unlink()` cascades to delete the source journal entry (intentional B2B workflow)

#### Model: `b2b.ledger.summary` (SQL view)
```python
partner_id, debit, credit, balance
```
Method: `action_open_ledger_details` — opens B2B ledger filtered for partner

Other: `sale.order`, `product.template`, `res.partner` extended with B2B fields, website portal controllers.

---

### 3c. `accounting_pdf_reports` — PDF Financial Reports
- Extends standard accounting with printable PDF reports
- Wizards: General Ledger, Partner Ledger, Trial Balance, Journal Audit, Tax Report, Aged Partner Balance
- These are invoked from Accounting > Reports in the portal

---

### 3d. `sr_product_multiple_barcode` — Multi-Barcode
- `sr.multi.barcode`: `name` (barcode), `product_id`, `barcode`
- Used for FSN-to-product mapping in consignments and daily orders

---

### 3e. `product_quantity_pricing` — Quantity-based Pricing
- Extends product pricing with quantity tiers (B2B use)

---

## 4. ODOO API — HOW THE PORTAL CALLS ODOO

All API calls go through `src/services/odoo.ts`. Never bypass this file.

### Core functions:
```typescript
// Search and read records — ALWAYS use limit: 0 for no limit
searchRead<T>(model: string, opts: {
  fields: string[],
  domain?: any[],      // Odoo domain: [['field','operator','value'], ...]
  limit?: number,      // ALWAYS 0 (no limit) — never 80/100/200/300/500
  order?: string,      // e.g. 'date asc'
  offset?: number
}): Promise<T[]>

// Create a record — returns integer ID
createRecord(model: string, values: Record<string, any>): Promise<number>

// Update records
writeRecord(model: string, ids: number[], values: Record<string, any>): Promise<boolean>

// Call any model method
odooCall<T>(model: string, method: string, args: any[], kwargs: {}): Promise<T>
// Instance method (on a record):   args = [[recordId]]
// Model-level method:               args = []
// Model method with args:           args = [[recordId], otherArg, ...]
```

### Wizard pattern (CRITICAL — must always follow this):
```typescript
// 1. Create wizard record
const wizardId = await createRecord('some.wizard.model', { field1: val1 });
// 2. Call action method on it
const result = await odooCall('some.wizard.model', 'action_method_name', [[wizardId]], {});
```

### Common domain operators
```
['field','=','value']         exact match
['field','!=','value']        not equal
['field','ilike','text']      case-insensitive contains
['field','in',[1,2,3]]        in list
['field','>',0]               greater than
['field','>=','2024-01-01']   date comparison
['field','=',false]           null/false check
```

### Many2one field format
When Odoo returns a Many2one field, it's `[id, display_name]` or `false` if not set.
```typescript
Array.isArray(rec.field_id) ? rec.field_id[1] : '--'  // safe access
```

---

## 5. PORTAL — COMPLETE FILE INVENTORY

### Tech stack
- React 18, TypeScript 5, Vite 5, Tailwind CSS 3
- React Router v6 with `basename="/portal"`
- Recharts for charts, Lucide React for icons
- No external component library — all custom

### Design system (Tailwind classes used everywhere)
```typescript
// Dark mode base
bg-[#0f1422]        // page background
bg-[#161b2e]        // cards/panels
border-[#2a3250]    // borders

// Accent
#7367f0             // primary violet accent

// Text
text-[#ccd6f6]      // primary text dark
text-[#5a6a8a]      // muted text dark
text-[#8892b0]      // secondary text dark

// Reusable class vars in each component:
const cardBg = isDark ? 'bg-[#161b2e] border border-[#2a3250]' : 'bg-white border border-gray-200'
const thCls = `text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]':'text-gray-500'}`
const tdCls = `py-3 px-4 text-xs ${isDark ? 'text-[#ccd6f6]':'text-gray-700'}`
const inp = `input text-sm py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`

// Global CSS classes (defined in index.css):
.btn-primary       // violet filled button
.btn-secondary     // outlined/ghost button
.input             // styled input/select
```

### ENCODING RULE (CRITICAL)
**NEVER use non-ASCII characters in any TSX file.** The build pipeline uses esbuild which rejects smart/curly quotes and double-encoded Unicode. Always use:
- `Rs.` instead of `₹` (rupee sign)
- `--` instead of `—` (em dash)  
- `...` instead of `…` (ellipsis)
- ASCII comment separators only (use `// ---` not `// ───`)

### All routes and files

| Route | Component file | Module |
|-------|---------------|--------|
| `/dashboard` | `modules/Dashboard.tsx` | KPI cards, charts |
| `/sales/orders` | `modules/Sales/SalesOrders.tsx` | Sale orders list + detail |
| `/sales/quotations` | `modules/Sales/Quotations.tsx` | Quotations |
| `/sales/customers` | `modules/Sales/Customers.tsx` | res.partner customers |
| `/purchase/orders` | `modules/Purchase/PurchaseOrders.tsx` | purchase.order |
| `/purchase/rfq` | `modules/Purchase/Rfq.tsx` | RFQs |
| `/purchase/vendors` | `modules/Purchase/Vendors.tsx` | res.partner vendors |
| `/purchase/price-list` | `modules/Purchase/VendorPriceList.tsx` | product.supplierinfo CRUD |
| `/inventory/products` | `modules/Inventory/Products.tsx` | product.product |
| `/inventory/transfers` | `modules/Inventory/Transfers.tsx` | stock.picking |
| `/inventory/stock` | `modules/Inventory/Stock.tsx` | stock.quant |
| `/inventory/reordering` | `modules/Inventory/Reordering.tsx` | stock.warehouse.orderpoint |
| `/accounting/invoices` | `modules/Accounting/Invoices.tsx` | account.move customer invoices |
| `/accounting/bills` | `modules/Accounting/Bills.tsx` | account.move vendor bills |
| `/accounting/journal` | `modules/Accounting/Journal.tsx` | account.move.line |
| `/accounting/reports` | `modules/Accounting/Reports.tsx` | accounting_pdf_reports wizards |
| `/crm/pipeline` | `modules/CRM/Pipeline.tsx` | crm.lead (opportunity) |
| `/crm/leads` | `modules/CRM/Leads.tsx` | crm.lead |
| `/hr/employees` | `modules/HR/Employees.tsx` | hr.employee |
| `/hr/leaves` | `modules/HR/Leaves.tsx` | hr.leave |
| `/flipkart/fbf` | `modules/FlipkartOS/FbfReplenishment.tsx` | FBF replenishment + consignment creation |
| `/flipkart/fbf-stock` | `modules/FlipkartOS/FbfStock.tsx` | flipkart.fbf.stock |
| `/flipkart/scanner` | `modules/FlipkartOS/DailyOrderScanner.tsx` | flipkart.daily.order.upload |
| `/flipkart/supplier` | `modules/FlipkartOS/SupplierReorders.tsx` | flipkart.supplier.reorder |
| `/flipkart/deadstock` | `modules/FlipkartOS/DeadStockView.tsx` | flipkart.dead.stock |
| `/flipkart/consignments` | `modules/FlipkartOS/ConsignmentManager.tsx` | flipkart.consignment + boxes |
| `/flipkart/returns` | `modules/FlipkartOS/ReturnsManagement.tsx` | flipkart.return.management |
| `/flipkart/sales-dashboard` | `modules/FlipkartOS/SalesDashboard.tsx` | flipkart.sales.dashboard |
| `/flipkart/valuation` | `modules/FlipkartOS/StockValuation.tsx` | flipkart.stock.valuation |
| `/flipkart/listings` | `modules/FlipkartOS/Listings.tsx` | flipkart.listing |
| `/flipkart/upload` | `modules/FlipkartOS/UploadCenter.tsx` | All upload wizards |
| `/flipkart/setup` | `modules/FlipkartOS/FlipkartSetup.tsx` | Settings + Master Data tabs |
| `/flipkart/ledger` | `modules/FlipkartOS/UnifiedLedger.tsx` | Unified ledger all tabs |
| `/flipkart/quick-sale` | `modules/FlipkartOS/QuickSaleOrder.tsx` | Quick sale order creation |
| `/flipkart/create-entry` | `modules/FlipkartOS/CreateEntry.tsx` | 6 entry types standalone |
| `/b2b/orders` | `modules/B2B/B2BOrders.tsx` | B2B orders |
| `/b2b/ledger` | `modules/B2B/B2BLedger.tsx` | b2b.ledger summary + detail |
| `/settlements/vendors` | `modules/Settlements/SettlementsConsole.tsx` | Vendor settlements |
| `/settings/general` | `modules/Settings/GeneralSettings.tsx` | Odoo general settings |
| `/settings/profile` | `modules/Settings/Profile.tsx` | User profile |

---

## 6. WHAT WAS DONE IN PREVIOUS SESSIONS

### Completed and deployed:
1. **limit: 0** — All `searchRead` calls changed from 100/200/300/500 to 0 (no limit)
2. **FBF Replenishment** — Fixed `generate` wizard and consignment creation
3. **Supplier Reorders** — Fixed product name display, added `action_required` filter, added `next_order_date`, `next_order_qty`, `reorder_qty` columns
4. **Create Entry** standalone page at `/flipkart/create-entry` with 6 entry types
5. **Upload Center** — All 4 upload types wired to correct Odoo wizard models with correct field names
6. **FlipkartSetup** — 5 tabs: Settings (using `get_values`/`execute`), Master Listings, Flipkart FSNs, FK Accounts, Warehouse Mapping
7. **ConsignmentManager** — Box creator, Add Items modal, Add All Pending, PDF packing slip, QZ/TSC direct print
8. **VendorPriceList** — New full CRUD page for `product.supplierinfo`
9. **UnifiedLedger** — Date range filters, running balance column, totals row, CSV export on all 4 ledger tabs
10. **Encoding bug fix** — Stripped all double-encoded Unicode (smart quotes), fixed esbuild build failures

---

## 7. WHAT IS NOT DONE / NEEDS TO BE BUILT

### High Priority — Missing Odoo workflows:
1. **Sales Orders**: Confirm SO, Cancel, Create Delivery (stock picking), Create Invoice actions
2. **Purchase Orders**: Confirm PO, Receive Products, Create Bill actions
3. **Invoices**: Full payment flow — Register Payment (creates journal entry via account.payment)
4. **Bills**: Full payment flow — same as invoices
5. **Transfers**: Validate transfer, create backorder, immediate transfer
6. **Reordering Rules**: Edit min_qty/max_qty inline, trigger reorder action
7. **Returns Management**: Bulk confirm inward, bulk reject
8. **Consignment**: Upload CSV to auto-parse lines (action_parse_csv)
9. **B2B Orders**: Create B2B order, convert to SO
10. **Settlements**: Complete settlement workflow
11. **AI Assistant**: Wire to Odoo AI assistant (flipkart_os controllers/ai_assistant.py)

### Medium Priority — Form views needed:
- Every list screen needs a "Create" button with a proper form/modal
- Every row needs an "Edit" action to modify fields
- Proper validation before submit

### UI/UX improvements:
- Bulk actions on all list views (select all, bulk delete, bulk state change)
- Print/PDF buttons (invoices, purchase orders, packing slips)
- Global search across all modules
- Mobile responsiveness (currently desktop-only)
- Better empty states, loading skeletons
- Keyboard shortcuts

### Features that exist in custom addon but not in portal:
- **QZ Tray direct printing** — consignment barcodes + box labels (TSPL format)
- **BOM explosion** in daily orders (stock_move.py / daily_order.py)
- **FBF stock** upload wizard (`flipkart.upload.wizard` with upload_type=fbf_inventory)
- **Sales data** upload wizard (`flipkart.upload.wizard` with upload_type=sales_data)
- **Dead stock** view with product images
- **Stock valuation** with FIFO/average cost breakdown

---

## 8. BUGS FIXED (lessons learned — don't repeat)

### 1. Encoding — NEVER use non-ASCII in TSX
- Smart/curly quotes `"` `"` in JSX attribute values → esbuild crashes with "Expected '{' but found '"'"
- Double-encoded box-drawing characters in comments → corrupted byte sequences
- **Rule**: Every single character in every TSX file must be plain ASCII (0x00-0x7F)

### 2. createRecord vs odooCall for creation
- **Wrong**: `odooCall('model', 'create', [{field: val}], {})`
- **Correct**: `createRecord('model', {field: val})` — returns integer ID, not a list

### 3. Many2one return format
- Odoo returns `[4, "Product Name"]` not just `4` or `"Product Name"`
- Always check: `Array.isArray(rec.product_id) ? rec.product_id[1] : '--'`

### 4. Wizard execution pattern
- Always `createRecord` first to get ID, THEN `odooCall` with `[[wizardId]]`
- Never skip the create step — methods need `self.ensure_one()` which requires an existing record

### 5. limit: 0 is no limit
- `limit: 0` in Odoo JSON-RPC means "return everything" (no pagination)
- Use this for all non-paginated lists
- Only use positive integers for paginated views

---

## 9. NEW SESSION PROMPT

Use this exact prompt to start a new session:

---

**PASTE THIS AS YOUR FIRST MESSAGE:**

```
I need you to work on a React 18 + TypeScript + Vite + Tailwind CSS 3 admin portal for Odoo 18 Community Edition. Before doing ANYTHING, you must:

1. Read the full handover document at:
   C:\Users\Sachi\.gemini\antigravity-ide\scratch\robifel_portal\handover.md

2. SSH into the server (root@82.180.144.9) and read the specific Python model file(s) relevant to what we are building — before writing any code.

KEY FACTS:
- Local project: C:\Users\Sachi\.gemini\antigravity-ide\scratch\robifel_portal\
- Production URL: https://odoo.robifel.in/portal/
- Deploy: cd to project dir, run: npm run build && scp -r "dist/." root@82.180.144.9:/var/www/robifel-portal/
- Custom addons on server: /opt/odoo/custom_addons/ (especially flipkart_os and b2b_os)
- API service: src/services/odoo.ts — always use searchRead/createRecord/writeRecord/odooCall
- ALWAYS use limit: 0 in searchRead — never use 80/100/200/300/500
- Wizard pattern: createRecord(model, fields) → odooCall(model, method, [[id]], {})
- Dark theme: bg-[#0f1422] page, bg-[#161b2e] cards, #7367f0 accent
- ENCODING RULE — CRITICAL: NEVER use non-ASCII characters in any TSX file. Use Rs. not rupee symbol, use -- not em dash, use ASCII only. The build WILL FAIL with smart quotes or any non-ASCII in JSX.

THE GOAL:
Our portal must be a COMPLETE replacement for the Odoo backend UI — every screen, every button, every field, every workflow, every state transition that exists in Odoo must exist in our portal. Plus all custom addon functionality from flipkart_os and b2b_os. Same business logic, better UI/UX.

MANDATORY APPROACH:
- Use sub-agents throughout — do NOT do everything in one pass
- Use OPUS model (claude-opus-4-8) for planning and architecture decisions
- Use SONNET model (claude-sonnet-4-6) for actual code writing
- Before implementing any feature: spawn an Explore sub-agent to read the relevant Python model file on the server (SSH into root@82.180.144.9, read /opt/odoo/custom_addons/flipkart_os/models/<relevant>.py)
- Run parallel sub-agents for independent research tasks

START HERE:
1. Read handover.md fully
2. Present a comprehensive plan (what you'll build, in what order, what sub-agents you'll use)
3. Get approval before writing any code
4. Build feature by feature, testing each one
5. Run npm run build to check for errors before deploying
6. Deploy after each significant feature is complete

The 40+ screens are already built (see handover.md section 5). What's missing is complete workflows, CRUD on all screens, and all workflow state transitions. Read section 7 of handover.md for the full list of what needs to be done.
```
