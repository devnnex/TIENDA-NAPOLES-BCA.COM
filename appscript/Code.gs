/**
 * TIENDA NAPOLES - Inventario e ingresos historicos
 *
 * Todo se almacena en un unico archivo de Google Sheets.
 * No requiere archivos HTML, puentes, libros auxiliares ni libros anuales.
 * Publique este Code.gs como aplicacion web: ejecutar como usted y acceso para cualquiera.
 */

var APP = {
  version: "2.2.0",
  spreadsheetId: "1hjl2H0aMLUCwf3p74YbcnXviPAoVQTbNulyehfZU53s",
  properties: {
    schemaVersion: "TN_SCHEMA_VERSION",
    supabaseUrl: "TN_SUPABASE_URL",
    supabaseAnonKey: "TN_SUPABASE_ANON_KEY",
    allowedOrigins: "TN_ALLOWED_ORIGINS",
    timezone: "TN_TIMEZONE"
  },
  sheets: {
    config: "Configuracion",
    inventory: "Inventario",
    audit: "Auditoria",
    sales: "Ventas",
    details: "Detalle_Ventas",
    payments: "Pagos",
    movements: "Movimientos_Inventario",
    daily: "Ingresos_Diarios"
  }
};

var HEADERS = {
  inventory: [
    "product_id", "siglas", "producto", "categoria", "unidad", "costo_unitario",
    "precio_venta", "existencia", "stock_minimo", "disponible", "actualizado_en",
    "ultimo_movimiento", "version", "notas"
  ],
  audit: ["fecha", "evento", "referencia", "usuario", "estado", "detalle"],
  sales: [
    "sale_id", "factura", "session_id", "table_id", "mesa", "fecha", "responsable",
    "mesero", "subtotal", "descuento", "impuestos", "servicio", "total",
    "forma_pago", "referencia_pago", "origen", "sincronizado_en"
  ],
  details: [
    "sale_id", "factura", "line_id", "menu_item_id", "producto", "cantidad",
    "precio_unitario", "total_linea", "costo_unitario", "costo_total", "utilidad_bruta"
  ],
  payments: ["sale_id", "factura", "medio", "valor", "referencia", "fecha"],
  movements: [
    "movement_id", "product_id", "siglas", "producto", "tipo", "cantidad_cambio",
    "existencia_antes", "existencia_despues", "costo_unitario", "factura",
    "session_id", "fecha", "usuario"
  ],
  daily: [
    "fecha", "numero_ventas", "ingreso_bruto", "efectivo", "transferencia", "bre_b",
    "descuentos", "impuestos", "servicio", "costo_mercancia", "utilidad_bruta", "actualizado_en",
    "ventas_procesadas"
  ]
};

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("Tienda Napoles")
      .addItem("Configurar sistema", "CONFIGURAR_SISTEMA")
      .addItem("Guardar configuracion", "GUARDAR_CONFIGURACION")
      .addToUi();
  } catch (error) {
    // Un proyecto independiente no tiene interfaz de hoja hasta crear el maestro.
  }
}

function CONFIGURAR_SISTEMA() {
  var spreadsheet = getSpreadsheet_();
  spreadsheet.setSpreadsheetTimeZone("America/Bogota");
  ensureAllSheets_(spreadsheet);
  seedConfiguration_(spreadsheet);
  PropertiesService.getScriptProperties().setProperty(APP.properties.schemaVersion, APP.version);
  appendAudit_("SETUP", spreadsheet.getId(), "Sistema", "OK", "Sistema inicializado en el archivo unico.");
  var result = {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    sheets: Object.keys(APP.sheets).map(function (key) { return APP.sheets[key]; }),
    message: "Todas las pestañas fueron creadas en el archivo configurado."
  };
  console.log("Archivo configurado: " + result.spreadsheetUrl);
  return result;
}

function GUARDAR_CONFIGURACION() {
  var spreadsheet = getSpreadsheet_();
  ensureAllSheets_(spreadsheet);
  var sheet = spreadsheet.getSheetByName(APP.sheets.config);
  var values = sheet.getDataRange().getDisplayValues();
  var config = {};
  for (var row = 1; row < values.length; row += 1) {
    var key = String(values[row][0] || "").trim();
    if (key) config[key] = String(values[row][1] || "").trim();
  }
  var properties = PropertiesService.getScriptProperties();
  properties.setProperty(APP.properties.supabaseUrl, config.SUPABASE_URL || "");
  properties.setProperty(APP.properties.supabaseAnonKey, config.SUPABASE_ANON_KEY || "");
  properties.setProperty(APP.properties.allowedOrigins, config.ORIGENES_PERMITIDOS || "");
  properties.setProperty(APP.properties.timezone, config.ZONA_HORARIA || "America/Bogota");
  CacheService.getScriptCache().remove("tn_config");
  appendAudit_("CONFIG", "Configuracion", "Sistema", "OK", "Configuracion guardada.");
  return { ok: true, message: "Configuracion guardada." };
}

