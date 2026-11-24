const express = require('express');
const router = express.Router();
const db = require('../db');
const { round2, splitPieces } = require('../round');

// No start/end given = "all time". If someone somehow sends them swapped,
// straighten them out rather than returning an empty/broken range.
function normalizeRange(start, end) {
  const s = start || '0000-01-01';
  const e = end || '9999-12-31';
  return s <= e ? { start: s, end: e } : { start: e, end: s };
}

// ---- Sales report: date range + optional single customer.
// ?detailed=1 additionally attaches every line item under each invoice
// (product/unit/qty/price/total) and, for the customer(s) in view, their
// current all-time outstanding balance - independent of the date filter,
// same running-balance formula the ledger page uses. ----
router.get('/sales', (req, res) => {
  const { start, end } = normalizeRange(req.query.start, req.query.end);
  const customerId = req.query.customer_id;
  const detailed = req.query.detailed === '1';

  let where = `s.sale_date BETWEEN ? AND ?`;
  const params = [start, end];
  if (customerId) { where += ` AND s.customer_id = ?`; params.push(customerId); }

  const rows = db.prepare(`
    SELECT s.id, s.invoice_number, s.sale_date, s.total_amount, s.profit, s.received_amount, s.remaining_amount, s.customer_id, c.shop_name
    FROM sales s LEFT JOIN customers c ON s.customer_id = c.id
    WHERE ${where}
    ORDER BY s.sale_date ASC, s.id ASC
  `).all(...params);

  if (detailed && rows.length) {
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const itemRows = db.prepare(`
      SELECT si.sale_id, p.name as product_name, si.unit_type, si.quantity, si.selling_price, si.discount, si.total, si.profit
      FROM sale_items si LEFT JOIN products p ON si.product_id = p.id
      WHERE si.sale_id IN (${placeholders})
      ORDER BY si.id ASC
    `).all(...ids);
    const itemsBySale = {};
    for (const it of itemRows) {
      (itemsBySale[it.sale_id] ||= []).push({
        product_name: it.product_name || '(deleted product)',
        unit_type: it.unit_type || '', quantity: it.quantity,
        selling_price: round2(it.selling_price || 0), discount: round2(it.discount || 0),
        total: round2(it.total || 0), profit: round2(it.profit || 0),
      });
    }
    rows.forEach(r => { r.items = itemsBySale[r.id] || []; });
  }

  const totals = rows.reduce((t, r) => ({
    total_amount: t.total_amount + (r.total_amount || 0),
    profit: t.profit + (r.profit || 0),
    remaining_amount: t.remaining_amount + (r.remaining_amount || 0),
  }), { total_amount: 0, profit: 0, remaining_amount: 0 });

  // "Received this period" = actual cash that came in during [start, end],
  // from customer_payments (method != 'Return' - a return just cancels out
  // debt, it isn't cash in hand). This is intentionally NOT the same as
  // summing sales.received_amount for invoices dated in this period: a
  // payment is applied FIFO against a customer's OLDEST unpaid due first,
  // which can be an invoice from a previous period - so a Rs 10,000 payment
  // this month, with a Rs 5,000 due carried over from last month, would
  // otherwise only show Rs 5,000 "received" here (the rest silently landing
  // on last month's invoice instead). Querying payments by their own date
  // fixes that: the full Rs 10,000 shows up in the month it was actually
  // received.
  let receivedWhere = `date BETWEEN ? AND ? AND method != 'Return'`;
  const receivedParams = [start, end];
  if (customerId) { receivedWhere += ` AND customer_id = ?`; receivedParams.push(customerId); }
  const periodReceived = round2(db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM customer_payments WHERE ${receivedWhere}`).get(...receivedParams).t);

  // Customer-wise current outstanding balance - "abhi customer ka kitna
  // paisa hum pe/us pe baaki hai", all-time, not limited to this period.
  // Same formula the Customers page balance uses: remaining_amount on every
  // sale/debit is already the FIFO-settled single source of truth, so it's
  // summed directly rather than re-derived from payments (which would
  // double-count the very payments that already reduced it).
  let customerBalances = null;
  if (detailed) {
    const ids = customerId ? [Number(customerId)] : [...new Set(rows.map(r => r.customer_id).filter(Boolean))];
    customerBalances = ids.map(id => {
      const cust = db.prepare('SELECT shop_name, opening_balance FROM customers WHERE id=?').get(id);
      if (!cust) return null;
      const remaining = db.prepare('SELECT COALESCE(SUM(remaining_amount),0) t FROM sales WHERE customer_id=?').get(id).t;
      const debits = db.prepare('SELECT COALESCE(SUM(remaining_amount),0) t FROM customer_debits WHERE customer_id=?').get(id).t;
      const balance = round2((cust.opening_balance || 0) + remaining + debits);
      return { customer_id: id, shop_name: cust.shop_name, balance };
    }).filter(Boolean);
  }

  res.json({
    start, end, rows,
    totals: {
      count: rows.length,
      total_amount: round2(totals.total_amount),
      profit: round2(totals.profit),
      received_amount: periodReceived,
      remaining_amount: round2(totals.remaining_amount),
    },
    customerBalances,
  });
});

// ---- Purchases report: date range + optional single supplier/company.
// ?detailed=1 additionally attaches every line item under each invoice
// (product/qty/rate/total) and, for the supplier(s) in view, their current
// all-time outstanding balance - same running-balance formula the ledger
// page uses, independent of the date filter above. ----
router.get('/purchases', (req, res) => {
  const { start, end } = normalizeRange(req.query.start, req.query.end);
  const supplierId = req.query.supplier_id;
  const detailed = req.query.detailed === '1';

  let where = `p.purchase_date BETWEEN ? AND ?`;
  const params = [start, end];
  if (supplierId) { where += ` AND p.supplier_id = ?`; params.push(supplierId); }

  const rows = db.prepare(`
    SELECT p.id, p.invoice_number, p.purchase_date, p.total_amount, p.paid_amount, p.remaining_balance, p.supplier_id, s.company_name
    FROM purchases p LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE ${where}
    ORDER BY p.purchase_date ASC, p.id ASC
  `).all(...params);

  if (detailed && rows.length) {
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const itemRows = db.prepare(`
      SELECT pi.purchase_id, p.name as product_name, pi.quantity, pi.purchase_rate, pi.discount, pi.total
      FROM purchase_items pi LEFT JOIN products p ON pi.product_id = p.id
      WHERE pi.purchase_id IN (${placeholders})
      ORDER BY pi.id ASC
    `).all(...ids);
    const itemsByPurchase = {};
    for (const it of itemRows) {
      (itemsByPurchase[it.purchase_id] ||= []).push({
        product_name: it.product_name || '(deleted product)',
        quantity: it.quantity, purchase_rate: round2(it.purchase_rate || 0),
        discount: round2(it.discount || 0), total: round2(it.total || 0),
      });
    }
    rows.forEach(r => { r.items = itemsByPurchase[r.id] || []; });
  }

  const totals = rows.reduce((t, r) => ({
    total_amount: t.total_amount + (r.total_amount || 0),
    remaining_balance: t.remaining_balance + (r.remaining_balance || 0),
  }), { total_amount: 0, remaining_balance: 0 });

  // "Paid this period" = actual cash that went out during [start, end], from
  // supplier_payments (method != 'Return'). Same reasoning as the Sales
  // report's Received fix: a payment settles the company's OLDEST unpaid
  // invoice first (FIFO), which may belong to an earlier period, so summing
  // purchases.paid_amount by invoice date under-reports what was actually
  // paid this period. Querying payments by their own date fixes that.
  let paidWhere = `date BETWEEN ? AND ? AND method != 'Return'`;
  const paidParams = [start, end];
  if (supplierId) { paidWhere += ` AND supplier_id = ?`; paidParams.push(supplierId); }
  const periodPaid = round2(db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM supplier_payments WHERE ${paidWhere}`).get(...paidParams).t);

  // Company-wise current outstanding balance - "abhi company ka kitna paisa
  // baaki hai", all-time, not limited to this period. Same formula the
  // Companies page balance uses: remaining_balance on every purchase/debit
  // is already the FIFO-settled single source of truth, so it's summed
  // directly rather than re-derived from payments (which would double-count
  // the very payments that already reduced it).
  let companyBalances = null;
  if (detailed) {
    const ids = supplierId ? [Number(supplierId)] : [...new Set(rows.map(r => r.supplier_id).filter(Boolean))];
    companyBalances = ids.map(id => {
      const sup = db.prepare('SELECT company_name, opening_balance FROM suppliers WHERE id=?').get(id);
      if (!sup) return null;
      const remaining = db.prepare('SELECT COALESCE(SUM(remaining_balance),0) t FROM purchases WHERE supplier_id=?').get(id).t;
      const debits = db.prepare('SELECT COALESCE(SUM(remaining_amount),0) t FROM supplier_debits WHERE supplier_id=?').get(id).t;
      const balance = round2((sup.opening_balance || 0) + remaining + debits);
      return { supplier_id: id, company_name: sup.company_name, balance };
    }).filter(Boolean);
  }

  res.json({
    start, end, rows,
    totals: {
      count: rows.length,
      total_amount: round2(totals.total_amount),
      paid_amount: periodPaid,
      remaining_balance: round2(totals.remaining_balance),
    },
    companyBalances,
  });
});

