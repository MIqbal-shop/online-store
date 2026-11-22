/* Report exports for the Salesman/Manager mobile app.
 * The PDF and PNG builders below are copied from the DMS Reports page
 * (frontend/src/pages/Reports.jsx) so the files look exactly the same:
 * same red letterhead, same table headers and columns, same footer.
 * Needs jspdf, jspdf-autotable and html2canvas (public/vendor/). */
(function () {
const REPORT_TYPES = [
  { value: 'sales', label: 'Sales' }, { value: 'purchases', label: 'Purchases' }, { value: 'expenses', label: 'Expenses' },
  { value: 'house_expenses', label: '🏠 House Expense (A-Z)' }, { value: 'profit', label: 'Profit' },
  { value: 'salesman', label: 'Salesman Performance' }, { value: 'customer_monthly', label: 'Customer Monthly Statement' },
  { value: 'customer_remaining', label: 'Customer Remaining (Baaki)' }, { value: 'stock', label: 'Available Stock' },
  { value: 'my_sales', label: 'Meri Sales' }, { value: 'my_expenses', label: 'Mere Expenses' }, { value: 'salesman_recovery', label: 'Salesman Recovery' },
];
const jsPDF = function (...a) { return new window.jspdf.jsPDF(...a); };
const autoTable = (doc, opts) => doc.autoTable(opts);
const html2canvas = (...a) => window.html2canvas(...a);
function buildExportModel(reportType, data, meta) {
  const title = REPORT_TYPES.find(t => t.value === reportType)?.label + ' Report';
  const subtitle = [`Period: ${meta.periodLabel}`];
  if (meta.filterLabel) subtitle.push(meta.filterLabel);

  if (reportType === 'sales') {
    return {
      title, subtitle,
      headers: ['Invoice', 'Date', 'Customer', 'Total', 'Profit', 'Received', 'Remaining'],
      rows: data.rows.map(r => [r.invoice_number, r.sale_date, r.shop_name, r.total_amount, r.profit, r.received_amount, r.remaining_amount]),
      totalsRow: ['TOTAL', '', '', data.totals.total_amount, data.totals.profit, data.totals.received_amount, data.totals.remaining_amount],
      moneyCols: [3, 4, 5, 6],
    };
  }
  if (reportType === 'purchases') {
    return {
      title, subtitle,
      headers: ['Invoice', 'Date', 'Company', 'Total', 'Paid', 'Remaining'],
      rows: data.rows.map(r => [r.invoice_number, r.purchase_date, r.company_name, r.total_amount, r.paid_amount, r.remaining_balance]),
      totalsRow: ['TOTAL', '', '', data.totals.total_amount, data.totals.paid_amount, data.totals.remaining_balance],
      moneyCols: [3, 4, 5],
    };
  }
  if (reportType === 'expenses') {
    return {
      title, subtitle,
      headers: ['Date', 'Category', 'Description', 'Amount', 'Paid To'],
      rows: data.rows.map(r => [r.date, r.category, r.description, r.amount, r.paid_to]),
      totalsRow: ['TOTAL', '', '', data.totals.total_amount, ''],
      moneyCols: [3],
    };
  }
  if (reportType === 'house_expenses') {
    return {
      title, subtitle,
      headers: ['Date', 'Category', 'Description', 'Amount', 'Method', 'Paid To', 'Notes'],
      rows: data.rows.map(r => [r.date, r.category, r.description, r.amount, r.payment_method, r.paid_to, r.notes]),
      totalsRow: ['TOTAL', '', '', data.totals.total_amount, '', '', ''],
      moneyCols: [3],
    };
  }
  if (reportType === 'profit') {
    return {
      title, subtitle,
      headers: ['Metric', 'Amount'],
      rows: [
        ['Revenue', data.revenue],
        ['Sales Profit', data.salesProfit],
        ['Customer Return Impact', data.returnedProfitImpact],
        ['Net Sales Profit', data.netSalesProfit],
        ['Expenses', data.expenses],
        ['Net Profit', data.netProfit],
      ],
      totalsRow: null,
      moneyCols: [1],
    };
  }
  if (reportType === 'salesman') {
    return {
      title, subtitle,
      headers: ['Salesman', 'Invoices', 'Total Sales', 'Cost', 'Profit', 'Expenses', 'Returns Impact', 'Net Profit', 'Received', 'Remaining'],
      rows: data.summary.map(g => [g.name, g.count, g.total_amount, g.cost, g.profit, g.expenses_amount, g.returns_profit_impact, g.net_profit, g.received_amount, g.remaining_amount]),
      totalsRow: ['TOTAL', data.totals.count, data.totals.total_amount, data.totals.cost, data.totals.profit, data.totals.expenses_amount, data.totals.returns_profit_impact, data.totals.net_profit, data.totals.received_amount, data.totals.remaining_amount],
      moneyCols: [2, 3, 4, 5, 6, 7, 8, 9],
    };
  }
  if (reportType === 'customer_remaining') {
    return {
      title, subtitle,
      headers: ['Customer', 'Last Payment', 'Remaining'],
      rows: data.rows.map(r => [r.shop_name, r.last_payment_date || 'Kabhi nahi', r.outstanding]),
      totalsRow: ['TOTAL', '', data.totals.total_remaining],
      moneyCols: [2],
    };
  }
  // stock
  return {
    title, subtitle,
    headers: ['Product', 'Company', 'Cartons', 'Pcs', 'Total Pieces', 'Stock Value'],
    rows: data.rows.map(r => [r.name, r.company_name, r.cartons, r.pcs, r.stock_pieces, r.stock_value]),
    totalsRow: ['TOTAL VALUE', '', '', '', '', data.totals.total_value],
    moneyCols: [5],
  };
}

function buildPdfBlob(model) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Red title bar (matches the invoice letterhead), navy table header below
  doc.setFillColor(211, 30, 40);
  doc.rect(0, 0, pageWidth, 20, 'F');
  if (model.logoImage) {
    try {
      const fmt = /image\/png/i.test(model.logoImage) ? 'PNG' : (/image\/webp/i.test(model.logoImage) ? 'WEBP' : 'JPEG');
      doc.addImage(model.logoImage, fmt, pageWidth - 26, 3, 14, 14, undefined, 'FAST');
    } catch (e) { /* ignore bad image data */ }
  }
  doc.setTextColor(255, 255, 255);
  if (model.businessName) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text(model.businessName.toUpperCase(), 14, 8);
    doc.setFontSize(13);
  } else {
    doc.setFontSize(15);
  }
  doc.setFont(undefined, 'bold');
  doc.text(model.title, 14, model.businessName ? 16 : 13);
  doc.setFont(undefined, 'normal');

  doc.setTextColor(90, 90, 90);
  doc.setFontSize(9);
  let y = 27;
  model.subtitle.forEach(s => { doc.text(s, 14, y); y += 5; });

  const fmt = (v, idx) => (model.moneyCols.includes(idx) && v !== '' && v !== null && !isNaN(Number(v)))
    ? Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : (v ?? '');

  autoTable(doc, {
    startY: y + 3,
    head: [model.headers],
    body: model.rows.map(r => r.map((c, i) => fmt(c, i))),
    foot: model.totalsRow ? [model.totalsRow.map((c, i) => fmt(c, i))] : undefined,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3, lineColor: [226, 232, 240], lineWidth: 0.3 },
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [251, 226, 226], textColor: [30, 30, 30], fontStyle: 'bold', lineWidth: 0.3 },
    alternateRowStyles: { fillColor: [248, 249, 252] },
    columnStyles: model.moneyCols.reduce((acc, idx) => { acc[idx] = { halign: 'right' }; return acc; }, {}),
  });

  // Footer on every page: generated timestamp + page numbers
  const totalPages = doc.internal.getNumberOfPages();
  const generated = `Generated: ${new Date().toLocaleString()}`;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(generated, 14, pageHeight - 8);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 32, pageHeight - 8);
  }

  return doc.output('blob');
}