function doGet() {
  try {
    ensureSystemReady_();
    return jsonOutput_({
      ok: true,
      service: "TIENDA NAPOLES",
      version: APP.version,
      configured: isConfigured_(),
      spreadsheetId: APP.spreadsheetId
    });
  } catch (error) {
    return jsonOutput_({ ok: false, service: "TIENDA NAPOLES", version: APP.version, error: String(error.message || error) });
  }
}

function doPost(e) {
  var body = e && e.postData ? e.postData.contents : "{}";
  return jsonOutput_(apiRequest(body));
}

function apiRequest(payloadText) {
  var request = {};
  try {
    request = JSON.parse(String(payloadText || "{}"));
    ensureSystemReady_();
    if (request.action === "bootstrap") {
      return bootstrapConnection_(request.payload || {}, request.origin, request.authToken);
    }
    validateOrigin_(request.origin);
    if (request.action === "status") {
      return { ok: true, version: APP.version, configured: isConfigured_() };
    }
    var user = validateSupabaseUser_(request.authToken);
    var payload = request.payload || {};
    var result;
    if (request.action === "get_inventory") result = getInventory_();
    else if (request.action === "get_income_report") {
      requireAdmin_(user);
      result = getIncomeReport_(payload.filters || {});
    }
    else if (request.action === "record_sale") result = recordSale_(payload.invoice, user, request.authToken);
    else if (request.action === "adjust_inventory") result = adjustInventory_(payload.adjustment, user);
    else if (request.action === "delete_inventory") {
      requireAdmin_(user);
      result = deleteInventory_(payload.productId, user);
    }
    else if (request.action === "upsert_inventory") {
      requireAdmin_(user);
      result = upsertInventory_(payload.item, user);
    } else if (request.action === "sync_inventory") {
      requireAdmin_(user);
      result = syncInventory_(payload.items || [], user);
    } else {
      throw new Error("Accion no permitida: " + request.action);
    }
    if (result && result.ok === false) return result;
    result.ok = true;
    return result;
  } catch (error) {
    try {
      appendAudit_("API_ERROR", request.action || "unknown", "Sistema", "ERROR", String(error.message || error));
    } catch (auditError) {
      // La respuesta original tiene prioridad.
    }
    return { ok: false, error: String(error.message || error) };
  }
}

function ensureSystemReady_() {
  var spreadsheet = getSpreadsheet_();
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(APP.properties.schemaVersion) !== APP.version) {
    spreadsheet.setSpreadsheetTimeZone(getTimezone_());
    ensureAllSheets_(spreadsheet);
    seedConfiguration_(spreadsheet);
    properties.setProperty(APP.properties.schemaVersion, APP.version);
  }
  return spreadsheet;
}

function bootstrapConnection_(payload, origin, authToken) {
  var candidate = {
    supabaseUrl: String(payload.supabaseUrl || "").trim().replace(/\/$/, ""),
    supabaseAnonKey: String(payload.supabaseAnonKey || "").trim()
  };
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(candidate.supabaseUrl) || !candidate.supabaseAnonKey) {
    throw new Error("La conexion operativa enviada por el panel esta incompleta.");
  }
  var user = validateSupabaseUserWithConfig_(authToken, candidate);
  requireAdmin_(user);
  var properties = PropertiesService.getScriptProperties();
  var existingOrigins = String(properties.getProperty(APP.properties.allowedOrigins) || "")
    .split(",").map(function (value) { return value.trim(); }).filter(Boolean);
  var cleanOrigin = String(origin || "").trim();
  if (cleanOrigin && existingOrigins.indexOf(cleanOrigin) < 0) existingOrigins.push(cleanOrigin);
  properties.setProperty(APP.properties.supabaseUrl, candidate.supabaseUrl);
  properties.setProperty(APP.properties.supabaseAnonKey, candidate.supabaseAnonKey);
  properties.setProperty(APP.properties.allowedOrigins, existingOrigins.join(","));
  if (!properties.getProperty(APP.properties.timezone)) properties.setProperty(APP.properties.timezone, "America/Bogota");
  updateConfigurationSheet_(candidate, existingOrigins);
  CacheService.getScriptCache().remove("tn_config");
  CacheService.getScriptCache().put("user_" + hash_(String(authToken || "")), JSON.stringify(user), 120);
  appendAudit_("REMOTE_BOOTSTRAP", cleanOrigin, user.full_name || user.username, "OK", "Conexion inicializada desde el panel.");
  return { ok: true, configured: true, version: APP.version, user: { id: user.id, role: user.role } };
}

function updateConfigurationSheet_(candidate, origins) {
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(APP.sheets.config);
  var values = sheet.getDataRange().getValues();
  var updates = {
    SUPABASE_URL: candidate.supabaseUrl,
    SUPABASE_ANON_KEY: candidate.supabaseAnonKey,
    ORIGENES_PERMITIDOS: origins.join(",")
  };
  for (var row = 1; row < values.length; row += 1) {
    var key = String(values[row][0] || "").trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) sheet.getRange(row + 1, 2).setValue(updates[key]);
  }
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(APP.spreadsheetId);
}

