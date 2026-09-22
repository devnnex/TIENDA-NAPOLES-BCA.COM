const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const sheets = new Map();
const reads = new Map();
const revisions = { TN_HISTORY_REVISION: "revision-1", TN_MOVEMENT_REVISION: "movement-1" };
const sheet = (name, rows) => {
  sheets.set(name, {
    getLastRow: () => rows.length + 1,
    getRange: (first, _column, count) => {
      reads.set(name, [...(reads.get(name) || []), { first, count }]);
      return { getValues: () => rows.slice(first - 2, first - 2 + count) };
    }
  });
};

const context = vm.createContext({
  SpreadsheetApp: { openById: () => ({ getSheetByName: (name) => sheets.get(name) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => revisions[key] || "", setProperty: (key, value) => { revisions[key] = value; } }) },
  Utilities: { formatDate: (date, zone) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  } }
});
vm.runInContext(fs.readFileSync("appscript/Code.gs", "utf8"), context);
context.getTimezone_ = () => "America/Bogota";

const movements = Array.from({ length: 1605 }, (_, index) => [
  `m${index}`, "product", "P", "Producto", "ENTRADA", 1, index, index + 1, 1, "", "",
  new Date(Date.UTC(2026, 8, 1, 0, 0, index)), "Admin"
]);
sheet(context.APP.sheets.movements, movements);
const firstMovements = context.getInventoryMovements_(800);
assert.equal(firstMovements.movements.length, 800);
assert.equal(firstMovements.movements[0].movementId, "m1604");
const secondMovements = context.getInventoryMovements_(800, firstMovements.nextCursor, firstMovements.revision);
const thirdMovements = context.getInventoryMovements_(800, secondMovements.nextCursor, firstMovements.revision);
assert.deepEqual([secondMovements.movements.length, thirdMovements.movements.length], [800, 5]);
assert.equal(thirdMovements.hasMore, false);
assert.equal(new Set([...firstMovements.movements, ...secondMovements.movements, ...thirdMovements.movements].map((item) => item.movementId)).size, 1605);
assert.ok((reads.get(context.APP.sheets.movements) || []).every((read) => read.count <= 800));
revisions.TN_MOVEMENT_REVISION = "movement-2";
assert.equal(context.getInventoryMovements_(800, firstMovements.nextCursor, firstMovements.revision).stale, true);

const sales = Array.from({ length: 605 }, (_, index) => [
  `s${index}`, `F${index}`, "", "", "Mesa 1", "2026-09-22T02:00:00Z", "Admin", "Mesero",
  10, 0, 0, 0, 10, index % 2 ? "transfer" : "cash", "", "", ""
]);
const details = sales.map((row) => [row[0], row[1], `l${row[0]}`, "product", "Cerveza", 1, 10, 10, 4, 4, 6]);
const payments = sales.map((row) => [row[0], row[1], row[13], 10, "", row[5]]);
sheet(context.APP.sheets.sales, sales);
sheet(context.APP.sheets.details, details);
sheet(context.APP.sheets.payments, payments);

const filters = { dateFrom: "2026-09-21", dateTo: "2026-09-21", paymentMethod: "all", query: "", limit: 300 };
const first = context.getIncomeReport_(filters);
assert.equal(first.totalRecords, 605);
assert.equal(first.totals.income, 6050);
assert.equal(first.totals.profit, 3630);
assert.equal(first.records.length, 300);
assert.equal(first.recordRows.length, 605);
assert.equal(context.getIncomeReport_({ ...filters, dateFrom: "2026-09-22", dateTo: "2026-09-22" }).totalRecords, 0);
assert.equal(context.getIncomeReport_({ ...filters, paymentMethod: "cash", query: "cerveza" }).totalRecords, 303);