// ---- Expenses report: date range, plus a quick category breakdown ----
router.get('/expenses', (req, res) => {
  const { start, end } = normalizeRange(req.query.start, req.query.end);
  const rows = db.prepare(`SELECT * FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date ASC, id ASC`).all(start, end);
  const total = round2(rows.reduce((sum, r) => sum + (r.amount || 0), 0));

  const byCategory = {};
  for (const r of rows) {
    const cat = r.category || 'Other';
    byCategory[cat] = round2((byCategory[cat] || 0) + (r.amount || 0));
  }

  res.json({ start, end, rows, totals: { count: rows.length, total_amount: total }, byCategory });
});

// ---- House Expenses report: full A-to-Z detail (every field, every entry)
// for the personal/household side, kept isolated from every business table
// exactly like backend/routes/houseExpenses.js already does. ----
router.get('/house_expenses', (req, res) => {
  const { start, end } = normalizeRange(req.query.start, req.query.end);
  const rows = db.prepare(`SELECT * FROM house_expenses WHERE date BETWEEN ? AND ? ORDER BY date ASC, id ASC`).all(start, end);
  const total = round2(rows.reduce((sum, r) => sum + (r.amount || 0), 0));

  const byCategory = {};
  for (const r of rows) {
    const cat = r.category || 'Other';
    byCategory[cat] = round2((byCategory[cat] || 0) + (r.amount || 0));
  }
  const cashTotal = round2(rows.filter(r => (r.payment_method || 'Cash') !== 'Online').reduce((s, r) => s + (r.amount || 0), 0));
  const onlineTotal = round2(rows.filter(r => r.payment_method === 'Online').reduce((s, r) => s + (r.amount || 0), 0));

  res.json({
    start, end, rows, byCategory,
    totals: { count: rows.length, total_amount: total, cash_total: cashTotal, online_total: onlineTotal },
  });
});