function ensureAllSheets_(spreadsheet) {
  ensureSheet_(spreadsheet, APP.sheets.config, ["Clave", "Valor", "Descripcion"]);
  ensureSheet_(spreadsheet, APP.sheets.inventory, HEADERS.inventory);
  ensureSheet_(spreadsheet, APP.sheets.audit, HEADERS.audit);
  ensureSheet_(spreadsheet, APP.sheets.sales, HEADERS.sales);
  ensureSheet_(spreadsheet, APP.sheets.details, HEADERS.details);
  ensureSheet_(spreadsheet, APP.sheets.payments, HEADERS.payments);
  ensureSheet_(spreadsheet, APP.sheets.movements, HEADERS.movements);
  ensureSheet_(spreadsheet, APP.sheets.daily, HEADERS.daily);
}

function seedConfiguration_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(APP.sheets.config);
  if (sheet.getLastRow() > 1) return;
  var rows = [
    ["NEGOCIO", "TIENDA NAPOLES", "Nombre del negocio"],
    ["SUPABASE_URL", "https://izvcbkwgtciuoampunba.supabase.co", "URL del proyecto Supabase"],
    ["SUPABASE_ANON_KEY", "", "Clave anon valida; se usa solo en Apps Script"],
    ["ORIGENES_PERMITIDOS", "null,http://localhost:5500", "Dominios separados por coma; agregue el dominio real"],
    ["ZONA_HORARIA", "America/Bogota", "Zona horaria del negocio"]
  ];
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  sheet.autoResizeColumns(1, 3);
}

function ensureSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0 || String(sheet.getRange(1, 1).getValue()) !== headers[0]) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#17191f")
    .setFontColor("#ffffff");
  return sheet;
}

function getInventory_() {
  var table = readInventoryTable_();
  var items = [];
  for (var index = 0; index < table.rows.length; index += 1) {
    var row = table.rows[index];
    if (!row[0]) continue;
    items.push(inventoryRowToObject_(row));
  }
  return { items: items, syncedAt: new Date().toISOString() };
}

function getIncomeReport_(filters) {
  var spreadsheet = getSpreadsheet_();
  var timezone = getTimezone_();
  var today = Utilities.formatDate(new Date(), timezone, "yyyy-MM-dd");
  var dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateFrom || "")) ? String(filters.dateFrom) : today;
  var dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateTo || "")) ? String(filters.dateTo) : today;
  if (dateFrom > dateTo) {
    var swap = dateFrom;
    dateFrom = dateTo;
    dateTo = swap;
  }
  var methodFilter = String(filters.paymentMethod || "all").toLowerCase();
  var query = normalizeSearch_(filters.query || "");
  var salesRows = readSheetRows_(spreadsheet.getSheetByName(APP.sheets.sales), HEADERS.sales.length);
  var paymentRows = readSheetRows_(spreadsheet.getSheetByName(APP.sheets.payments), HEADERS.payments.length);
  var detailRows = readSheetRows_(spreadsheet.getSheetByName(APP.sheets.details), HEADERS.details.length);
  var paymentsBySale = {};
  var detailsBySale = {};

  paymentRows.forEach(function (row) {
    var saleId = String(row[0] || "");
    if (!saleId) return;
    if (!paymentsBySale[saleId]) paymentsBySale[saleId] = [];
    paymentsBySale[saleId].push({
      method: String(row[2] || "").toLowerCase(),
      amount: asNumber_(row[3]),
      reference: String(row[4] || "")
    });
  });

  detailRows.forEach(function (row) {
    var saleId = String(row[0] || "");
    if (!saleId) return;
    if (!detailsBySale[saleId]) detailsBySale[saleId] = [];
    detailsBySale[saleId].push({
      name: String(row[4] || "Producto"),
      quantity: asNumber_(row[5]),
      unitPrice: asNumber_(row[6]),
      total: asNumber_(row[7]),
      cost: asNumber_(row[9]),
      profit: asNumber_(row[10])
    });
  });

  var totals = {
    income: 0,
    sales: 0,
    subtotal: 0,
    discount: 0,
    tax: 0,
    service: 0,
    cost: 0,
    profit: 0,
    cash: 0,
    transfer: 0,
    breb: 0,
    other: 0
  };
  var records = [];

  salesRows.forEach(function (row) {
    var saleId = String(row[0] || "");
    if (!saleId) return;
    var dateKey = dateValueToKey_(row[5], timezone);
    if (!dateKey || dateKey < dateFrom || dateKey > dateTo) return;
    var total = asNumber_(row[12]);
    var payments = paymentsBySale[saleId] || [];
    if (!payments.length && row[13]) payments = [{ method: String(row[13]).toLowerCase(), amount: total, reference: String(row[14] || "") }];
    var isMixed = payments.length > 1 || String(row[13] || "").toLowerCase() === "mixed";
    if (methodFilter === "mixed" && !isMixed) return;
    if (methodFilter !== "all" && methodFilter !== "mixed" && !payments.some(function (payment) { return payment.method === methodFilter; })) return;
    var items = detailsBySale[saleId] || [];
    var searchText = normalizeSearch_([
      saleId, row[1], row[4], row[6], row[7], row[13], row[14],
      payments.map(function (payment) { return payment.method + " " + payment.reference; }).join(" "),
      items.map(function (item) { return item.name; }).join(" ")
    ].join(" "));
    if (query && searchText.indexOf(query) < 0) return;
    var cost = items.reduce(function (sum, item) { return sum + asNumber_(item.cost); }, 0);
    var record = {
      saleId: saleId,
      invoice: String(row[1] || ""),
      sessionId: String(row[2] || ""),
      table: String(row[4] || "Mesa"),
      date: String(row[5] instanceof Date ? row[5].toISOString() : row[5] || ""),
      payer: String(row[6] || ""),
      waiter: String(row[7] || ""),
      subtotal: asNumber_(row[8]),
      discount: asNumber_(row[9]),
      tax: asNumber_(row[10]),
      service: asNumber_(row[11]),
      total: total,
      cost: cost,
      profit: total - cost,
      reference: String(row[14] || ""),
      isMixed: isMixed,
      payments: payments,
      items: items
    };
    records.push(record);
    totals.income += total;
    totals.sales += 1;
    totals.subtotal += record.subtotal;
    totals.discount += record.discount;
    totals.tax += record.tax;
    totals.service += record.service;
    totals.cost += cost;
    totals.profit += record.profit;
    payments.forEach(function (payment) {
      if (payment.method === "cash") totals.cash += payment.amount;
      else if (payment.method === "transfer") totals.transfer += payment.amount;
      else if (payment.method === "breb") totals.breb += payment.amount;
      else totals.other += payment.amount;
    });
  });

  records.sort(function (left, right) { return String(right.date).localeCompare(String(left.date)); });
  totals.averageTicket = totals.sales ? totals.income / totals.sales : 0;
  var totalRecords = records.length;
  var limit = Math.min(500, Math.max(50, asNumber_(filters.limit) || 300));
  return {
    filters: { dateFrom: dateFrom, dateTo: dateTo, paymentMethod: methodFilter, query: String(filters.query || "") },
    totals: totals,
    records: records.slice(0, limit),
    recordKeys: records.slice(0, 1200).map(function (record) { return record.saleId; }),
    totalRecords: totalRecords,
    truncated: totalRecords > limit,
    generatedAt: new Date().toISOString()
  };
}

