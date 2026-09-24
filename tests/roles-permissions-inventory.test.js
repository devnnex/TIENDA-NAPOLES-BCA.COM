const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("admin.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const appsScript = fs.readFileSync("appscript/Code.gs", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260923190000_roles_permissions.sql", "utf8");

assert.match(html, /<option value="boss">Jefe<\/option>/);
assert.match(html, /data-toggle-user-pin/);
assert.match(html, /name="permissions" value="income"> Ventas/);
assert.match(html, /circle-dollar-sign"><\/i> Ventas/);
assert.doesNotMatch(html, />Ingresos<\/a>/);

assert.match(app, /const isBoss = .*role === "boss"/);
assert.match(app, /if \(isWaiter\(user\)\) return \["service"\]/);
assert.match(app, /data-share-user=/);
assert.match(app, /PIN: \$\{pin\}/);
assert.match(app, /const movementType = delta > 0 \? "ENTRADA_UNIDADES" : "SALIDA_UNIDADES"/);
assert.match(app, /recordLocalInventoryMovement\(\{[\s\S]*?eventId,[\s\S]*?movementReference/);
assert.match(app, /enqueueAppsScriptJob\("adjust_inventory"/);
assert.match(css, /body\[data-user-role="waiter"\] #tableSessionActions/);
assert.match(css, /body:not\(\[data-user-role="boss"\]\) \[data-boss-only\]/);

assert.match(appsScript, /requireBoss_\(user\);\s*result = editSale_/);
assert.match(appsScript, /requireBoss_\(user\);\s*result = deleteSale_/);
assert.match(appsScript, /requireSection_\(user, "movements"\)/);
assert.match(migration, /update public\.app_users set role = 'boss' where role = 'admin'/);
assert.match(migration, /permissions jsonb/);
assert.match(migration, /Solo el Jefe puede eliminar consumos/);

console.log("roles, permissions, credential sharing, and unit movements checks OK");