// ---- Profit report: net profit for a date range (sales profit - customer
// return impact - expenses), same formula the Dashboard already uses - PLUS
// the full "who/what/where" breakdown behind those numbers: which product
// made how much, which customer it went to, where every expense rupee was
// spent, and every return (both directions) with its date and party. ----
router.get('/profit', (req, res) => {
  const { start, end } = normalizeRange(req.query.start, req.query.end);

  const revenue = db.prepare(`SELECT COALESCE(SUM(total_amount),0) t FROM sales WHERE sale_date BETWEEN ? AND ?`).get(start, end).t;
  const salesProfit = db.prepare(`SELECT COALESCE(SUM(profit),0) t FROM sales WHERE sale_date BETWEEN ? AND ?`).get(start, end).t;
  const returnedProfitImpact = db.prepare(`SELECT COALESCE(SUM(total_profit_impact),0) t FROM customer_returns WHERE return_date BETWEEN ? AND ?`).get(start, end).t;
  const netSalesProfit = salesProfit - returnedProfitImpact;
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE date BETWEEN ? AND ?`).get(start, end).t;
  const netProfit = netSalesProfit - expenses;

  // Product-wise: what got sold, at what cost it came in vs what it sold
  // for, and the profit each product actually made in this period.
  const productBreakdown = db.prepare(`
    SELECT p.id as product_id, p.name, s.company_name,
      SUM(CASE WHEN si.unit_type='piece' THEN si.quantity ELSE si.quantity * COALESCE(p.pieces_per_carton,1) END) as qty_pieces,
      SUM(si.total) as revenue,
      SUM(si.profit) as profit
    FROM sale_items si
    JOIN sales sa ON si.sale_id = sa.id
    LEFT JOIN products p ON si.product_id = p.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE sa.sale_date BETWEEN ? AND ?
    GROUP BY si.product_id
    ORDER BY profit DESC
  `).all(start, end).map(r => ({
    product_id: r.product_id,
    name: r.name || '(deleted product)',
    company_name: r.company_name || '-',
    qty_pieces: round2(r.qty_pieces || 0),
    revenue: round2(r.revenue || 0),
    cost: round2((r.revenue || 0) - (r.profit || 0)),
    profit: round2(r.profit || 0),
  }));

  // Customer-wise: who bought how much, and how much profit each customer
  // brought in this period.
  const customerBreakdown = db.prepare(`
    SELECT sa.customer_id, c.shop_name,
      COUNT(DISTINCT sa.id) as invoices,
      SUM(sa.total_amount) as revenue,
      SUM(sa.profit) as profit
    FROM sales sa LEFT JOIN customers c ON sa.customer_id = c.id
    WHERE sa.sale_date BETWEEN ? AND ?
    GROUP BY sa.customer_id
    ORDER BY profit DESC
  `).all(start, end).map(r => ({
    customer_id: r.customer_id,
    shop_name: r.shop_name || '(deleted customer)',
    invoices: r.invoices,
    revenue: round2(r.revenue || 0),
    profit: round2(r.profit || 0),
  }));

  // Expenses: every rupee spent, where/on what, and who it was paid to.
  const expenseRows = db.prepare(`SELECT date, category, description, amount, paid_to FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date ASC, id ASC`).all(start, end);
  const expenseByCategory = {};
  for (const r of expenseRows) {
    const cat = r.category || 'Other';
    expenseByCategory[cat] = round2((expenseByCategory[cat] || 0) + (r.amount || 0));
  }

  // Customer returns: what came back, from whom, when, and its profit hit.
  const customerReturnRows = db.prepare(`
    SELECT cr.return_date, c.shop_name, p.name as product_name, cri.unit_type, cri.quantity, cri.total, cri.profit_impact
    FROM customer_return_items cri
    JOIN customer_returns cr ON cri.return_id = cr.id
    LEFT JOIN customers c ON cr.customer_id = c.id
    LEFT JOIN products p ON cri.product_id = p.id
    WHERE cr.return_date BETWEEN ? AND ?
    ORDER BY cr.return_date ASC
  `).all(start, end);

  // Supplier returns: what we sent back, to which company, and when.
  const supplierReturnRows = db.prepare(`
    SELECT sr.return_date, sup.company_name, p.name as product_name, sri.unit_type, sri.quantity, sri.total
    FROM supplier_return_items sri
    JOIN supplier_returns sr ON sri.return_id = sr.id
    LEFT JOIN suppliers sup ON sr.supplier_id = sup.id
    LEFT JOIN products p ON sri.product_id = p.id
    WHERE sr.return_date BETWEEN ? AND ?
    ORDER BY sr.return_date ASC
  `).all(start, end);

  res.json({
    start, end,
    revenue: round2(revenue),
    salesProfit: round2(salesProfit),
    returnedProfitImpact: round2(returnedProfitImpact),
    netSalesProfit: round2(netSalesProfit),
    expenses: round2(expenses),
    netProfit: round2(netProfit),
    productBreakdown,
    customerBreakdown,
    expenseRows,
    expenseByCategory,
    customerReturnRows,
    supplierReturnRows,
  });
});

// ---- Salesman-wise performance: date range, grouped by who made the sale.
// A sale with no salesman_id means the owner personally made it - shown as
// "Owner" rather than left blank, so nothing is silently missing from the
// breakdown.
//
// For each salesman this now returns the full "who/what/where" picture, not
// just totals: every product sold and to which customer (with cost vs sale
// price so profit is visible line-by-line), any expense entered under his
// name, and any customer return that traces back to one of his sales (via
// the return item's source_sale_item_id -> sale_items.sale_id -> salesman).
// A manual return not picked from a real past invoice has no such trail and
// can't be attributed to anyone, so it's simply left out of every salesman's
// list (it still counts fully in the Profit report).
//
// ?salesman_id= selects which group(s) come back with full detail:
//   - omitted/empty -> every salesman + Owner, all with full detail ("All")
//   - 'owner'        -> only the Owner group
//   - a numeric id    -> only that salesman
// The lightweight `summary` array (one row per salesman) always covers
// everyone regardless of this filter, so the totals table on screen never
// changes when someone drills into a single salesman. ----
router.get('/salesman', (req, res) => {
  const { start, end } = normalizeRange(req.query.start, req.query.end);
  const filter = req.query.salesman_id;
  const key = (id) => (id === null || id === undefined ? 'owner' : String(id));

  // Every sale in range, with every line item on it (product, qty, cost vs
  // sale price) - one row per item, grouped back into sales in JS below.
  const saleItemRows = db.prepare(`
    SELECT sa.id as sale_id, sa.invoice_number, sa.sale_date, sa.total_amount, sa.profit as sale_profit,
           sa.received_amount, sa.remaining_amount, sa.salesman_id, sm.name as salesman_name, sm.role as salesman_role,
           c.shop_name,
           si.id as item_id, si.unit_type, si.quantity, si.selling_price, si.total as item_total, si.profit as item_profit,
           p.name as product_name
    FROM sales sa
    LEFT JOIN customers c ON sa.customer_id = c.id
    LEFT JOIN salesmen sm ON sa.salesman_id = sm.id
    LEFT JOIN sale_items si ON si.sale_id = sa.id
    LEFT JOIN products p ON si.product_id = p.id
    WHERE sa.sale_date BETWEEN ? AND ?
    ORDER BY sa.sale_date ASC, sa.id ASC, si.id ASC
  `).all(start, end);

  const groupMeta = {};
  const salesById = {};
  for (const r of saleItemRows) {
    const k = key(r.salesman_id);
    groupMeta[k] = { salesman_id: r.salesman_id, name: r.salesman_id ? r.salesman_name : 'Owner', role: r.salesman_id ? (r.salesman_role || 'salesman') : 'owner' };
    if (!salesById[r.sale_id]) {
      salesById[r.sale_id] = {
        id: r.sale_id, invoice_number: r.invoice_number, sale_date: r.sale_date,
        shop_name: r.shop_name || '(deleted customer)',
        total_amount: round2(r.total_amount || 0),
        profit: round2(r.sale_profit || 0),
        cost: round2((r.total_amount || 0) - (r.sale_profit || 0)),
        received_amount: round2(r.received_amount || 0),
        remaining_amount: round2(r.remaining_amount || 0),
        key: k, items: [],
      };
    }
    if (r.item_id) {
      salesById[r.sale_id].items.push({
        product_name: r.product_name || '(deleted product)',
        unit_type: r.unit_type,
        quantity: r.quantity,
        total: round2(r.item_total || 0),
        cost: round2((r.item_total || 0) - (r.item_profit || 0)),
        profit: round2(r.item_profit || 0),
      });
    }
  }
  const salesByGroup = {};
  for (const s of Object.values(salesById)) (salesByGroup[s.key] ||= []).push(s);

  // Expenses explicitly tagged to a salesman (his commission, advance,
  // fuel/phone bill etc.) - a plain untagged business expense never shows
  // up here, only ones someone deliberately put his name on.
  const expenseRows = db.prepare(`
    SELECT e.date, e.category, e.description, e.amount, e.payment_method, e.paid_to, e.salesman_id
    FROM expenses e
    WHERE e.salesman_id IS NOT NULL AND e.date BETWEEN ? AND ?
    ORDER BY e.date ASC, e.id ASC
  `).all(start, end);
  const expensesByGroup = {};
  for (const r of expenseRows) (expensesByGroup[key(r.salesman_id)] ||= []).push(r);

  // Customer returns that can be traced back to one of this salesman's
  // sales through the original invoice line they were picked from.
  const returnRows = db.prepare(`
    SELECT cr.return_date, c.shop_name, p.name as product_name, cri.unit_type, cri.quantity, cri.total, cri.profit_impact,
           sa.invoice_number, sa.salesman_id
    FROM customer_return_items cri
    JOIN customer_returns cr ON cri.return_id = cr.id
    JOIN sale_items si2 ON cri.source_sale_item_id = si2.id
    JOIN sales sa ON si2.sale_id = sa.id
    LEFT JOIN customers c ON cr.customer_id = c.id
    LEFT JOIN products p ON cri.product_id = p.id
    WHERE cr.return_date BETWEEN ? AND ?
    ORDER BY cr.return_date ASC
  `).all(start, end);
  const returnsByGroup = {};
  for (const r of returnRows) (returnsByGroup[key(r.salesman_id)] ||= []).push(r);

  // Every currently active salesman appears even with zero activity this
  // period (so an idle salesman doesn't just silently vanish from the
  // report), plus Owner always appears.
  const allSalesmen = db.prepare(`SELECT id, name, role FROM salesmen WHERE archived = 0 OR archived IS NULL ORDER BY name ASC`).all();
  for (const sm of allSalesmen) groupMeta[key(sm.id)] = groupMeta[key(sm.id)] || { salesman_id: sm.id, name: sm.name, role: sm.role || 'salesman' };
  groupMeta.owner = groupMeta.owner || { salesman_id: null, name: 'Owner', role: 'owner' };

  // Owner -> Manager -> Salesman, matching the hierarchy set up on the
  // Salesmen page; biggest total_amount first within each tier.
  const tierOrder = { owner: 0, manager: 1, salesman: 2 };
  const groups = Object.keys(groupMeta).map(k => {
    const sales = salesByGroup[k] || [];
    const expenses = expensesByGroup[k] || [];
    const returns = returnsByGroup[k] || [];
    const total_amount = round2(sales.reduce((s, x) => s + x.total_amount, 0));
    const cost = round2(sales.reduce((s, x) => s + x.cost, 0));
    const profit = round2(sales.reduce((s, x) => s + x.profit, 0));
    const received_amount = round2(sales.reduce((s, x) => s + x.received_amount, 0));
    const remaining_amount = round2(sales.reduce((s, x) => s + x.remaining_amount, 0));
    const expenses_amount = round2(expenses.reduce((s, x) => s + (x.amount || 0), 0));
    const returns_amount = round2(returns.reduce((s, x) => s + (x.total || 0), 0));
    const returns_profit_impact = round2(returns.reduce((s, x) => s + (x.profit_impact || 0), 0));
    const net_profit = round2(profit - returns_profit_impact - expenses_amount);
    return {
      key: k, salesman_id: groupMeta[k].salesman_id, name: groupMeta[k].name, role: groupMeta[k].role,
      count: sales.length, total_amount, cost, profit, received_amount, remaining_amount,
      expenses_amount, returns_count: returns.length, returns_amount, returns_profit_impact, net_profit,
      sales, expenses, returns,
    };
  }).sort((a, b) => (tierOrder[a.role] ?? 3) - (tierOrder[b.role] ?? 3) || b.total_amount - a.total_amount);

  const filterKey = filter === 'owner' ? 'owner' : (filter ? String(filter) : null);
  const visibleGroups = filterKey ? groups.filter(g => g.key === filterKey) : groups;

  const totals = groups.reduce((t, g) => ({
    count: t.count + g.count,
    total_amount: t.total_amount + g.total_amount,
    cost: t.cost + g.cost,
    profit: t.profit + g.profit,
    received_amount: t.received_amount + g.received_amount,
    remaining_amount: t.remaining_amount + g.remaining_amount,
    expenses_amount: t.expenses_amount + g.expenses_amount,
    returns_amount: t.returns_amount + g.returns_amount,
    returns_profit_impact: t.returns_profit_impact + g.returns_profit_impact,
    net_profit: t.net_profit + g.net_profit,
  }), { count: 0, total_amount: 0, cost: 0, profit: 0, received_amount: 0, remaining_amount: 0, expenses_amount: 0, returns_amount: 0, returns_profit_impact: 0, net_profit: 0 });
  for (const k of Object.keys(totals)) { if (k !== 'count') totals[k] = round2(totals[k]); }

  res.json({
    start, end,
    salesmen: allSalesmen,
    // Lightweight, always-everyone summary for the top table.
    summary: groups.map(({ sales, expenses, returns, ...rest }) => rest),
    // Full per-salesman detail, limited to whichever group(s) were asked for.
    groups: visibleGroups,
    totals,
  });
});

// ---- Customer Monthly Statement: one customer, one month - every invoice
// (with items if ?detailed=1), every payment received, the balance carried
// IN from before the month (opening), and the balance carried OUT at the
// month's end (closing). Uses the exact same running-balance formula as the
// Customer Ledger page (debit adds: sale/debit; credit subtracts: any
// payment, including 'Return') so the numbers here always agree with the
// ledger page for the same customer. ----
router.get('/customer-monthly', (req, res) => {
  const customerId = Number(req.query.customer_id);
  const month = req.query.month; // "YYYY-MM"
  const detailed = req.query.detailed === '1';
  if (!customerId || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'customer_id aur month (YYYY-MM) dono zaroori hain.' });
  }

  const customer = db.prepare('SELECT id, shop_name, opening_balance, created_at FROM customers WHERE id=?').get(customerId);
  if (!customer) return res.status(404).json({ error: 'Customer nahi mila.' });

  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  // Every ledger entry ever, for this one customer, in true chronological
  // order - same construction as /ledger/customer/:id.
  const sales = db.prepare('SELECT id, invoice_number, sale_date as date, total_amount, received_amount, remaining_amount, created_at FROM sales WHERE customer_id=?').all(customerId)
    .map(s => ({ type: 'sale', ...s }));
  const debits = db.prepare('SELECT id, date, amount as total_amount, notes, created_at FROM customer_debits WHERE customer_id=?').all(customerId)
    .map(d => ({ type: 'debit', ...d }));
  const payments = db.prepare('SELECT id, receipt_no, date, amount, method, notes, created_at FROM customer_payments WHERE customer_id=?').all(customerId)
    .map(p => ({ type: 'payment', ...p }));
  const combined = [...sales, ...debits, ...payments].sort((a, b) => {
    const dateDiff = new Date(a.date) - new Date(b.date);
    if (dateDiff !== 0) return dateDiff;
    const createdDiff = new Date(a.created_at) - new Date(b.created_at);
    if (createdDiff !== 0) return createdDiff;
    return a.id - b.id;
  });
  if (customer.opening_balance) {
    combined.unshift({ type: 'opening', date: (customer.created_at || '').slice(0, 10), total_amount: customer.opening_balance, created_at: customer.created_at, id: 0 });
  }

  // Walk every entry in order, running the balance forward. Whatever the
  // balance is right before the first entry ON/AFTER the month's start is
  // this month's opening balance; whatever it is after the LAST entry on or
  // before the month's end is this month's closing balance.
  let balance = 0;
  let openingBalance = 0;
  let openingSet = false;
  const monthEntries = [];
  for (const e of combined) {
    if (!openingSet && e.date >= start) { openingBalance = balance; openingSet = true; }
    const isDebit = e.type === 'sale' || e.type === 'opening' || e.type === 'debit';
    balance += isDebit ? (e.total_amount || 0) : -(e.amount || 0);
    if (e.date >= start && e.date <= end) monthEntries.push({ ...e, running_balance: round2(balance) });
  }
  if (!openingSet) openingBalance = balance; // no entries at/after month start -> whole history is "before"
  const closingBalance = round2(balance);

  // Sale items, only for invoices that fall inside this month, only when detailed.
  if (detailed) {
    const saleIds = monthEntries.filter(e => e.type === 'sale').map(e => e.id);
    if (saleIds.length) {
      const placeholders = saleIds.map(() => '?').join(',');
      const itemRows = db.prepare(`
        SELECT si.sale_id, p.name as product_name, si.unit_type, si.quantity, si.selling_price, si.discount, si.total, si.profit
        FROM sale_items si LEFT JOIN products p ON si.product_id = p.id
        WHERE si.sale_id IN (${placeholders}) ORDER BY si.id ASC
      `).all(...saleIds);
      const bySale = {};
      for (const it of itemRows) {
        (bySale[it.sale_id] ||= []).push({
          product_name: it.product_name || '(deleted product)', unit_type: it.unit_type || '',
          quantity: it.quantity, selling_price: round2(it.selling_price || 0), discount: round2(it.discount || 0),
          total: round2(it.total || 0), profit: round2(it.profit || 0),
        });
      }
      monthEntries.forEach(e => { if (e.type === 'sale') e.items = bySale[e.id] || []; });
    }
  }

  const purchasedTotal = round2(monthEntries.filter(e => e.type === 'sale' || e.type === 'debit').reduce((s, e) => s + (e.total_amount || 0), 0));
  const paidTotal = round2(monthEntries.filter(e => e.type === 'payment').reduce((s, e) => s + (e.amount || 0), 0));

  res.json({
    customer: { id: customer.id, shop_name: customer.shop_name },
    month, start, end,
    opening_balance: round2(openingBalance),
    entries: monthEntries,
    closing_balance: closingBalance,
    totals: { purchased: purchasedTotal, paid: paidTotal, remaining: closingBalance },
  });
});

// ---- Stock report: what's available RIGHT NOW (no date range - a
// point-in-time snapshot), valued batch-by-batch at each batch's own price. ----
router.get('/stock', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.stock_pieces, p.pieces_per_carton, s.company_name
    FROM products p LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE (p.archived = 0 OR p.archived IS NULL) AND p.stock_pieces > 0
    ORDER BY p.name ASC
  `).all();

  const valueStmt = db.prepare(`SELECT COALESCE(SUM(remaining_pieces * price_per_piece),0) t FROM stock_batches WHERE product_id=? AND remaining_pieces>0`);
  const withValue = rows.map(p => {
    const split = splitPieces(p.stock_pieces, p.pieces_per_carton || 1);
    const value = valueStmt.get(p.id).t;
    return {
      id: p.id,
      name: p.name,
      company_name: p.company_name,
      stock_pieces: p.stock_pieces,
      cartons: split.cartons,
      pcs: split.pcs,
      pieces_per_carton: p.pieces_per_carton,
      stock_value: round2(value),
    };
  });

  const totalValue = round2(withValue.reduce((sum, p) => sum + p.stock_value, 0));
  res.json({ rows: withValue, totals: { count: withValue.length, total_value: totalValue } });
});