function readSheetRows_(sheet, width) {
  if (!sheet || sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
}

function dateValueToKey_(value, timezone) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, timezone, "yyyy-MM-dd");
  var text = String(value || "").trim();
  var direct = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  var parsed = new Date(text);
  return isNaN(parsed.getTime()) ? "" : Utilities.formatDate(parsed, timezone, "yyyy-MM-dd");
}

function normalizeSearch_(value) {
  var text = String(value || "").toLowerCase();
  try { text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (error) { /* Motor antiguo. */ }
  return text.replace(/\s+/g, " ").trim();
}

function upsertInventory_(item, user) {
  if (!item || !item.productId) throw new Error("Producto de inventario incompleto.");
  return withScriptLock_(function () {
    var table = readInventoryTable_();
    var rowIndex = findInventoryIndex_(table.rows, item.productId);
    var current = rowIndex >= 0 ? table.rows[rowIndex] : null;
    var next = inventoryObjectToRow_(item, current);
    if (rowIndex >= 0) table.rows[rowIndex] = next;
    else table.rows.push(next);
    writeInventoryRows_(table.sheet, table.rows);
    appendAudit_("INVENTORY_UPSERT", item.productId, user.full_name || user.username, "OK", item.name || "Producto");
    return { item: inventoryRowToObject_(next), items: table.rows.filter(function (row) { return row[0]; }).map(inventoryRowToObject_) };
  });
}

function syncInventory_(items, user) {
  if (!Array.isArray(items)) throw new Error("Inventario invalido.");
  return withScriptLock_(function () {
    var table = readInventoryTable_();
    var rows = table.rows.slice();
    items.forEach(function (item) {
      if (!item || !item.productId) return;
      var rowIndex = findInventoryIndex_(rows, item.productId);
      var current = rowIndex >= 0 ? rows[rowIndex] : null;
      var next = inventoryObjectToRow_(item, current);
      if (rowIndex >= 0) rows[rowIndex] = next;
      else rows.push(next);
    });
    writeInventoryRows_(table.sheet, rows);
    appendAudit_("INVENTORY_SYNC", String(items.length), user.full_name || user.username, "OK", "Carga inicial de inventario");
    return { items: rows.filter(function (row) { return row[0]; }).map(inventoryRowToObject_) };
  });
}

function adjustInventory_(adjustment, user) {
  var eventId = String(adjustment && adjustment.eventId || "").trim();
  var productId = String(adjustment && adjustment.productId || "").trim();
  var delta = asNumber_(adjustment && adjustment.delta);
  if (!eventId || !productId || !delta) return { ok: false, retryable: false, error: "Movimiento de inventario incompleto." };
  return withScriptLock_(function () {
    var spreadsheet = getSpreadsheet_();
    var movementsSheet = spreadsheet.getSheetByName(APP.sheets.movements);
    var table = readInventoryTable_();
    var rowIndex = findInventoryIndex_(table.rows, productId);
    if (rowIndex < 0) return { ok: false, retryable: false, error: "El producto ya no existe en el inventario." };
    var currentRow = table.rows[rowIndex];
    if (hasValueInColumn_(movementsSheet, eventId, 1)) {
      return { duplicate: true, item: inventoryRowToObject_(currentRow) };
    }
    var reversesEventId = String(adjustment.reversesEventId || "").trim();
    if (reversesEventId && !hasValueInColumn_(movementsSheet, reversesEventId, 1)) {
      return { duplicate: true, skippedReversal: true, item: inventoryRowToObject_(currentRow) };
    }
    var before = asNumber_(currentRow[7]);
    var after = before + delta;
    if (after < 0) {
      return {
        ok: false,
        retryable: false,
        error: "No hay existencias suficientes para aplicar el consumo de " + String(currentRow[2] || adjustment.name || "este producto") + ".",
        item: inventoryRowToObject_(currentRow)
      };
    }
    var now = String(adjustment.occurredAt || new Date().toISOString());
    var movementType = delta < 0 ? "CONSUMO_MESA" : "DEVOLUCION_CONSUMO";
    currentRow[7] = after;
    currentRow[10] = now;
    currentRow[11] = movementType + " " + eventId;
    currentRow[12] = asNumber_(currentRow[12]) + 1;
    table.sheet.getRange(rowIndex + 2, 1, 1, HEADERS.inventory.length).setValues([currentRow]);
    appendRows_(movementsSheet, [[
      safeText_(eventId), productId, safeText_(currentRow[1] || adjustment.code),
      safeText_(currentRow[2] || adjustment.name), movementType, delta, before, after,
      asNumber_(currentRow[5]), "", safeText_(adjustment.sessionId), now,
      safeText_(user.full_name || user.username)
    ]]);
    appendAudit_("INVENTORY_CONSUMPTION", eventId, user.full_name || user.username, "OK", movementType + " " + delta);
    return { duplicate: false, item: inventoryRowToObject_(currentRow) };
  });
}

function consumptionAdjustedByProduct_(movementsSheet, sessionId) {
  var totals = {};
  var rows = readSheetRows_(movementsSheet, HEADERS.movements.length);
  rows.forEach(function (row) {
    if (String(row[10] || "") !== String(sessionId || "")) return;
    var type = String(row[4] || "");
    if (type !== "CONSUMO_MESA" && type !== "DEVOLUCION_CONSUMO") return;
    var productId = String(row[1] || "");
    if (!productId) return;
    totals[productId] = asNumber_(totals[productId]) - asNumber_(row[5]);
  });
  return totals;
}

function deleteInventory_(productId, user) {
  var cleanId = String(productId || "").trim();
  if (!cleanId) throw new Error("Producto de inventario invalido.");
  return withScriptLock_(function () {
    var table = readInventoryTable_();
    var rowIndex = findInventoryIndex_(table.rows, cleanId);
    if (rowIndex >= 0) table.sheet.deleteRow(rowIndex + 2);
    appendAudit_("INVENTORY_DELETE", cleanId, user.full_name || user.username, "OK", rowIndex >= 0 ? "Producto eliminado" : "Producto ya no existia");
    return { deleted: rowIndex >= 0, productId: cleanId };
  });
}

function recordSale_(invoice, user, authToken) {
  if (!invoice || !invoice.sessionId || !invoice.totals) throw new Error("Factura incompleta.");
  return withScriptLock_(function () {
    var saleId = safeText_(invoice.id || invoice.sessionId);
    var sessionId = safeText_(invoice.sessionId);
    var spreadsheet = getSpreadsheet_();
    var salesSheet = spreadsheet.getSheetByName(APP.sheets.sales);
    if (saleExists_(salesSheet, saleId, sessionId)) {
      updateDailyIncome_(spreadsheet.getSheetByName(APP.sheets.daily), invoice, invoiceCostFromInventory_(invoice), saleId);
      archiveSupabaseSession_(sessionId, authToken);
      return { duplicate: true, saleId: saleId, archivedSessionId: sessionId, items: getInventory_().items };
    }

    var now = new Date().toISOString();
    var totals = invoice.totals || {};
    var saleRow = [[
      saleId, safeText_(invoice.number), sessionId, safeText_(invoice.tableId), safeText_(invoice.table),
      safeText_(invoice.createdAt || now), safeText_(invoice.payerName), safeText_(invoice.waiterName),
      asNumber_(totals.subtotal), asNumber_(totals.discount), asNumber_(totals.tax),
      asNumber_(totals.serviceFee), asNumber_(totals.total), safeText_(invoice.paymentMethod),
      safeText_(invoice.reference), "Supabase/Panel", now
    ]];

    var inventoryTable = readInventoryTable_();
    var inventoryRows = inventoryTable.rows.slice();
    var movementsSheet = spreadsheet.getSheetByName(APP.sheets.movements);
    var adjustedByProduct = consumptionAdjustedByProduct_(movementsSheet, sessionId);
    var details = [];
    var movements = [];
    var processedProducts = {};
    var totalCost = 0;
    (invoice.items || []).forEach(function (line) {
      var productId = safeText_(line.menu_item_id);
      var quantity = Math.max(0, asNumber_(line.quantity));
      var unitPrice = Math.max(0, asNumber_(line.unit_price));
      var cost = 0;
      var before = 0;
      var after = 0;
      var code = "";
      if (productId) {
        var inventoryIndex = findInventoryIndex_(inventoryRows, productId);
        if (inventoryIndex < 0) {
          inventoryRows.push(inventoryObjectToRow_({
            productId: productId,
            code: acronym_(line.item_name),
            name: line.item_name,
            unit: "unidad",
            costPrice: 0,
            salePrice: unitPrice,
            stock: 0,
            minStock: 0,
            isAvailable: true
          }, null));
          inventoryIndex = inventoryRows.length - 1;
        }
        var inventoryRow = inventoryRows[inventoryIndex];
        code = safeText_(inventoryRow[1]);
        cost = asNumber_(inventoryRow[5]);
        if (!processedProducts[productId]) {
          var productQuantity = (invoice.items || []).filter(function (entry) {
            return safeText_(entry.menu_item_id) === productId;
          }).reduce(function (sum, entry) { return sum + Math.max(0, asNumber_(entry.quantity)); }, 0);
          var alreadyAdjusted = Math.max(0, asNumber_(adjustedByProduct[productId]));
          var reconciliationDelta = alreadyAdjusted - productQuantity;
          var movementMarker = "VENTA " + saleId;
          if (String(inventoryRow[11] || "") === movementMarker) {
            after = asNumber_(inventoryRow[7]);
            before = after - reconciliationDelta;
          } else {
            before = asNumber_(inventoryRow[7]);
            after = Math.max(0, before + reconciliationDelta);
            if (reconciliationDelta !== 0) {
              inventoryRow[7] = after;
              inventoryRow[10] = now;
              inventoryRow[11] = movementMarker;
              inventoryRow[12] = asNumber_(inventoryRow[12]) + 1;
              inventoryRows[inventoryIndex] = inventoryRow;
            }
          }
          if (reconciliationDelta !== 0) {
            movements.push([
              "SALE-" + saleId + "-" + productId, productId, code, safeText_(line.item_name), "AJUSTE_CIERRE", reconciliationDelta,
              before, after, cost, safeText_(invoice.number), sessionId, safeText_(invoice.createdAt || now),
              safeText_(user.full_name || user.username)
            ]);
          }
          processedProducts[productId] = true;
        }
      }
      var lineTotal = quantity * unitPrice;
      var lineCost = quantity * cost;
      totalCost += lineCost;
      details.push([
        saleId, safeText_(invoice.number), safeText_(line.id), productId, safeText_(line.item_name),
        quantity, unitPrice, lineTotal, cost, lineCost, lineTotal - lineCost
      ]);
    });

    var payments = (invoice.payments || []).map(function (payment) {
      return [saleId, safeText_(invoice.number), safeText_(payment.method), asNumber_(payment.amount), safeText_(invoice.reference), safeText_(invoice.createdAt || now)];
    });

    var detailsSheet = spreadsheet.getSheetByName(APP.sheets.details);
    var paymentsSheet = spreadsheet.getSheetByName(APP.sheets.payments);
    if (!hasValueInColumn_(detailsSheet, saleId, 1)) appendRows_(detailsSheet, details);
    if (!hasValueInColumn_(paymentsSheet, saleId, 1)) appendRows_(paymentsSheet, payments);
    writeInventoryRows_(inventoryTable.sheet, inventoryRows);
    if (movements.length) {
      var newMovements = movements.filter(function (movement) { return !hasValueInColumn_(movementsSheet, movement[0], 1); });
      appendRows_(movementsSheet, newMovements);
    }
    appendRows_(salesSheet, saleRow);
    updateDailyIncome_(spreadsheet.getSheetByName(APP.sheets.daily), invoice, totalCost, saleId);
    archiveSupabaseSession_(sessionId, authToken);
    CacheService.getScriptCache().put("sale_" + hash_(saleId + "|" + sessionId), "1", 21600);
    appendAudit_("SALE", saleId, user.full_name || user.username, "OK", safeText_(invoice.number));
    return {
      duplicate: false,
      saleId: saleId,
      archivedSessionId: sessionId,
      invoiceNumber: safeText_(invoice.number),
      items: inventoryRows.filter(function (row) { return row[0]; }).map(inventoryRowToObject_)
    };
  });
}

function archiveSupabaseSession_(sessionId, authToken) {
  if (!sessionId) return;
  var config = getConfig_();
  var baseUrl = config.supabaseUrl.replace(/\/$/, "") + "/rest/v1/";
  var encodedSession = encodeURIComponent(sessionId);
  deleteSupabaseRows_(baseUrl + "service_requests?session_id=eq." + encodedSession, authToken, config);
  deleteSupabaseRows_(baseUrl + "session_items?session_id=eq." + encodedSession, authToken, config);
  deleteSupabaseRows_(baseUrl + "table_sessions?id=eq." + encodedSession + "&status=eq.closed", authToken, config);
}

function deleteSupabaseRows_(url, authToken, config) {
  var response = UrlFetchApp.fetch(url, {
    method: "delete",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: "Bearer " + config.supabaseAnonKey,
      "x-app-token": String(authToken || ""),
      Prefer: "return=minimal"
    },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error("La venta se archivo, pero Supabase no permitio limpiar la sesion cerrada. Se reintentara.");
  }
}

function readInventoryTable_() {
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(APP.sheets.inventory);
  var lastRow = sheet.getLastRow();
  var rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, HEADERS.inventory.length).getValues() : [];
  return { sheet: sheet, rows: rows };
}

