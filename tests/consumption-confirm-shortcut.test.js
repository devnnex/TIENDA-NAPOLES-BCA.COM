const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");
const start = source.indexOf("  const bindConsumptionConfirmShortcut =");
const end = source.indexOf("  const openConsumptionDialog =", start);
assert.ok(start >= 0 && end > start);
assert.match(source, /bindConsumptionConfirmShortcut\(\);/);

const listeners = {};
const outside = {};
const document = {
  body: {},
  addEventListener(name, listener) { listeners[name] = listener; }
};
const dialog = {
  open: true,
  contains(target) { return target !== outside; },
  addEventListener(name, listener) { listeners[name] = listener; }
};
const search = { value: "", closest: () => ({}) };
const form = { session_item_id: { value: "" }, quantity: { value: "1" } };
let clicks = 0;
const submit = { disabled: false, click() { clicks += 1; } };
let now = 1000;
const context = vm.createContext({
  Date: { now: () => now },
  document,
  state: { consumptionDrafts: [{ itemName: "Producto" }] },
  $: (selector) => ({
    "#consumptionDialog": dialog, "#consumptionForm": form,
    "#consumptionSubmitButton": submit, "#consumptionProductSearch": search
  })[selector],
  currentConsumptionDraft: () => null
});
vm.runInContext(`${source.slice(start, end)}
globalThis.bindConsumptionConfirmShortcut = bindConsumptionConfirmShortcut;`, context);
context.bindConsumptionConfirmShortcut();

const space = (target, options = {}) => {
  let prevented = false;
  listeners.keydown({ key: " ", target, preventDefault: () => { prevented = true; }, ...options });
  return prevented;
};
assert.equal(space(search), true);
assert.equal(clicks, 0);
now += 200;
assert.equal(space(search), true);
assert.equal(clicks, 1);
search.value = "Nombre con espacios";
assert.equal(space(search), false, "No confirma mientras se escribe un nombre.");
search.value = "";
assert.equal(space({ value: "", closest: () => ({}) }), false, "No interfiere con otros campos.");
const neutral = { closest: () => null };
assert.equal(space(neutral), true);
now += 200;
assert.equal(space(neutral), true);
assert.equal(clicks, 2, "Confirma aunque ninguno de los dos campos tenga el foco.");
assert.equal(space(document.body), true);
now += 200;
assert.equal(space(document.body), true);
assert.equal(clicks, 3, "Tambien confirma cuando el foco queda en el fondo.");
assert.equal(space(outside), false, "No confirma desde otro dialogo.");
assert.equal(space(form.quantity), true);
now += 200;
assert.equal(space(form.quantity), true);
assert.equal(clicks, 4);
assert.equal(space(form.quantity, { repeat: true }), false, "Mantener la tecla no confirma.");
form.session_item_id.value = "edicion";
assert.equal(space(form.quantity), false, "No confirma mientras se edita un consumo.");
console.log("Doble espacio de consumo online OK");