// ---- Customer Remaining (Baaki) report: every customer A to Z with their
// current outstanding balance and the last date they actually paid cash
// (excludes goods-return credits, same rule as the Customers page) - plus
// a grand total across everyone, for a quick full follow-up list. ----
router.get('/customer-remaining', (req, res) => {
  const rows = db.prepare('SELECT * FROM customers WHERE archived = 0 OR archived IS NULL ORDER BY shop_name COLLATE NOCASE ASC').all();
  const getRemaining = db.prepare('SELECT COALESCE(SUM(remaining_amount),0) t FROM sales WHERE customer_id=?');
  const getDebits = db.prepare('SELECT COALESCE(SUM(remaining_amount),0) t FROM customer_debits WHERE customer_id=?');
  const getLastPayment = db.prepare(`SELECT MAX(date) d FROM customer_payments WHERE customer_id=? AND (method IS NULL OR method != 'Return')`);

  const withBalance = rows.map(c => {
    const remaining = getRemaining.get(c.id).t;
    const debits = getDebits.get(c.id).t;
    const outstanding = round2(c.opening_balance + remaining + debits);
    const last_payment_date = getLastPayment.get(c.id).d || null;
    return {
      id: c.id,
      shop_name: c.shop_name,
      owner_name: c.owner_name,
      phone: c.phone,
      last_payment_date,
      outstanding,
    };
  });

  const totalRemaining = round2(withBalance.reduce((sum, c) => sum + c.outstanding, 0));
  res.json({ rows: withBalance, totals: { count: withBalance.length, total_remaining: totalRemaining } });
});