function writeInventoryRows_(sheet, rows) {
  var width = HEADERS.inventory.length;
  var previousDataRows = Math.max(0, sheet.getLastRow() - 1);
  if (rows.length) sheet.getRange(2, 1, rows.length, width).setValues(rows);
  if (previousDataRows > rows.length) sheet.getRange(2 + rows.length, 1, previousDataRows - rows.length, width).clearContent();
}

function inventoryObjectToRow_(item, current) {
  var now = new Date().toISOString();
  var base = current || new Array(HEADERS.inventory.length).fill("");
  return [
    safeText_(item.productId),
    safeText_(String(item.code || acronym_(item.name)).toUpperCase()),
    safeText_(item.name),
    safeText_(item.category),
    safeText_(item.unit || "unidad"),
    Math.max(0, asNumber_(item.costPrice)),
    Math.max(0, asNumber_(item.salePrice)),
    Math.max(0, asNumber_(item.stock)),
    Math.max(0, asNumber_(item.minStock)),
    item.isAvailable !== false,
    now,
    safeText_(base[11] || "AJUSTE"),
    asNumber_(base[12]) + 1,
    safeText_(item.notes || base[13])
  ];
}

function inventoryRowToObject_(row) {
  return {
    productId: String(row[0] || ""),
    code: String(row[1] || ""),
    name: String(row[2] || ""),
    category: String(row[3] || ""),
    unit: String(row[4] || "unidad"),
    costPrice: asNumber_(row[5]),
    salePrice: asNumber_(row[6]),
    stock: asNumber_(row[7]),
    minStock: asNumber_(row[8]),
    isAvailable: row[9] !== false,
    updatedAt: String(row[10] || ""),
    version: asNumber_(row[12])
  };
}

