const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `No se encontró ${start}`);
  return source.slice(from, to);
};

const inventoryState = {
  currentUser: { id: "boss" }, activeAdminSection: "inventory",
  items: [{ id: "p1", name: "Uno" }, { id: "p2", name: "Dos" }],
  inventoryMeta: { p1: { updatedAt: "old", stock: 3 }, p2: { updatedAt: "old", stock: 2 } }
};
let pendingInventory = new Set();
let inventoryRenders = 0;
const inventoryContext = vm.createContext({
  state: inventoryState,
  isAppsScriptConfigured: () => true,
  appsScriptRequest: async () => ({ ok: true, everInitialized: true, items: [{ productId: "p1" }] }),
  applyRemoteInventoryItems: () => undefined,
  pendingInventoryIds: () => pendingInventory,
  persistInventoryStore: () => undefined,
  renderInventory: () => { inventoryRenders += 1; },
  setInventorySyncStatus: () => undefined,
  persistBootstrapCache: () => undefined,
  enqueueAppsScriptJob: () => { throw new Error("No debe recrear una fila eliminada."); },
  inventoryPayload: () => ({}),
  Date
});
vm.runInContext(`${section("  let inventorySyncPromise =", "  const queueInventoryUpsert =")}
;globalThis.syncInventoryWithAppsScript = syncInventoryWithAppsScript;`, inventoryContext);

const movementState = {
  currentUser: { id: "boss" }, activeAdminSection: "movements",
  movementLoading: false, movementLoaded: true, movementHasMore: false,
  movementRequestId: 0, movementSearch: "", movementTypeFilter: "all",
  inventoryMovements: [
    { movementId: "m1", date: "2026-10-05T08:00:00Z" },
    { movementId: "m2", date: "2026-10-05T09:00:00Z" }
  ]
};
let movementJobs = [];
let movementReads = 0;
const movementContext = vm.createContext({
  state: movementState,
  isAppsScriptConfigured: () => true,
  appsScriptRequest: async () => {
    movementReads += 1;
    return {
      ok: true, movements: [{ movementId: "m1", date: "2026-10-05T08:00:00Z" }],
      revision: "same-revision", hasMore: false, nextCursor: null
    };
  },
  readAppsScriptOutbox: () => movementJobs,
  $: () => null,
  persistInventoryMovements: () => undefined,
  renderInventoryMovements: () => undefined,
  toast: () => undefined,
  window: { setTimeout: () => 1 },
  Date
});
vm.runInContext(`${section("  const loadInventoryMovements =", "  const resetInventoryForm =")}
;globalThis.loadInventoryMovements = loadInventoryMovements;`, movementContext);

const salesState = {
  incomeRequestId: 0, incomeSearchTimer: null, incomeLoading: false,
  incomeReport: { records: [{ saleId: "deleted-sale" }] }, activeAdminSection: "income"
};
let saleReads = 0;
let saleFails = false;
const saleMessages = [];
const saleContext = vm.createContext({
  state: salesState,
  $: () => ({}),
  clearTimeout: () => undefined,
  canAccessAdminSection: () => true,
  incomeFiltersFromForm: () => ({ dateFrom: "2026-10-05", dateTo: "2026-10-05" }),
  localIncomeReport: () => ({ records: [{ saleId: "deleted-sale" }] }),
  renderIncomeReport: () => undefined,
  setIncomeReportStatus: (message) => saleMessages.push(message),
  isAppsScriptConfigured: () => true,
  appsScriptRequest: async () => {
    saleReads += 1;
    if (saleFails) throw new Error("Sin conexión al respaldo");
    return { ok: true, records: [], recordRows: [], totals: { sales: 0 }, totalRecords: 0, revision: "same-revision" };
  },
  mergeIncomeReport: (remote) => remote,
  toast: (message) => saleMessages.push(message),
  Date,
  APPS_SCRIPT_TIMEOUT_MS: 45000
});
vm.runInContext(`${section("  const loadIncomeReport =", "  const refreshBackgroundReports =")}
;globalThis.loadIncomeReport = loadIncomeReport;`, saleContext);