// Who actually collected the cash, not just whose name is on the sale - a
// customer's payment can pay off invoices from more than one salesman, so
// this is deliberately a separate question from the "received_amount" the
// main /salesman report shows. NULL salesman_id = an Owner/Manager
// collected it directly at the counter.
router.get('/salesman-recovery', (req, res) => {
  const { start, end } = normalizeRange(req.query.start, req.query.end);
  const rows = db.prepare(`
    SELECT cp.salesman_id, sm.name as salesman_name, sm.role,
           COALESCE(SUM(cp.amount), 0) as recovered, COUNT(*) as payment_count
    FROM customer_payments cp
    LEFT JOIN salesmen sm ON sm.id = cp.salesman_id
    WHERE cp.date BETWEEN ? AND ? AND (cp.method IS NULL OR cp.method != 'Return')
    GROUP BY cp.salesman_id
    ORDER BY recovered DESC
  `).all(start, end);
  res.json({
    start, end,
    rows: rows.map(r => ({
      salesman_id: r.salesman_id,
      name: r.salesman_id ? r.salesman_name : 'Owner/Manager (Counter pe)',
      role: r.salesman_id ? r.role : null,
      recovered: round2(r.recovered),
      payment_count: r.payment_count,
    })),
  });
});

module.exports = router;