function profitSections(payload) {
  return [
    {
      key: 'summary',
      title: 'Summary',
      headers: ['Metric', 'Amount'],
      rows: [
        ['Revenue (total sales)', payload.revenue],
        ['Sales Profit', payload.salesProfit],
        ['Customer Return Impact', payload.returnedProfitImpact],
        ['Net Sales Profit', payload.netSalesProfit],
        ['Expenses', payload.expenses],
        ['Net Profit', payload.netProfit],
      ],
      moneyCols: [1],
    },
    {
      key: 'products',
      title: 'Profit by Product — kya bika, kitne ka aya, kitne ka becha',
      headers: ['Product', 'Company', 'Qty (pcs)', 'Cost', 'Revenue', 'Profit'],
      rows: payload.productBreakdown.map(r => [r.name, r.company_name, r.qty_pieces, r.cost, r.revenue, r.profit]),
      moneyCols: [3, 4, 5],
    },
    {
      key: 'customers',
      title: 'Profit by Customer — kis ko becha',
      headers: ['Customer', 'Invoices', 'Revenue', 'Profit'],
      rows: payload.customerBreakdown.map(r => [r.shop_name, r.invoices, r.revenue, r.profit]),
      moneyCols: [2, 3],
    },
    {
      key: 'expenses',
      title: 'Expenses — kya, kahan, kis ko diya',
      headers: ['Date', 'Category', 'Description', 'Paid To', 'Amount'],
      rows: payload.expenseRows.map(r => [r.date, r.category, r.description, r.paid_to, r.amount]),
      moneyCols: [4],
    },
    {
      key: 'customer_returns',
      title: 'Customer Returns — kab, kis se aya',
      headers: ['Date', 'Customer', 'Product', 'Unit', 'Qty', 'Amount', 'Profit Impact'],
      rows: payload.customerReturnRows.map(r => [r.return_date, r.shop_name, r.product_name, r.unit_type, r.quantity, r.total, r.profit_impact]),
      moneyCols: [5, 6],
    },
    {
      key: 'supplier_returns',
      title: 'Supplier Returns — kab, kis ko wapis kiya',
      headers: ['Date', 'Company', 'Product', 'Unit', 'Qty', 'Amount'],
      rows: payload.supplierReturnRows.map(r => [r.return_date, r.company_name, r.product_name, r.unit_type, r.quantity, r.total]),
      moneyCols: [5],
    },
  ].filter(s => s.rows.length || s.key === 'summary');
}