(async () => {
  await inventoryContext.syncInventoryWithAppsScript();
  assert.ok(inventoryState.inventoryMeta.p2, "Las lecturas normales conservan su comportamiento.");
  await inventoryContext.syncInventoryWithAppsScript({ reconcileDeletions: true });
  assert.equal(inventoryState.inventoryMeta.p2, undefined, "El botón retira la fila ausente del Sheet.");
  assert.ok(inventoryRenders > 0);

  inventoryState.inventoryMeta.p2 = { updatedAt: "local", stock: 2 };
  pendingInventory = new Set(["p2"]);
  await inventoryContext.syncInventoryWithAppsScript({ reconcileDeletions: true });
  assert.ok(inventoryState.inventoryMeta.p2, "Una operación local pendiente permanece protegida.");

  assert.equal(await movementContext.loadInventoryMovements({ force: true }), true);
  assert.deepEqual(Array.from(movementState.inventoryMovements, (item) => item.movementId), ["m1"]);
  movementState.inventoryMovements.push({ movementId: "m2", date: "2026-10-05T09:00:00Z" });
  movementJobs = [{ action: "adjust_inventory", payload: { adjustment: { eventId: "m2" } } }];
  await movementContext.loadInventoryMovements({ force: true });
  assert.ok(movementState.inventoryMovements.some((item) => item.movementId === "m2"));
  movementState.movementLoading = true;
  await movementContext.loadInventoryMovements({ force: true });
  assert.equal(movementReads, 3, "El clic fuerza otra lectura aunque había una en curso.");

  assert.equal(await saleContext.loadIncomeReport({ background: true, manual: true }), true);
  assert.equal(saleReads, 1);
  assert.equal(salesState.incomeReport.records.length, 0);
  assert.ok(saleMessages.some((message) => message.includes("Actualizando informe desde el respaldo")));
  saleFails = true;
  assert.equal(await saleContext.loadIncomeReport({ background: true, manual: true }), false);
  assert.equal(salesState.incomeReport.records.length, 0, "Si falla la red se conserva el último informe visible.");
  assert.ok(saleMessages.some((message) => message.includes("Sin conexión al respaldo")));

  assert.match(source, /target\.id === "syncAppsScriptInventory"[\s\S]*?await flushAppsScriptOutbox\(\);[\s\S]*?reconcileDeletions: true/);
  assert.match(source, /target\.id === "refreshInventoryMovements"\) await runManualRefreshButton\(target, \(\) => loadInventoryMovements\(\{ force: true \}\)\)/);
  assert.match(source, /target\.id === "refreshIncomeReport"\) await runManualRefreshButton\(target, \(\) => loadIncomeReport\(\{ background: true, manual: true \}\)\)/);
  assert.match(source, /button\.innerHTML = `\$\{icon\("loader-circle", 17\)\} Actualizando\.\.\.`/);
  const buttonClasses = new Set();
  const refreshButton = {
    disabled: false, innerHTML: "Actualizar",
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    classList: { add: (name) => buttonClasses.add(name), remove: (name) => buttonClasses.delete(name) }
  };
  const buttonContext = vm.createContext({ icon: () => "[icono]", refreshIcons: () => undefined });
  vm.runInContext(`${section("  const runManualRefreshButton =", "  const bindAdmin =")}globalThis.runManualRefreshButton = runManualRefreshButton;`, buttonContext);
  let finishRefresh;
  const refreshPending = buttonContext.runManualRefreshButton(refreshButton, () => new Promise((resolve) => { finishRefresh = resolve; }));
  assert.equal(refreshButton.disabled, true);
  assert.equal(refreshButton.innerHTML, "[icono] Actualizando...");
  assert.equal(refreshButton.attributes.get("aria-busy"), "true");
  assert.equal(buttonClasses.has("is-refreshing"), true);
  finishRefresh(true);
  await refreshPending;
  assert.equal(refreshButton.disabled, false);
  assert.equal(refreshButton.innerHTML, "Actualizar");
  assert.equal(refreshButton.attributes.has("aria-busy"), false);
  assert.equal(buttonClasses.has("is-refreshing"), false);
  console.log("Manual refresh buttons and deleted-row reconciliation OK");
})().catch((error) => { console.error(error); process.exitCode = 1; });