function updateDailyIncome_(sheet, invoice, totalCost, saleId) {
  var dateKey = Utilities.formatDate(new Date(invoice.createdAt || Date.now()), getTimezone_(), "yyyy-MM-dd");
  var lastRow = sheet.getLastRow();
  var rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, HEADERS.daily.length).getValues() : [];
  var targetIndex = -1;
  for (var index = 0; index < rows.length; index += 1) {
    var existingDate = rows[index][0] instanceof Date
      ? Utilities.formatDate(rows[index][0], getTimezone_(), "yyyy-MM-dd")
      : String(rows[index][0] || "");
    if (existingDate === dateKey) { targetIndex = index; break; }
  }
  var row = targetIndex >= 0 ? rows[targetIndex] : [dateKey, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "", ""];
  var processedSales = String(row[12] || "");
  var saleMarker = "|" + String(saleId || invoice.id || invoice.sessionId) + "|";
  if (processedSales.indexOf(saleMarker) >= 0) return;
  row[1] = asNumber_(row[1]) + 1;
  row[2] = asNumber_(row[2]) + asNumber_(invoice.totals.total);
  (invoice.payments || []).forEach(function (payment) {
    if (payment.method === "cash") row[3] = asNumber_(row[3]) + asNumber_(payment.amount);
    if (payment.method === "transfer") row[4] = asNumber_(row[4]) + asNumber_(payment.amount);
    if (payment.method === "breb") row[5] = asNumber_(row[5]) + asNumber_(payment.amount);
  });
  row[6] = asNumber_(row[6]) + asNumber_(invoice.totals.discount);
  row[7] = asNumber_(row[7]) + asNumber_(invoice.totals.tax);
  row[8] = asNumber_(row[8]) + asNumber_(invoice.totals.serviceFee);
  row[9] = asNumber_(row[9]) + totalCost;
  row[10] = asNumber_(row[10]) + asNumber_(invoice.totals.total) - totalCost;
  row[11] = new Date().toISOString();
  row[12] = processedSales + saleMarker;
  if (targetIndex >= 0) sheet.getRange(targetIndex + 2, 1, 1, row.length).setValues([row]);
  else appendRows_(sheet, [row]);
}