function buildProfitPdfBlob(payload, meta) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const sections = profitSections(payload, meta);

  doc.setFillColor(211, 30, 40);
  doc.rect(0, 0, pageWidth, 20, 'F');
  if (meta.logoImage) {
    try {
      const fmt = /image\/png/i.test(meta.logoImage) ? 'PNG' : (/image\/webp/i.test(meta.logoImage) ? 'WEBP' : 'JPEG');
      doc.addImage(meta.logoImage, fmt, pageWidth - 26, 3, 14, 14, undefined, 'FAST');
    } catch (e) { /* ignore bad image data */ }
  }
  doc.setTextColor(255, 255, 255);
  if (meta.businessName) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text(meta.businessName.toUpperCase(), 14, 8);
    doc.setFontSize(13);
  } else {
    doc.setFontSize(15);
  }
  doc.setFont(undefined, 'bold');
  doc.text('Detailed Profit Report', 14, meta.businessName ? 16 : 13);
  doc.setFont(undefined, 'normal');

  doc.setTextColor(90, 90, 90);
  doc.setFontSize(9);
  let y = 27;
  meta.subtitle.forEach(s => { doc.text(s, 14, y); y += 5; });
  y += 2;

  const fmt = (v, idx, moneyCols) => (moneyCols.includes(idx) && v !== '' && v !== null && !isNaN(Number(v)))
    ? Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : (v ?? '');

  sections.forEach(sec => {
    if (y > pageHeight - 40) { doc.addPage(); y = 16; }
    doc.setTextColor(211, 30, 40);
    doc.setFontSize(11.5);
    doc.setFont(undefined, 'bold');
    doc.text(sec.title, 14, y);
    doc.setFont(undefined, 'normal');
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [sec.headers],
      body: sec.rows.length ? sec.rows.map(r => r.map((c, i) => fmt(c, i, sec.moneyCols))) : [[{ content: 'Is period mein koi data nahi.', colSpan: sec.headers.length, styles: { halign: 'center', textColor: [150, 150, 150] } }]],
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 2.5, lineColor: [226, 232, 240], lineWidth: 0.3 },
      headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold', halign: 'center' },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      columnStyles: sec.moneyCols.reduce((acc, idx) => { acc[idx] = { halign: 'right' }; return acc; }, {}),
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 10;
  });

  const totalPages = doc.internal.getNumberOfPages();
  const generated = `Generated: ${new Date().toLocaleString()}`;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(generated, 14, pageHeight - 8);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 32, pageHeight - 8);
  }

  return doc.output('blob');
}