const remaining = [];
const previousReads = (reads.get(context.APP.sheets.sales) || []).length;
for (let start = 300; start < first.recordRows.length; start += 300) {
  const page = context.getIncomeReport_({ ...filters, pageRows: first.recordRows.slice(start, start + 300), revision: first.revision });
  assert.equal(page.stale, undefined);
  remaining.push(...page.records);
}
assert.equal(remaining.length, 305);
assert.equal(new Set([...first.records, ...remaining].map((record) => record.saleId)).size, 605);
assert.ok((reads.get(context.APP.sheets.sales) || []).slice(previousReads).every((read) => read.count < 605));

sales.shift();
sheet(context.APP.sheets.sales, sales);
assert.equal(context.getIncomeReport_({ ...filters, pageRows: first.recordRows.slice(300, 600), revision: "older-revision" }).stale, true);
assert.equal(context.getIncomeReport_({ ...filters, pageRows: first.recordRows.slice(300, 600), revision: first.revision }).stale, true);

const frontend = fs.readFileSync("app.js", "utf8");
const rangeSource = frontend.slice(frontend.indexOf("  const businessDateKey ="), frontend.indexOf("  const markIncomeRangePreset ="));
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ["2026-09-22T02:00:00Z"])); }
}
const rangeContext = vm.createContext({ Date: FixedDate, Intl, state: { businessTimeZone: "America/Bogota" } });
vm.runInContext(`${rangeSource}\nthis.incomeRangeDates = incomeRangeDates;`, rangeContext);
assert.equal(rangeContext.incomeRangeDates("today").dateFrom, "2026-09-21");
assert.equal(rangeContext.incomeRangeDates("yesterday").dateFrom, "2026-09-20");
assert.equal(rangeContext.incomeRangeDates("month").dateFrom, "2026-09-01");
assert.equal(rangeContext.incomeRangeDates("7days").dateFrom, "2026-09-15");

const saveTableSource = frontend.slice(frontend.indexOf("  const saveTable = async"), frontend.indexOf("  const saveCategory ="));
const outdoorSource = frontend.slice(frontend.indexOf("  const OUTDOOR_TABLE_PREFIX ="), frontend.indexOf("  const servicePointKind ="));
const existingQrImage = "https://example.com/mesa-1.png";
const tableState = { tables: [{ id: "t1", table_number: 1, is_active: true, qr_image_url: `tn-outdoor:v1:${encodeURIComponent(existingQrImage)}` }] };
let persistedQrImage = null;
tableState.sb = { from: () => ({ update: (payload) => {
  persistedQrImage = payload.qr_image_url;
  return { eq: () => ({ select: () => ({ single: async () => ({ ...tableState.tables[0], ...payload }) }) }) };
} }) };
const tableContext = vm.createContext({
  state: tableState, uid: () => "new-table", retryQuiet: async (request) => request(),
  persistBootstrapCache: () => {}, renderTableManager: () => {}, renderTables: () => {},
  renderTableFormQr: () => {}, toast: () => {}
});
vm.runInContext(`${outdoorSource}\n${saveTableSource}\nthis.saveTable = saveTable; this.isOutdoorTable = isOutdoorTable;`, tableContext);
const form = {
  table_id: { value: "t1" }, table_number: { value: "1" }, table_name: { value: "Terraza" },
  is_active: { checked: true }, is_outdoor: { checked: false },
  reset() { this.table_id.value = ""; }
};
(async () => {
  await tableContext.saveTable(form);
  await new Promise(setImmediate);
  assert.equal(persistedQrImage, existingQrImage);
  assert.equal(tableContext.isOutdoorTable(tableState.tables[0]), false);
  form.table_id.value = "t1";
  form.is_outdoor.checked = true;
  await tableContext.saveTable(form);
  await new Promise(setImmediate);
  assert.equal(persistedQrImage, `tn-outdoor:v1:${encodeURIComponent(existingQrImage)}`);
  assert.equal(tableContext.isOutdoorTable(tableState.tables[0]), true);
  assert.equal(tableContext.isOutdoorTable(JSON.parse(JSON.stringify(tableState.tables[0]))), true);
  console.log("history pagination, filters, totals, timezone, stale-page, and outdoor-table save checks OK");
})().catch((error) => { console.error(error); process.exitCode = 1; });