function invoiceCostFromInventory_(invoice) {
  var table = readInventoryTable_();
  return (invoice.items || []).reduce(function (sum, line) {
    var index = findInventoryIndex_(table.rows, line.menu_item_id);
    var cost = index >= 0 ? asNumber_(table.rows[index][5]) : 0;
    return sum + cost * Math.max(0, asNumber_(line.quantity));
  }, 0);
}

function saleExists_(sheet, saleId, sessionId) {
  var cacheKey = "sale_" + hash_(saleId + "|" + sessionId);
  if (CacheService.getScriptCache().get(cacheKey)) return true;
  if (sheet.getLastRow() <= 1) return false;
  var match = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3)
    .createTextFinder(saleId)
    .matchEntireCell(true)
    .findNext();
  if (match) return true;
  if (!sessionId) return false;
  return Boolean(sheet.getRange(2, 3, sheet.getLastRow() - 1, 1)
    .createTextFinder(sessionId)
    .matchEntireCell(true)
    .findNext());
}

function hasValueInColumn_(sheet, value, column) {
  if (!value || sheet.getLastRow() <= 1) return false;
  return Boolean(sheet.getRange(2, column, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(value))
    .matchEntireCell(true)
    .findNext());
}

function appendRows_(sheet, rows) {
  if (!rows || !rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function appendAudit_(eventName, reference, user, status, detail) {
  var spreadsheet = getSpreadsheet_();
  appendRows_(spreadsheet.getSheetByName(APP.sheets.audit), [[
    new Date().toISOString(), safeText_(eventName), safeText_(reference), safeText_(user), safeText_(status), safeText_(detail)
  ]]);
}

function validateOrigin_(origin) {
  var allowed = getConfig_().allowedOrigins;
  if (!allowed.length) throw new Error("No hay origenes permitidos configurados.");
  if (allowed.indexOf(String(origin || "")) < 0) throw new Error("Origen no permitido.");
}

function validateSupabaseUser_(authToken) {
  var token = String(authToken || "").trim();
  if (!token) throw new Error("Sesion administrativa requerida.");
  var cache = CacheService.getScriptCache();
  var cacheKey = "user_" + hash_(token);
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  var config = getConfig_();
  if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error("Complete la configuracion de Supabase en la hoja Configuracion.");
  var user = validateSupabaseUserWithConfig_(token, config);
  cache.put(cacheKey, JSON.stringify(user), 120);
  return user;
}

function validateSupabaseUserWithConfig_(authToken, config) {
  var token = String(authToken || "").trim();
  if (!token) throw new Error("Sesion administrativa requerida.");
  var response = UrlFetchApp.fetch(config.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/get_current_user", {
    method: "post",
    contentType: "application/json",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: "Bearer " + config.supabaseAnonKey,
      "x-app-token": token
    },
    payload: JSON.stringify({ auth_token: token }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error("No fue posible validar la sesion con Supabase.");
  var user = JSON.parse(response.getContentText() || "null");
  if (!user || !user.id || user.is_active === false) throw new Error("Usuario no autorizado.");
  return user;
}

function requireAdmin_(user) {
  if (!user || user.role !== "admin") throw new Error("Esta operacion requiere un administrador.");
}

function getConfig_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("tn_config");
  if (cached) return JSON.parse(cached);
  var properties = PropertiesService.getScriptProperties();
  var config = {
    supabaseUrl: properties.getProperty(APP.properties.supabaseUrl) || "",
    supabaseAnonKey: properties.getProperty(APP.properties.supabaseAnonKey) || "",
    allowedOrigins: String(properties.getProperty(APP.properties.allowedOrigins) || "").split(",").map(function (origin) { return origin.trim(); }).filter(Boolean),
    timezone: properties.getProperty(APP.properties.timezone) || "America/Bogota"
  };
  cache.put("tn_config", JSON.stringify(config), 300);
  return config;
}

function isConfigured_() {
  var config = getConfig_();
  return Boolean(config.supabaseUrl && config.supabaseAnonKey && config.allowedOrigins.length);
}

function getTimezone_() {
  return getConfig_().timezone || "America/Bogota";
}

function withScriptLock_(callback) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error("El sistema esta procesando otra venta. Se reintentara automaticamente.");
  try { return callback(); } finally { lock.releaseLock(); }
}

function findInventoryIndex_(rows, productId) {
  var id = String(productId || "");
  for (var index = 0; index < rows.length; index += 1) {
    if (String(rows[index][0] || "") === id) return index;
  }
  return -1;
}

function safeText_(value) {
  var text = String(value == null ? "" : value).trim();
  if (/^[=+\-@]/.test(text)) return "'" + text;
  return text.slice(0, 500);
}

function asNumber_(value) {
  var number = Number(value || 0);
  return isFinite(number) ? number : 0;
}

function acronym_(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).map(function (word) { return word.charAt(0); }).join("").toUpperCase().slice(0, 12);
}

function hash_(value) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ""));
  return digest.slice(0, 12).map(function (byte) { return (byte + 256).toString(16).slice(-2); }).join("");
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