function salesmanSections(payload) {
  const sections = [
    {
      key: 'summary',
      title: 'Salesman Summary',
      headers: ['Salesman', 'Invoices', 'Total Sales', 'Cost', 'Profit', 'Expenses', 'Returns Impact', 'Net Profit', 'Received', 'Remaining'],
      rows: payload.summary.map(g => [g.name, g.count, g.total_amount, g.cost, g.profit, g.expenses_amount, g.returns_profit_impact, g.net_profit, g.received_amount, g.remaining_amount]),
      moneyCols: [2, 3, 4, 5, 6, 7, 8, 9],
    },
  ];

  payload.groups.forEach(g => {
    const roleLabel = g.role === 'owner' ? 'Owner' : g.role === 'manager' ? 'Manager' : 'Salesman';

    sections.push({
      key: `${g.key}_overview`,
      title: `${g.name} (${roleLabel}) — Overview`,
      headers: ['Metric', 'Amount'],
      rows: [
        ['Total Sales', g.total_amount],
        ['Cost', g.cost],
        ['Gross Profit', g.profit],
        ['Expenses (uske naam)', g.expenses_amount],
        ['Returns Impact', g.returns_profit_impact],
        ['Net Profit', g.net_profit],
        ['Received', g.received_amount],
        ['Remaining', g.remaining_amount],
      ],
      moneyCols: [1],
    });

    const items = g.sales.flatMap(s => s.items.map(it => [
      s.invoice_number, s.sale_date, s.shop_name, it.product_name, it.unit_type, it.quantity, it.cost, it.total, it.profit,
    ]));
    sections.push({
      key: `${g.key}_sales`,
      title: `${g.name} — Kya kis ko becha (product wise)`,
      headers: ['Invoice', 'Date', 'Customer', 'Product', 'Unit', 'Qty', 'Cost', 'Sale', 'Profit'],
      rows: items,
      moneyCols: [6, 7, 8],
    });

    if (g.expenses.length) {
      sections.push({
        key: `${g.key}_expenses`,
        title: `${g.name} — Iske naam pe expenses`,
        headers: ['Date', 'Category', 'Description', 'Amount'],
        rows: g.expenses.map(e => [e.date, e.category, e.description, e.amount]),
        moneyCols: [3],
      });
    }

    if (g.returns.length) {
      sections.push({
        key: `${g.key}_returns`,
        title: `${g.name} — Iski sale se customer returns`,
        headers: ['Date', 'Invoice', 'Customer', 'Product', 'Unit', 'Qty', 'Amount', 'Profit Impact'],
        rows: g.returns.map(r => [r.return_date, r.invoice_number, r.shop_name, r.product_name, r.unit_type, r.quantity, r.total, r.profit_impact]),
        moneyCols: [6, 7],
      });
    }
  });

  return sections;
}

function buildSalesmanPdfBlob(payload, meta) {
  return buildSectionedPdfBlob(salesmanSections(payload), meta, 'Detailed Salesman Report');
}

