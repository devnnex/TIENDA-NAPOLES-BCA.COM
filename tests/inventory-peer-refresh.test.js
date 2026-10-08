const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

(async () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../app.js"), "utf8");
  const start = source.indexOf("  let inventoryPeerRefreshPending =");
  const end = source.indexOf("  const queueInventoryUpsert =", start);
  assert.ok(start >= 0 && end > start);
  let finishRead;
  const currentRead = new Promise((resolve) => { finishRead = resolve; });
  const calls = [];
  const context = vm.createContext({
    state: { currentUser: { id: "staff" }, activeAdminSection: "inventory" },
    navigator: { onLine: true },
    isAppsScriptConfigured: () => true,
    syncInventoryWithAppsScript: async () => { calls.push("inventory"); return true; },
    loadInventoryMovements: async () => { calls.push("movements"); },
    inventorySyncPromise: currentRead
  });
  vm.runInContext(source.slice(start, end) + ";globalThis.refresh = refreshInventoryFromPeer;", context);
  const first = context.refresh();
  const second = context.refresh();
  assert.equal(first, second, "Varios avisos comparten la misma actualización.");
  assert.equal(calls.length, 0, "La actualización espera la lectura anterior.");
  context.inventorySyncPromise = null;
  finishRead(true);
  await first;
  assert.deepEqual(calls, ["inventory"], "Consulta el inventario después de la lectura anterior.");
  context.navigator.onLine = false;
  await context.refresh();
  assert.equal(calls.length, 1, "Sin conexión no fuerza una lectura remota.");
  console.log("PASS inventario BCA: avisos entre equipos y lecturas ordenadas");
})().catch((error) => { console.error(error); process.exitCode = 1; });
