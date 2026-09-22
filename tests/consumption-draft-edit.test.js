const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");
const start = source.indexOf("  const renderConsumptionSelection =");
const end = source.indexOf("  const applyConsumptionRoleRestrictions =", start);
assert.ok(start >= 0 && end > start);

const form = {
  session_item_id: { value: "" }, menu_item_id: { value: "" }, item_name: { value: "" },
  quantity: { value: "", required: true }, unit_price: { value: "$0" }, notes: { value: "" },
  payer_name: { value: "Responsable" }
};
const elements = {
  "#consumptionSelection": { hidden: false },
  "#consumptionSelectionLines": { innerHTML: "" },
  "#consumptionSelectionCount": { textContent: "" },
  "#consumptionSelectionTotal": { textContent: "" },
  "#consumptionQueueButton": { innerHTML: "" },
  "#consumptionForm": form,
  "#consumptionProductSearch": { value: "", focus() {}, select() {} }
};
let replacementInput = null;
const context = vm.createContext({
  state: {
    currentUser: { role: "admin" },
    consumptionDrafts: [{ menuItemId: "a", itemName: "Agua", quantity: 1, unitPrice: 1000, notes: "", payerName: "Responsable" }],
    consumptionDraftEditIndex: -1,
    items: [{ id: "a", name: "Agua" }, { id: "b", name: "Cerveza" }]
  },
  $: (selector) => elements[selector] || null,
  money: (value) => `$${value}`,
  escapeHTML: (value) => String(value),
  icon: (name) => name,
  refreshIcons: () => {},
  inventoryFor: (item) => ({ code: item.name[0] }),
  renderConsumptionProductOptions: () => {}, closeConsumptionProductOptions: () => {},
  setCurrencyInputValue: (input, value) => { input.value = `$${value}`; },
  formattedCurrencyInput: (value) => `$${String(value).replace(/\D/g, "")}`,
  currencyInputNumber: (input) => Number(String(input.value).replace(/\D/g, "")),
  toast: () => {},
  window: { requestAnimationFrame: (callback) => callback() },
  document: { createElement: () => {
    const listeners = {};
    replacementInput = {
      value: "", setAttribute() {}, focus() {}, select() {}, setSelectionRange() {},
      addEventListener: (name, callback) => { listeners[name] = callback; },
      fire: (name, event = {}) => listeners[name]?.(event)
    };
    return replacementInput;
  } }
});
vm.runInContext(`${source.slice(start, end)}\nthis.editProduct = editConsumptionDraftProduct; this.editPrice = editConsumptionDraftPrice; this.queueDraft = queueConsumptionDraft;`, context);

context.editProduct(0);
assert.equal(context.state.consumptionDraftEditIndex, 0);
assert.equal(form.menu_item_id.value, "a");
assert.equal(form.quantity.value, 1);
assert.match(elements["#consumptionQueueButton"].innerHTML, /Guardar cambio/);

form.menu_item_id.value = "b";
form.item_name.value = "Cerveza";
form.quantity.value = "2";
form.unit_price.value = "$2500";
context.queueDraft();
assert.equal(context.state.consumptionDrafts.length, 1);
assert.deepEqual(JSON.parse(JSON.stringify(context.state.consumptionDrafts[0])), {
  menuItemId: "b", itemName: "Cerveza", quantity: 2, unitPrice: 2500, notes: "", payerName: "Responsable"
});
assert.equal(context.state.consumptionDraftEditIndex, -1);

const priceElement = { dataset: { editConsumptionPrice: "0" }, replaceWith: (input) => { replacementInput = input; } };
context.editPrice(priceElement);
replacementInput.value = "$3200";
replacementInput.fire("blur");
assert.equal(context.state.consumptionDrafts[0].unitPrice, 3200);
console.log("pending consumption replacement and unit price editing OK");