function buildSectionedPdfBlob(sections, meta, docTitle) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFillColor(211, 30, 40);
  doc.rect(0, 0, pageWidth, 20, 'F');
  if (meta.logoImage) {
    try {
      const fmt = /image\/png/i.test(meta.logoImage) ? 'PNG' : (/image\/webp/i.test(meta.logoImage) ? 'WEBP' : 'JPEG');
      doc.addImage(meta.logoImage, fmt, pageWidth - 26, 3, 14, 14, undefined, 'FAST');
    } catch (e) { /* ignore bad image data */ }
  }
  doc.setTextColor(255, 255, 255);
  if (meta.businessName) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text(meta.businessName.toUpperCase(), 14, 8);
    doc.setFontSize(13);
  } else {
    doc.setFontSize(15);
  }
  doc.setFont(undefined, 'bold');
  doc.text(docTitle, 14, meta.businessName ? 16 : 13);
  doc.setFont(undefined, 'normal');

  doc.setTextColor(90, 90, 90);
  doc.setFontSize(9);
  let y = 27;
  meta.subtitle.forEach(s => { doc.text(s, 14, y); y += 5; });
  y += 2;

  const fmt = (v, idx, moneyCols) => (moneyCols.includes(idx) && v !== '' && v !== null && !isNaN(Number(v)))
    ? Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : (v ?? '');

  sections.forEach(sec => {
    if (y > pageHeight - 40) { doc.addPage(); y = 16; }
    doc.setTextColor(211, 30, 40);
    doc.setFontSize(11.5);
    doc.setFont(undefined, 'bold');
    doc.text(sec.title, 14, y);
    doc.setFont(undefined, 'normal');
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [sec.headers],
      body: sec.rows.length ? sec.rows.map(r => r.map((c, i) => fmt(c, i, sec.moneyCols))) : [[{ content: 'Koi data nahi.', colSpan: sec.headers.length, styles: { halign: 'center', textColor: [150, 150, 150] } }]],
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 2.5, lineColor: [226, 232, 240], lineWidth: 0.3 },
      headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold', halign: 'center' },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      columnStyles: sec.moneyCols.reduce((acc, idx) => { acc[idx] = { halign: 'right' }; return acc; }, {}),
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 10;
  });

  const totalPages = doc.internal.getNumberOfPages();
  const generated = `Generated: ${new Date().toLocaleString()}`;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(generated, 14, pageHeight - 8);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 32, pageHeight - 8);
  }

  return doc.output('blob');
}

function customerEntryLabel(e) {
  if (e.type === 'sale') return `Sale Invoice #${e.invoice_number || e.id}`;
  if (e.type === 'debit') return e.notes || 'Previous Balance';
  if (e.type === 'opening') return 'Previous Balance (Opening)';
  return e.method === 'Return' ? `Return Credit #${e.receipt_no || e.id}` : `Payment Receipt #${e.receipt_no || e.id}`;
}

function customerMonthlySections(payload) {
  const sections = [{
    key: 'ledger',
    title: `${payload.customer.shop_name} — ${payload.month}`,
    headers: ['Date', 'Type / Invoice', 'Debit (Purchase)', 'Credit (Paid)', 'Balance'],
    rows: payload.entries.map(e => [
      e.date, customerEntryLabel(e),
      (e.type === 'sale' || e.type === 'debit' || e.type === 'opening') ? e.total_amount : '',
      e.type === 'payment' ? e.amount : '',
      e.running_balance,
    ]),
    moneyCols: [2, 3, 4],
  }];

  payload.entries.forEach(e => {
    if (e.type === 'sale' && e.items && e.items.length) {
      sections.push({
        key: `inv_${e.id}`,
        title: `Invoice ${e.invoice_number || e.id} — ${e.date}`,
        headers: ['Product', 'Unit', 'Qty', 'Price', 'Discount', 'Total', 'Profit'],
        rows: e.items.map(it => [it.product_name, it.unit_type, it.quantity, it.selling_price, it.discount, it.total, it.profit]),
        moneyCols: [3, 4, 5, 6],
      });
    }
  });

  sections.push({
    key: 'closing',
    title: 'Opening & Closing Balance',
    headers: ['Metric', 'Amount'],
    rows: [
      ['Opening Balance (mahine se pehle)', payload.opening_balance],
      ['Total Purchased (is mahine)', payload.totals.purchased],
      ['Total Paid (is mahine)', payload.totals.paid],
      ['Closing Balance (mahine ke akhir mein)', payload.closing_balance],
    ],
    moneyCols: [1],
    emphasize: true,
  });

  return sections;
}

async function buildPngBlob(node, meta) {
  const captured = await html2canvas(node, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    onclone: (clonedDoc) => { clonedDoc.documentElement.classList.remove('dark'); },
  });

  const pad = 24;
  const headerH = meta.businessName ? 96 : 78;
  const canvas = document.createElement('canvas');
  canvas.width = captured.width + pad * 2;
  canvas.height = captured.height + headerH + pad * 2;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#D31E28';
  ctx.fillRect(0, 0, canvas.width, headerH);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  if (meta.businessName) {
    ctx.font = 'bold 22px Arial, sans-serif';
    ctx.fillText(meta.businessName.toUpperCase(), pad, 34);
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.fillText(meta.title, pad, 70);
  } else {
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.fillText(meta.title, pad, 46);
  }
  ctx.font = '15px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(meta.subtitle.join('   \u00b7   '), pad, headerH - 12);

  ctx.drawImage(captured, pad, headerH + pad);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// Report types that only exist in the app (no DMS page for them) use the same single-table layout.
function appModel(type, data, meta) {
  const title = (REPORT_TYPES.find(t => t.value === type) || {}).label + ' Report';
  const subtitle = [`Period: ${meta.periodLabel}`]; if (meta.filterLabel) subtitle.push(meta.filterLabel);
  if (type === 'my_sales') {
    const r = data.rows || [], s = k => r.reduce((a, x) => a + Number(x[k] || 0), 0);
    return { title, subtitle, headers: ['Invoice', 'Date', 'Customer', 'Total', 'Profit', 'Received', 'Remaining'],
      rows: r.map(x => [x.invoice_number, x.sale_date, x.shop_name, x.total_amount, x.profit, x.received_amount, x.remaining_amount]),
      moneyCols: [3, 4, 5, 6], totalsRow: ['TOTAL', '', `${r.length} invoices`, s('total_amount'), s('profit'), s('received_amount'), s('remaining_amount')] };
  }
  if (type === 'my_expenses') {
    const r = data.rows || [];
    return { title, subtitle, headers: ['Date', 'Category', 'Description', 'Amount', 'Paid To'],
      rows: r.map(x => [x.date, x.category, x.description, x.amount, x.paid_to]), moneyCols: [3],
      totalsRow: ['TOTAL', '', '', r.reduce((a, x) => a + Number(x.amount || 0), 0), ''] };
  }
  const r = data.rows || [];
  return { title, subtitle, headers: ['Salesman', 'Role', 'Payments', 'Recovered'], rows: r.map(x => [x.name, x.role, x.payment_count, x.recovered]), moneyCols: [3],
    totalsRow: ['TOTAL', '', r.reduce((a, x) => a + Number(x.payment_count || 0), 0), r.reduce((a, x) => a + Number(x.recovered || 0), 0)] };
}

// type: DMS report type with underscores, e.g. 'sales', 'customer_monthly', 'my_sales'.
function buildPdf(type, payload, meta) {
  if (type === 'profit') return buildProfitPdfBlob(payload, meta);
  if (type === 'salesman') return buildSalesmanPdfBlob(payload, meta);
  if (type === 'customer_monthly') return buildSectionedPdfBlob(customerMonthlySections(payload), meta, 'Customer Monthly Statement');
  const model = (type === 'my_sales' || type === 'my_expenses' || type === 'salesman_recovery')
    ? appModel(type, payload, meta) : buildExportModel(type, payload, meta);
  return buildPdfBlob({ ...model, businessName: meta.businessName, logoImage: meta.logoImage });
}
function titleOf(type) { return (REPORT_TYPES.find(t => t.value === type) || {}).label + ' Report'; }
window.SMX = { buildPdf, buildPngBlob, titleOf };
})();
