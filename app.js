const SYNC_INTERVAL_MS = 30000;

const SUPABASE_CONFIG = {
  url: "https://izvcbkwgtciuoampunba.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6dmNia3dndGNpdW9hbXB1bmJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MzEzMzIsImV4cCI6MjEwMzAwNzMzMn0.cA7GCGeA-140TginBpEHPULKJrEDkpt3ixAMuAwzoPY"
};

const SupabaseDb = (() => {
  let authToken = "";
  let clientTableAccess = { table_id: "", code: "" };
  let client = null;
  const rpcNames = {
    getBootstrapData: "get_bootstrap_data",
    getAdminSnapshot: "get_admin_snapshot",
    getClientSnapshot: "get_client_snapshot",
    getClientTableState: "get_client_table_state",
    getCurrentUser: "get_current_user",
    listUsers: "list_users",
    saveUser: "save_user",
    acknowledgeServiceRequests: "acknowledge_service_requests",
    resolveBill: "resolve_bill",
    createServiceRequest: "create_service_request",
    createServiceRequestsBatch: "create_service_requests_batch"
  };

  const init = () => {
    if (client) return client;
    if (!window.supabase?.createClient) throw new Error("No se cargó el cliente de Supabase.");
    const authenticatedFetch = (input, options = {}) => {
      const headers = new Headers(options.headers || {});
      if (authToken) headers.set("x-app-token", authToken);
      if (clientTableAccess.table_id) headers.set("x-table-id", clientTableAccess.table_id);
      if (clientTableAccess.code) headers.set("x-table-code", clientTableAccess.code);
      return fetch(input, { ...options, headers });
    };
    client = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: authenticatedFetch }
    });
    return client;
  };

  return {
    init,
    from: (table) => init().from(table),
    rpc: (name, payload = {}) => init().rpc(rpcNames[name] || name, payload),
    setAuthToken: (token = "") => { authToken = token; },
    setTableAccess: (tableId = "", code = "") => { clientTableAccess = { table_id: tableId, code }; },
    storage: { from: (bucket) => init().storage.from(bucket) },
    channel: (...args) => init().channel(...args),
    removeChannel: (channel) => init().removeChannel(channel)
  };
})();

const App = (() => {
  const REQUEST_LABELS = {
    waiter: "Llamar mesero",
    bill: "Ver cuenta",
    other: "Necesito ayuda"
  };

  const REQUEST_ICONS = {
    waiter: "bell-ring",
    bill: "receipt-text",
    other: "message-circle-question"
  };

  const DEFAULT_CURRENCY = "COP";
  const REQUEST_IMAGES = {
    waiter: "images/mesero.png",
    bill: "images/check.png"
  };
  const RECEIPT_SOUND = "sound/receipt-received.mp3";
  const BAR_ASSISTANT_OPTIONS = [
    {
      name: "Canasta de cerveza",
      aliases: ["canasta cerveza", "canasta de cervezas", "canasta de birra"],
      detail: "Canasta de cerveza para compartir; el mesero confirma marcas y disponibilidad."
    },
    {
      name: "Ron Medellín",
      aliases: ["ron medellin", "medellin", "botella de ron medellin"],
      detail: "Ron Medellín; el mesero confirma la presentación disponible."
    },
    {
      name: "Aguardiente",
      aliases: ["guaro", "aguardiente antioqueno", "aguardiente antioqueño", "botella de aguardiente"],
      detail: "Aguardiente; el mesero confirma marca y presentación."
    },
    {
      name: "Whisky",
      aliases: ["whiskey", "botella de whisky", "media de whisky"],
      detail: "Whisky; el mesero confirma marcas y presentaciones disponibles."
    },
    {
      name: "Vodka",
      aliases: ["botella de vodka", "media de vodka"],
      detail: "Vodka; el mesero confirma marcas y presentaciones disponibles."
    },
    {
      name: "Tequila",
      aliases: ["botella de tequila", "shots de tequila", "shot de tequila"],
      detail: "Tequila por botella o por shots, sujeto a disponibilidad."
    },
    {
      name: "Cóctel",
      aliases: ["coctel", "cocteles", "cócteles", "trago preparado"],
      detail: "Cóctel preparado; el mesero comparte las opciones disponibles."
    },
    {
      name: "Cerveza individual",
      aliases: ["una cerveza", "cerveza", "cervezas", "birra"],
      detail: "Cerveza individual; el mesero confirma las marcas disponibles."
    },
    {
      name: "Bebida sin alcohol",
      aliases: ["gaseosa", "soda", "agua", "jugos", "bebida sin alcohol"],
      detail: "Agua, gaseosa u otra bebida sin alcohol, según disponibilidad."
    }
  ];
  const ASSISTANT_SYSTEM_PROMPT = [
    "Eres el agente virtual del bar y atiendes al cliente desde su mesa con tono amable, claro y profesional.",
    "Entiendes frases naturales para pedir bebidas y productos, ver la cuenta, llamar al mesero, consultar la carta o preguntar precios.",
    "Cuando reconoces un pedido, identificas el producto y la cantidad y avisas al mesero para que confirme los detalles.",
    "Si falta una mesa, no permites enviar pedidos ni solicitudes; primero pides verificar la mesa.",
    "No informas precios ni inventas presentaciones; el mesero confirma marcas, tamaños, disponibilidad y valores.",
    "Si no reconoces el producto exacto, envías igualmente la solicitud al equipo y se lo explicas al cliente.",
    "Siempre corriges ortografía, tildes, mayúsculas, puntos y comas en los mensajes que llegan al administrador.",
    "Trabajas con una guía interna de opciones de bar y no consultas el catálogo de productos de la base de datos."
  ].join("\n");

  const ASSISTANT_INTENTS = {
    help: [
      "en que me puedes ayudar",
      "como me puedes ayudar",
      "me puedes ayudar",
      "que puedes hacer",
      "que haces",
      "ayudame",
      "ayuda",
      "hola",
      "buenas"
    ],
    menu: [
      "menu",
      "carta",
      "opciones",
      "que tienen",
      "que venden",
      "que me recomiendas",
      "recomiendame",
      "recomendacion",
      "bebidas",
      "cervezas",
      "licores",
      "cocteles",
      "cócteles",
      "botellas",
      "tragos"
    ],
    order: [
      "quiero pedir",
      "quiero ordenar",
      "me gustaria pedir",
      "me gustaria ordenar",
      "voy a pedir",
      "voy a ordenar",
      "dame",
      "traeme",
      "agrega",
      "anota",
      "pideme",
      "ordenar"
    ],
    bill: [
      "cuenta",
      "factura",
      "recibo",
      "cobrar",
      "pagar",
      "la cuenta por favor"
    ],
    waiter: [
      "mesero",
      "mesera",
      "atiendan",
      "atender",
      "venga alguien",
      "llama a alguien",
      "necesito atencion"
    ],
    inquiry: [
      "que tiene",
      "ingredientes",
      "cuanto vale",
      "cuanto cuesta",
      "precio",
      "precios",
      "de que es",
      "como viene",
      "presentacion",
      "presentación",
      "cuantos ml"
    ]
  };

  const ASSISTANT_NUMBER_WORDS = {
    un: 1,
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10
  };
  const state = {
    sb: null,
    page: "",
    business: null,
    tables: [],
    categories: [],
    items: [],
    activeCategory: "all",
    currentTable: null,
    currentSession: null,
    sessionItems: [],
    clientRequests: [],
    tableAccountStatus: "idle",
    tableAccountTotal: 0,
    localBillOpen: false,
    clientHydrationToken: 0,
    billReceiptArmedIds: new Set(),
    requests: [],
    sessions: [],
    authToken: "",
    currentUser: null,
    users: [],
    alertFilter: "all",
    optimisticRequestStates: new Map(),
    optimisticSessionStates: new Map(),
    soundEnabled: false,
    soundPrimed: false,
    soundPriming: false,
    mousePrimeAttempted: false,
    lastAlertSignature: "",
    alertRenderSignature: null,
    accountsRenderSignature: null,
    adminSnapshotSignature: "",
    clientSnapshotSignature: "",
    visibleToastKeys: new Set(),
    toastLastShown: new Map(),
    alarmTimer: null,
    alarmStopTimer: null,
    adminPollTimer: null,
    adminSyncBusy: false,
    activeAdminSection: "dashboard",
    qrCache: new Map(),
    selectedTableQrIds: new Set(),
    tableRenderSignature: "",
    assistantMessages: [],
    tableLocked: false,
    qrLocked: false,
    clientChannel: null,
    clientPollTimer: null,
    clientSyncBusy: false,
    requestOutboxBusy: false,
    requestOutboxTimer: null,
    requestOutboxMemory: [],
    billResolutionBusy: false,
    billResolutionTimer: null,
    qrCameraStream: null,
    qrScanner: null,
    qrScannerControls: null,
    qrCameraDevices: [],
    qrScanBusy: false,
    subscriptions: []
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const icon = (name, size = 18) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;

  const money = (value, currency = DEFAULT_CURRENCY) =>
    new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 0
    }).format(Number(value || 0));

  const toast = (message, type = "ok", key = `${type}:${message}`) => {
    const now = Date.now();
    const cooldown = type === "error" ? 15000 : 3000;
    if (state.visibleToastKeys.has(key)) return;
    if (now - Number(state.toastLastShown.get(key) || 0) < cooldown) return;
    state.visibleToastKeys.add(key);
    state.toastLastShown.set(key, now);
    let box = $(".system-modal-stack");
    if (!box) {
      box = document.createElement("div");
      box.className = "system-modal-stack";
      document.body.appendChild(box);
    }
    const item = document.createElement("div");
    item.className = `system-modal ${type}`;
    const iconName = type === "error" ? "circle-alert" : "badge-check";
    item.innerHTML = `
      <div class="system-modal-icon">${icon(iconName, 24)}</div>
      <div>
        <strong>${type === "error" ? "Atencion" : "Listo"}</strong>
        <p>${message}</p>
      </div>
    `;
    box.appendChild(item);
    refreshIcons();
    setTimeout(() => {
      item.classList.add("leaving");
      setTimeout(() => {
        item.remove();
        state.visibleToastKeys.delete(key);
      }, 220);
    }, type === "error" ? 5600 : 3600);
  };

  const isConfigured = () => Boolean(
    window.supabase?.createClient &&
    SUPABASE_CONFIG.url &&
    SUPABASE_CONFIG.anonKey &&
    !SUPABASE_CONFIG.url.includes("TU_") &&
    !SUPABASE_CONFIG.anonKey.includes("TU_")
  );

  const uid = () =>
    crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const refreshIcons = () => {
    if (window.lucide) window.lucide.createIcons();
  };

  const setLoading = (isLoading) => {
    document.body.classList.toggle("is-loading", isLoading);
  };

  const connect = () => {
    if (!isConfigured()) {
      toast("Configura SUPABASE_CONFIG y verifica que cargue supabase-js.", "error");
      return false;
    }
    state.sb = SupabaseDb;
    state.sb.init();
    return true;
  };

  const db = async (builder, fallback = null) => {
    try {
      const { data, error } = await builder;
      if (error) throw error;
      return data;
    } catch (error) {
      console.error(error);
      const message = String(error?.message || "");
      const transient = error?.transient || /reintento de red|failed to fetch|networkerror|network request failed|load failed|aborterror|timeout/i.test(message);
      if (!transient) toast(message || "Error de Supabase", "error");
      return fallback;
    }
  };

  const loadBusiness = async () => {
    const data = await db(
      state.sb.from("business_settings").select("*").eq("is_primary", true).maybeSingle(),
      null
    );
    state.business = data || {
      business_name: "Tu restaurante",
      subtitle: "Servicio a la mesa rapido y claro",
      accent_color: "#f05a28",
      currency: DEFAULT_CURRENCY
    };
    document.documentElement.style.setProperty("--accent", state.business.accent_color || "#f05a28");
  };

  const loadCore = async () => {
    const [tables, categories, items] = await Promise.all([
      db(state.sb.from("restaurant_tables").select("*").order("table_number", { ascending: true }), []),
      db(state.sb.from("menu_categories").select("*").order("sort_order", { ascending: true }), []),
      db(
        state.sb
          .from("menu_items")
          .select("*, menu_categories(name)")
          .order("sort_order", { ascending: true }),
        []
      )
    ]);
    state.tables = tables || [];
    state.categories = categories || [];
    state.items = items || [];
  };

  const emptyState = (title, text, iconName = "sparkles") => `
    <div class="empty-state">
      ${icon(iconName, 26)}
      <strong>${title}</strong>
      <span>${text}</span>
    </div>
  `;

  const tableLabel = (table) => table?.table_name || `Mesa ${table?.table_number || ""}`.trim();

  const tableCode = (table) => table?.qr_code || `mesa-${table?.table_number || ""}`;

  const clientUrlForCode = (code) => {
    const url = new URL("index.html", window.FRONTEND_URL || location.href);
    url.search = "";
    url.searchParams.set("mesa", code);
    url.searchParams.set("page", "client");
    return url.href;
  };

  const qrTextForTable = (table) => clientUrlForCode(tableCode(table));

  const generateQrDataUrl = (text, size = 720) =>
    new Promise((resolve, reject) => {
      if (!window.QRCode) {
        reject(new Error("No se cargo el generador de QR."));
        return;
      }
      const host = document.createElement("div");
      host.style.position = "fixed";
      host.style.left = "-9999px";
      host.style.top = "0";
      document.body.appendChild(host);
      new window.QRCode(host, {
        text,
        width: size,
        height: size,
        colorDark: "#14171d",
        colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel.H
      });
      window.setTimeout(() => {
        const canvas = host.querySelector("canvas");
        const image = host.querySelector("img");
        const dataUrl = canvas?.toDataURL("image/png") || image?.src;
        host.remove();
        dataUrl ? resolve(dataUrl) : reject(new Error("No se pudo generar el QR."));
      }, 40);
    });

  const cachedQrDataUrl = async (text, size = 720) => {
    const key = `${size}:${text}`;
    if (!state.qrCache.has(key)) {
      state.qrCache.set(key, generateQrDataUrl(text, size));
    }
    return state.qrCache.get(key);
  };

  const renderQrImage = async (target, text, alt = "QR") => {
    if (!target || !text) return;
    if (target.dataset.qrText === text && target.querySelector("img")) return;
    target.dataset.qrText = text;
    target.classList.add("qr-loading");
    try {
      const dataUrl = await cachedQrDataUrl(text, 420);
      target.innerHTML = `<img src="${dataUrl}" alt="${alt}">`;
    } catch (error) {
      target.innerHTML = `${icon("qr-code", 20)}`;
    } finally {
      target.classList.remove("qr-loading");
      refreshIcons();
    }
  };

  const setRealtimeStatus = (status, tone = "connecting") => {
    const badge = $("#realtimeStatus");
    if (!badge) return;
    badge.className = `live-status ${tone}`;
    badge.innerHTML = `${icon(tone === "live" ? "wifi" : "wifi-off", 15)} ${status}`;
    refreshIcons();
  };

  const showAdminSection = (section = "dashboard") => {
    if (state.currentUser?.role === "waiter" && ["brand", "menu", "users"].includes(section)) section = "service";
    state.activeAdminSection = section;
    $$("[data-admin-section]").forEach((el) => {
      el.classList.toggle("section-active", el.dataset.adminSection === section);
    });
    $$(".admin-sidebar nav a").forEach((link) => {
      const target = link.getAttribute("href")?.replace("#", "");
      link.classList.toggle("active", target === section);
    });
    if (section === "dashboard") {
      renderAlerts();
      renderTables();
    }
    if (section === "accounts") renderAccounts();
    if (section === "menu") {
      renderTableManager();
      renderTableFormQr();
    }
    if (section === "users") renderUsers();
    refreshIcons();
  };

  const findTableFromUrl = () => {
    const params = new URLSearchParams(location.search);
    const raw = params.get("mesa") || params.get("table") || params.get("t") || params.get("qr");
    if (!raw) return null;
    const table = state.tables.find(
      (table) =>
        String(table.table_number) === String(raw) ||
        String(table.qr_code).toLowerCase() === String(raw).toLowerCase() ||
        String(table.id) === String(raw)
    );
    state.qrLocked = Boolean(table);
    state.tableLocked = state.qrLocked;
    return table;
  };

  const refreshTableLock = () => {
    if (!state.currentTable) return;
    const hasAccount = state.sessionItems.some(
      (item) => item.status !== "cancelled" && Number(item.quantity || 0) > 0
    );
    state.tableAccountStatus = hasAccount ? "active" : "empty";
    state.tableAccountTotal = state.sessionItems
      .filter((item) => item.status !== "cancelled")
      .reduce((total, item) => total + Number(item.unit_price || 0) * Number(item.quantity || 0), 0);
    if (!state.tableLocked) state.tableLocked = hasAccount;
    if (state.currentTable) renderTablePicker();
  };

  const ensureOpenSession = async (tableId) => {
    let session = await db(
      state.sb
        .from("table_sessions")
        .select("*")
        .eq("table_id", tableId)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      null
    );
    if (!session) {
      session = await db(
        state.sb.from("table_sessions").insert({ table_id: tableId, status: "open" }).select("*").single(),
        null
      );
    }
    if (state.currentSession?.id !== session?.id) state.clientSnapshotSignature = "";
    state.currentSession = session;
    return session;
  };

  const reconcilePendingBillsForTable = (requests = []) => {
    const queuedIds = new Set(readRequestOutbox().map((item) => item.request_id));
    pendingBillIds().forEach((id) => {
      const request = requests.find((item) => item.id === id);
      if (request?.status === "pending" || request?.status === "sending" || queuedIds.has(id)) {
        state.billReceiptArmedIds.add(id);
      } else if (!state.billReceiptArmedIds.has(id)) {
        clearPendingBill(id);
      }
    });
  };

  const hydrateSelectedTable = async (tableId) => {
    const table = state.currentTable;
    if (!table || table.id !== tableId) return null;
    const token = ++state.clientHydrationToken;
    state.tableAccountStatus = "checking";
    state.tableAccountTotal = 0;
    renderTablePicker();
    const snapshot = await dbQuiet(state.sb.rpc("getClientTableState", {
      table_id: table.id,
      table_access_code: tableCode(table),
      ensure_session: true
    }), null);
    if (token !== state.clientHydrationToken || state.currentTable?.id !== tableId) return null;
    if (snapshot?.session) {
      state.currentSession = snapshot.session;
      state.sessionItems = snapshot.sessionItems || [];
      state.clientRequests = snapshot.requests || [];
      state.clientSnapshotSignature = "";
    } else {
      const session = await ensureOpenSession(tableId);
      if (token !== state.clientHydrationToken || state.currentTable?.id !== tableId || !session) return null;
      await loadClientSnapshot();
    }
    reconcilePendingBillsForTable(state.clientRequests);
    refreshTableLock();
    renderAccount();
    renderBillChat();
    subscribeClient();
    return state.currentSession;
  };

  const loadClientSessionItems = async () => {
    if (!state.currentSession) return;
    state.sessionItems = await db(
      state.sb
        .from("session_items")
        .select("*")
        .eq("session_id", state.currentSession.id)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false }),
      []
    );
    refreshTableLock();
  };

  const loadClientRequests = async () => {
    if (!state.currentSession) {
      state.clientRequests = [];
      return;
    }
    state.clientRequests = await db(
      state.sb
        .from("service_requests")
        .select("*")
        .eq("session_id", state.currentSession.id)
        .order("created_at", { ascending: false }),
      []
    );
  };

  const dbQuiet = async (builder, fallback = null) => {
    try {
      const { data, error } = await builder;
      if (error) return fallback;
      return data;
    } catch (error) {
      return fallback;
    }
  };

  let bootstrapPromise = null;
  const bootstrapCacheKey = () => {
    const params = new URLSearchParams(location.search);
    const code = params.get("mesa") || params.get("table") || params.get("t") || params.get("qr") || "none";
    return `la_licorera_17_supabase_bootstrap_v2_${state.page}_${state.authToken ? "staff" : encodeURIComponent(code)}`;
  };

  const tableValueFromUrl = () => {
    const params = new URLSearchParams(location.search);
    return params.get("mesa") || params.get("table") || params.get("t") || params.get("qr") || "";
  };
  const persistBootstrapCache = () => {
    try {
      localStorage.setItem(bootstrapCacheKey(), JSON.stringify({
        business: state.business,
        tables: state.tables,
        categories: state.categories,
        items: state.items
      }));
    } catch (error) { /* cache opcional */ }
  };
  const loadBootstrap = async () => {
    if (bootstrapPromise) return bootstrapPromise;
    const applyBootstrap = (data) => {
      if (!data) return false;
      state.business = data.business || {
        business_name: "Tu restaurante",
        subtitle: "Servicio a la mesa rapido y claro",
        accent_color: "#f05a28",
        currency: DEFAULT_CURRENCY
      };
      state.tables = data.tables || [];
      state.categories = data.categories || [];
      state.items = data.items || [];
      document.documentElement.style.setProperty("--accent", state.business.accent_color || "#f05a28");
      return true;
    };
    let hasCachedBootstrap = false;
    try {
      hasCachedBootstrap = applyBootstrap(JSON.parse(localStorage.getItem(bootstrapCacheKey()) || "null"));
    } catch (error) {
      hasCachedBootstrap = false;
    }
    bootstrapPromise = (async () => {
      const params = new URLSearchParams(location.search);
      const accessCode = params.get("mesa") || params.get("table") || params.get("t") || params.get("qr") || "";
      const data = await dbQuiet(state.sb.rpc("getBootstrapData", {
        auth_token: state.authToken || "",
        table_access_code: accessCode
      }), null);
      if (data) {
        applyBootstrap(data);
        persistBootstrapCache();
      } else if (!hasCachedBootstrap) {
        await Promise.all([loadBusiness(), loadCore()]);
      }
      document.documentElement.style.setProperty("--accent", state.business.accent_color || "#f05a28");
      return true;
    })();
    // Con datos de la sesion anterior la interfaz no espera a la red.
    if (hasCachedBootstrap) {
      bootstrapPromise.then(() => {
        if (state.page === "client") {
          renderBrand();
          renderTablePicker();
          renderMenu();
        }
        if (state.page === "admin") {
          renderBrand();
          renderAdminShell();
          renderTableFormQr();
        }
      });
      return true;
    }
    return bootstrapPromise;
  };

  const loadClientSnapshot = async () => {
    if (!state.currentSession) return;
    const snapshot = await dbQuiet(
      state.sb.rpc("getClientSnapshot", {
        session_id: state.currentSession.id,
        table_id: state.currentTable?.id || null,
        table_access_code: tableCode(state.currentTable)
      }),
      null
    );
    if (!snapshot) {
      await Promise.all([loadClientSessionItems(), loadClientRequests()]);
      return true;
    }
    const signature = JSON.stringify([
      (snapshot.sessionItems || []).map((item) => [item.id, item.status, item.quantity, item.updated_at]),
      (snapshot.requests || []).map((request) => [request.id, request.status, request.updated_at])
    ]);
    if (signature === state.clientSnapshotSignature) return false;
    state.clientSnapshotSignature = signature;
    state.sessionItems = snapshot.sessionItems || [];
    state.clientRequests = snapshot.requests || [];
    refreshTableLock();
    return true;
  };

  const renderBrand = () => {
    const logo = state.business?.logo_url
      ? `<img src="${escapeHTML(state.business.logo_url)}" alt="${escapeHTML(state.business.business_name)}" class="brand-logo">`
      : `<div class="brand-mark">${icon("utensils", 24)}</div>`;
    $$(".js-business-name").forEach((el) => {
      el.textContent = state.business?.business_name || "Tu restaurante";
    });
    $$(".js-business-subtitle").forEach((el) => {
      el.textContent = state.business?.subtitle || "Servicio a la mesa rapido y claro";
    });
    $$(".js-brand-logo").forEach((el) => {
      el.innerHTML = logo;
    });
    const cover = $(".client-hero");
    if (cover && state.business?.cover_url) {
      cover.style.backgroundImage = `linear-gradient(180deg, rgba(12,13,17,.40), rgba(12,13,17,.88)), url('${state.business.cover_url}')`;
    }
  };

  const renderTablePicker = () => {
    const picker = $("#tablePicker");
    if (!picker) return;
    if (state.currentTable) {
      const accountStatus = state.tableAccountStatus === "checking"
        ? `<small class="table-account-state checking">${icon("loader-circle", 14)} Consultando cuenta</small>`
        : state.tableAccountStatus === "active"
          ? `<small class="table-account-state active">${icon("receipt-text", 14)} Cuenta activa · ${money(state.tableAccountTotal)}</small>`
          : `<small class="table-account-state empty">${icon("circle-check", 14)} Sin cuenta</small>`;
      picker.innerHTML = `
        <div class="selected-table-state">
          <strong class="selected-table-name">${icon("map-pin", 16)} ${escapeHTML(tableLabel(state.currentTable))}</strong>
          ${accountStatus}
        </div>
        ${
          state.tableLocked
            ? `<strong class="locked-table-badge">${icon("lock-keyhole", 14)} ${state.qrLocked ? "QR verificado" : "Cuenta activa"}</strong>`
            : `<button class="ghost small" data-action="change-table">${icon("refresh-cw", 15)} Cambiar</button>`
        }
      `;
      refreshIcons();
      return;
    }
    picker.innerHTML = `
      <label for="tableSelect">Selecciona tu mesa</label>
      <select id="tableSelect">
        <option value="">Mesa</option>
        ${state.tables
          .filter((table) => table.is_active)
          .map((table) => `<option value="${escapeHTML(table.id)}">${escapeHTML(tableLabel(table))}</option>`)
          .join("")}
      </select>
    `;
    refreshIcons();
  };

  const filteredItems = () =>
    state.items.filter(
      (item) =>
        item.is_available &&
        (state.activeCategory === "all" || item.category_id === state.activeCategory)
    );

  const renderMenu = () => {
    const tabs = $("#categoryTabs");
    const menu = $("#menuList");
    if (!tabs || !menu) return;

    tabs.innerHTML = `
      <button class="chip ${state.activeCategory === "all" ? "active" : ""}" data-category="all">
        ${icon("layout-grid", 16)} Todo
      </button>
      ${state.categories
        .filter((category) => category.is_active)
        .map(
          (category) => `
            <button class="chip ${state.activeCategory === category.id ? "active" : ""}" data-category="${category.id}">
              ${icon("tag", 16)} ${escapeHTML(category.name)}
            </button>
          `
        )
        .join("")}
    `;

    const items = filteredItems();
    menu.innerHTML = items.length
      ? items
          .map(
            (item) => `
              <article class="menu-item">
                <div class="food-image">
                  ${
                    item.image_url
                      ? `<img src="${escapeHTML(item.image_url)}" alt="${escapeHTML(item.name)}">`
                      : icon("chef-hat", 26)
                  }
                </div>
                <div class="menu-copy">
                  <div>
                    <span class="category-name">${escapeHTML(item.menu_categories?.name || "Menu")}</span>
                    <h3>${escapeHTML(item.name)}</h3>
                    <p>${escapeHTML(item.description || "Preparado por la casa.")}</p>
                  </div>
                  <div class="menu-actions">
                    <strong>${money(item.price)}</strong>
                    <button class="icon-btn" data-add-item="${escapeHTML(item.id)}" aria-label="Agregar ${escapeHTML(item.name)}">
                      ${icon("plus", 18)}
                    </button>
                  </div>
                </div>
              </article>
            `
          )
          .join("")
      : emptyState("Menu en preparacion", "Agrega productos desde el administrador.", "book-open");
    refreshIcons();
  };

  const renderAccount = () => {
    const box = $("#clientAccount");
    if (!box) return;
    const subtotal = state.sessionItems.reduce(
      (sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
      0
    );
    box.innerHTML = state.sessionItems.length
      ? `
        <div class="account-head">
          <span>${icon("receipt", 18)} Cuenta actual</span>
          <strong>${money(subtotal)}</strong>
        </div>
        <div class="account-list">
          ${state.sessionItems
            .map(
              (item) => `
                <div class="account-row">
                  <span>${Number(item.quantity || 0)}x ${escapeHTML(item.item_name)}</span>
                  <strong>${money(Number(item.unit_price) * Number(item.quantity))}</strong>
                </div>
              `
            )
            .join("")}
        </div>
      `
      : emptyState("Sin consumos", "Agrega platos o llama al mesero para ordenar.", "shopping-bag");
    refreshIcons();
  };

  const receiptItemsForSession = (session) =>
    (session?.session_items || [])
      .filter((item) => item.status !== "cancelled")
      .map((item) => ({
        name: item.item_name,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        total: Number(item.unit_price || 0) * Number(item.quantity || 0),
        registered_by: item.created_by_user?.full_name || "Cliente",
        registered_at: item.created_at || null
      }));

  const buildBillMessage = (session) => {
    const items = receiptItemsForSession(session);
    const totals = sessionTotals(session);
    return JSON.stringify({
      kind: "bill_receipt",
      sent_at: new Date().toISOString(),
      business_name: state.business?.business_name || "Tu restaurante",
      table: tableLabel(session?.restaurant_tables),
      payer_name: session?.payer_name || "",
      waiter_name: session?.assigned_waiter?.full_name || "",
      currency: DEFAULT_CURRENCY,
      items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      service_fee: totals.serviceFee,
      total: totals.total
    });
  };

  const retryQuiet = async (factory, attempts = 4) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await dbQuiet(factory(), null);
      if (result) return result;
      if (attempt < attempts - 1) {
        const delay = Math.min(5000, 350 * Math.pow(2, attempt));
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    }
    return null;
  };

  const parseBillMessage = (message) => {
    try {
      const parsed = JSON.parse(message || "{}");
      if (parsed.kind === "bill_receipt") return parsed;
    } catch (error) {
      return null;
    }
    return null;
  };

  const billTicketId = (request) => `#${String(request?.id || "").slice(0, 8).toUpperCase()}`;

  const billRequestStorageKey = (tableId = state.currentTable?.id) =>
    tableId ? `la_licorera_17_pending_bills_${tableId}` : "";

  const pendingBillIds = () => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(billRequestStorageKey()) || "[]");
      return Array.isArray(stored) ? stored : [];
    } catch (error) {
      return [];
    }
  };

  const rememberPendingBill = (requestOrId) => {
    const id = typeof requestOrId === "string" ? requestOrId : requestOrId?.id;
    if (!id || !state.currentTable?.id) return;
    state.billReceiptArmedIds.add(id);
    try {
      sessionStorage.setItem(billRequestStorageKey(), JSON.stringify([...new Set([...pendingBillIds(), id])].slice(-20)));
    } catch (error) { /* almacenamiento opcional */ }
  };

  const clearPendingBill = (requestId) => {
    state.billReceiptArmedIds.delete(requestId);
    try {
      const remaining = pendingBillIds().filter((id) => id !== requestId);
      sessionStorage.setItem(billRequestStorageKey(), JSON.stringify(remaining));
    } catch (error) { /* almacenamiento opcional */ }
  };

  const BILL_RESOLUTION_OUTBOX_KEY = "la_licorera_17_bill_resolution_outbox_v1";

  const readBillResolutionOutbox = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(BILL_RESOLUTION_OUTBOX_KEY) || "[]");
      return Array.isArray(stored) ? stored : [];
    } catch (error) {
      return [];
    }
  };

  const writeBillResolutionOutbox = (items) => {
    try { localStorage.setItem(BILL_RESOLUTION_OUTBOX_KEY, JSON.stringify(items.slice(-100))); } catch (error) { /* cache opcional */ }
  };

  const queueBillResolution = (requestId) => {
    if (!requestId || !state.currentTable?.id) return;
    const outbox = readBillResolutionOutbox();
    if (!outbox.some((item) => item.request_id === requestId)) {
      outbox.push({
        request_id: requestId,
        table_id: state.currentTable.id,
        table_access_code: tableCode(state.currentTable),
        attempts: 0,
        next_attempt_at: 0
      });
      writeBillResolutionOutbox(outbox);
    }
    window.clearTimeout(state.billResolutionTimer);
    state.billResolutionTimer = window.setTimeout(flushBillResolutionOutbox, 40);
  };

  const flushBillResolutionOutbox = async () => {
    if (state.billResolutionBusy || !navigator.onLine || !state.sb) return;
    const now = Date.now();
    const outbox = readBillResolutionOutbox();
    const event = outbox.find((item) => Number(item.next_attempt_at || 0) <= now);
    if (!event) {
      const next = outbox.reduce((time, item) => Math.min(time, Number(item.next_attempt_at || Infinity)), Infinity);
      if (Number.isFinite(next)) state.billResolutionTimer = window.setTimeout(flushBillResolutionOutbox, Math.max(250, next - now));
      return;
    }
    state.billResolutionBusy = true;
    try {
      let saved = await dbQuiet(state.sb.rpc("resolveBill", event), null);
      if (!saved && state.currentTable?.id === event.table_id) {
        saved = await dbQuiet(
          state.sb.from("service_requests")
            .update({ status: "resolved", resolved_at: new Date().toISOString() })
            .eq("id", event.request_id)
            .select("*")
            .single(),
          null
        );
      }
      const nextOutbox = readBillResolutionOutbox().flatMap((item) => {
        if (item.request_id !== event.request_id) return [item];
        if (saved) return [];
        const attempts = Number(item.attempts || 0) + 1;
        return [{ ...item, attempts, next_attempt_at: Date.now() + Math.min(30000, 500 * Math.pow(2, Math.min(attempts, 6))) }];
      });
      writeBillResolutionOutbox(nextOutbox);
    } finally {
      state.billResolutionBusy = false;
      if (readBillResolutionOutbox().length) {
        window.clearTimeout(state.billResolutionTimer);
        state.billResolutionTimer = window.setTimeout(flushBillResolutionOutbox, 350);
      }
    }
  };

  const billDateParts = (value) => {
    const date = new Date(value || Date.now());
    return {
      date: date.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }).replace(".", ""),
      time: date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    };
  };

  const playReceiptSound = async (requestId) => {
    if (!requestId || localStorage.getItem(`receipt_sound_${requestId}`) === "1") return;
    const audio = new Audio(RECEIPT_SOUND);
    audio.volume = 1;
    try {
      await audio.play();
      localStorage.setItem(`receipt_sound_${requestId}`, "1");
    } catch (error) {
      // Browsers can block audio until the client interacts with the page.
    }
  };

  const latestClientBill = () =>
    state.clientRequests.find(
      (request) =>
        request.request_type === "bill" &&
        request.status === "acknowledged" &&
        state.billReceiptArmedIds.has(request.id) &&
        pendingBillIds().includes(request.id) &&
        request.session_id === state.currentSession?.id &&
        request.table_id === state.currentTable?.id &&
        parseBillMessage(request.message)
    );

  const renderBillChat = () => {
    const box = $("#billChat");
    if (!box) return;
    if (box.classList.contains("is-closing")) return;
    const isLocalBill = state.localBillOpen && Boolean(state.currentTable);
    const localSession = isLocalBill ? {
      ...(state.currentSession || {}),
      id: state.currentSession?.id || state.currentTable.id,
      restaurant_tables: state.currentTable,
      session_items: state.sessionItems
    } : null;
    const request = isLocalBill
      ? {
          id: localSession.id,
          status: "current",
          created_at: new Date().toISOString(),
          table_id: state.currentTable.id,
          session_id: state.currentSession?.id || null
        }
      : latestClientBill();
    const bill = isLocalBill
      ? parseBillMessage(buildBillMessage(localSession))
      : parseBillMessage(request?.message);
    if (!request || !bill) {
      document.body.classList.remove("receipt-open");
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    if (!isLocalBill) playReceiptSound(request.id);
    const sent = billDateParts(bill.sent_at || request.acknowledged_at || request.created_at);
    box.hidden = false;
    box.classList.remove("is-closing");
    document.body.classList.add("receipt-open");
    box.innerHTML = `
      <div class="client-receipt-overlay" role="presentation">
        <article class="client-receipt-ticket" role="dialog" aria-modal="true" aria-label="${isLocalBill ? "Cuenta actual" : "Cuenta enviada"}" data-receipt-id="${escapeHTML(request.id)}">
          <div class="receipt-confetti">✓</div>
          <h2>${isLocalBill ? "Tu cuenta" : request.status === "resolved" ? "Gracias" : "Cuenta lista"}</h2>
          <p>${isLocalBill ? `Consumos registrados actualmente en ${escapeHTML(tableLabel(state.currentTable))}.` : request.status === "resolved" ? "Tu confirmación fue recibida correctamente." : "El equipo envió el recibo de tu mesa."}</p>

          <div class="receipt-dash"></div>

          <div class="receipt-ticket-grid">
            <div>
              <span>Ticket ID</span>
              <strong>${billTicketId(request)}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>${money(bill.total, bill.currency)}</strong>
            </div>
            <div>
              <span>Fecha y hora</span>
              <strong>${sent.date} | ${sent.time}</strong>
            </div>
            <div>
              <span>Mesa</span>
              <strong>${escapeHTML(bill.table || tableLabel(state.currentTable))}</strong>
            </div>
            ${bill.payer_name ? `<div><span>Responsable</span><strong>${escapeHTML(bill.payer_name)}</strong></div>` : ""}
            ${bill.waiter_name ? `<div><span>Atendido por</span><strong>${escapeHTML(bill.waiter_name)}</strong></div>` : ""}
          </div>

          <div class="receipt-method">
            <span>${icon("beer", 20)}</span>
            <div>
              <strong>${escapeHTML(bill.business_name || "Restaurante")}</strong>
              <small>${isLocalBill ? "Cuenta actualizada de tu mesa" : "Recibo enviado por administración"}</small>
            </div>
          </div>

          <div class="receipt-lines client-ticket-lines">
            ${(bill.items || [])
              .map(
                (item) => `
                  <div>
                    <span>${Number(item.quantity || 0)}x ${escapeHTML(item.name)}</span>
                    <strong>${money(item.total, bill.currency)}</strong>
                  </div>
                `
              )
              .join("") || "<small>Sin consumos registrados</small>"}
            <div><span>Subtotal</span><strong>${money(bill.subtotal, bill.currency)}</strong></div>
            ${Number(bill.discount || 0) ? `<div><span>Descuento</span><strong>-${money(bill.discount, bill.currency)}</strong></div>` : ""}
            ${Number(bill.tax || 0) ? `<div><span>Impuestos</span><strong>${money(bill.tax, bill.currency)}</strong></div>` : ""}
            ${Number(bill.service_fee || 0) ? `<div><span>Servicio</span><strong>${money(bill.service_fee, bill.currency)}</strong></div>` : ""}
          </div>

          <div class="receipt-barcode" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span><span></span>
            <small>${String(request.id || "").replace(/-/g, "").slice(0, 22)}</small>
          </div>

          ${
            isLocalBill
              ? `<button class="primary thank-btn receipt-thanks" data-close-bill>${icon("x", 16)} Cerrar</button>`
              : request.status === "resolved"
                ? `<div class="receipt-confirmed">${icon("badge-check", 17)} Confirmado</div>`
                : `<button class="primary thank-btn receipt-thanks" data-thank-bill="${request.id}">${icon("send", 16)} Gracias</button>`
          }
          <div class="receipt-cutout-row" aria-hidden="true"></div>
        </article>
      </div>
    `;
    refreshIcons();
    window.requestAnimationFrame(() => box.querySelector(".receipt-thanks")?.focus({ preventScroll: true }));
  };

  const showCurrentBill = async () => {
    if (!state.currentTable) {
      toast("Selecciona tu mesa primero.", "error");
      return;
    }
    const button = document.querySelector('[data-request="bill"]');
    button?.classList.add("is-pending");
    try {
      await hydrateSelectedTable(state.currentTable.id);
      state.localBillOpen = true;
      renderBillChat();
    } finally {
      button?.classList.remove("is-pending");
    }
  };

  const normalizeText = (text = "") =>
    String(text)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const escapeHTML = (value = "") =>
    String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));

  const includesAny = (normalized, phrases = []) =>
    phrases.some((phrase) => normalized.includes(normalizeText(phrase)));

  const assistantUnderstands = (normalized, intent) =>
    includesAny(normalized, ASSISTANT_INTENTS[intent] || []);

  const sentenceCase = (text = "") => {
    const clean = String(text).trim().replace(/\s+/g, " ");
    if (!clean) return "";
    const sentence = clean.charAt(0).toUpperCase() + clean.slice(1);
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  };

  const polishGuestText = (text = "") => {
    const replacements = [
      [/\bcoctel(es)?\b/gi, (match) => match.toLowerCase().endsWith("es") ? "cócteles" : "cóctel"],
      [/\bcerbeza(s)?\b/gi, (match) => match.toLowerCase().endsWith("s") ? "cervezas" : "cerveza"],
      [/\bwhiskey\b/gi, "whisky"],
      [/\bmenu\b/gi, "menú"],
      [/\bpor favor\b/gi, "por favor"],
      [/\bq\b/gi, "que"],
      [/\bxfa\b/gi, "por favor"]
    ];
    const polished = replacements.reduce(
      (value, [pattern, replacement]) => value.replace(pattern, replacement),
      String(text).trim().replace(/\s+/g, " ")
    );
    return sentenceCase(polished);
  };

  const assistantMenuSummary = () => {
    const names = assistantOptions().slice(0, 6).map((item) => item.name);
    return names.join(", ");
  };

  const findQuantityWord = (normalized) => {
    const words = normalized.split(" ");
    const found = words.find((word) => ASSISTANT_NUMBER_WORDS[word]);
    return found ? ASSISTANT_NUMBER_WORDS[found] : null;
  };

  const assistantOptions = () => BAR_ASSISTANT_OPTIONS;

  const findAssistantItem = (message) => {
    const normalized = normalizeText(message);
    let best = null;
    assistantOptions().forEach((item) => {
      [item.name, ...(item.aliases || [])].forEach((candidate) => {
        const normalizedCandidate = normalizeText(candidate);
        const words = normalizedCandidate.split(" ").filter((word) => word.length > 2);
        const overlap = words.reduce((sum, word) => sum + (normalized.includes(word) ? 1 : 0), 0) / Math.max(words.length, 1);
        const score = normalized.includes(normalizedCandidate) ? 1 + words.length / 100 : overlap;
        if (score >= .6 && (!best || score > best.score)) best = { item, score };
      });
    });
    return best?.item || null;
  };

  const parseAssistantOrder = (message) => {
    const item = findAssistantItem(message);
    if (!item) return null;
    const normalized = normalizeText(message);
    const numericQuantity = [...normalized.matchAll(/\b(\d+)\b/g)]
      .map((match) => Number(match[1]))
      .find((value) => value >= 1 && value <= 20);
    const quantity = Math.max(1, Number(numericQuantity || findQuantityWord(normalized) || 1));
    return { item, quantity };
  };

  const assistantSay = (role, text) => {
    state.assistantMessages.push({ role, text });
    state.assistantMessages = state.assistantMessages.slice(-16);
    renderAssistant();
  };

  const renderAssistant = () => {
    const chat = $("#assistantChat");
    const suggestions = $("#assistantSuggestions");
    if (!chat || !suggestions) return;
    const messages = state.assistantMessages.length
      ? state.assistantMessages
      : [{ role: "bot", text: "Hola, soy tu agente de bar. Dime qué deseas pedir y enviaré la solicitud al mesero para que confirme contigo los detalles." }];
    chat.innerHTML = messages
      .map((message) => `<div class="assistant-message ${message.role}">${escapeHTML(message.text)}</div>`)
      .join("");
    chat.scrollTop = chat.scrollHeight;
    const productSuggestions = assistantOptions().slice(0, 2).map((item) => `Quiero ${item.name}`);
    const suggestionTexts = [...productSuggestions, "Ver mi cuenta", "Llamar al mesero"].slice(0, 3);
    suggestions.innerHTML = suggestionTexts
      .map((text) => `<button type="button" class="chip" data-assistant-suggest="${escapeHTML(text)}">${escapeHTML(text)}</button>`)
      .join("");
    refreshIcons();
  };

  const prettyDateTime = (value) => new Date(value || Date.now()).toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).replace(".", "");

  const REQUEST_OUTBOX_KEY = "la_licorera_17_request_outbox_v2";

  const readRequestOutbox = () => {
    try {
      const value = JSON.parse(localStorage.getItem(REQUEST_OUTBOX_KEY) || "[]");
      const stored = Array.isArray(value) ? value : [];
      const merged = new Map([...state.requestOutboxMemory, ...stored].map((item) => [item.request_id, item]));
      return Array.from(merged.values()).filter((item) => item.request_type !== "bill");
    } catch (error) {
      return state.requestOutboxMemory.filter((item) => item.request_type !== "bill");
    }
  };

  const writeRequestOutbox = (items) => {
    state.requestOutboxMemory = items.slice(-5000);
    try {
      localStorage.setItem(REQUEST_OUTBOX_KEY, JSON.stringify(state.requestOutboxMemory));
    } catch (error) {
      // La UI permanece operativa; el intento en memoria sigue ejecutandose.
    }
  };

  const queueServiceRequest = (event) => {
    const outbox = readRequestOutbox();
    if (!outbox.some((item) => item.request_id === event.request_id)) {
      outbox.push({ ...event, attempts: 0, next_attempt_at: 0 });
      writeRequestOutbox(outbox);
    }
    window.clearTimeout(state.requestOutboxTimer);
    state.requestOutboxTimer = window.setTimeout(flushRequestOutbox, 70);
  };

  const flushRequestOutbox = async () => {
    if (state.requestOutboxBusy || !navigator.onLine) return;
    const now = Date.now();
    const outbox = readRequestOutbox();
    const due = outbox.filter((item) => Number(item.next_attempt_at || 0) <= now).slice(0, 30);
    if (!due.length) {
      const next = outbox.reduce((time, item) => Math.min(time, Number(item.next_attempt_at || Infinity)), Infinity);
      if (Number.isFinite(next)) {
        window.clearTimeout(state.requestOutboxTimer);
        state.requestOutboxTimer = window.setTimeout(flushRequestOutbox, Math.max(250, next - now));
      }
      return;
    }

    state.requestOutboxBusy = true;
    let results = null;
    try {
      const batch = await dbQuiet(
        state.sb.rpc("createServiceRequestsBatch", {
          requests: due.map(({ attempts, next_attempt_at, ...event }) => event)
        }),
        null
      );
      results = batch?.results || null;

      // Compatibilidad mientras se publica el backend por lotes.
      if (!results) {
        results = await Promise.all(due.map(async (item) => {
          let result = await dbQuiet(state.sb.rpc("createServiceRequest", item), null);
          if (result?.duplicate && result.request?.id !== item.request_id) result = null;
          if (result) return result;
          const request = await dbQuiet(
            state.sb.from("service_requests").insert({
              id: item.request_id,
              table_id: item.table_id,
              session_id: item.session_id || null,
              request_type: item.request_type,
              message: item.message || ""
            }).select("*").single(),
            null
          );
          return request ? { request, duplicate: false } : null;
        }));
      }

      const succeeded = new Set();
      (results || []).forEach((result, index) => {
        const queued = due[index];
        const request = result?.request || result;
        if (!queued || !request) return;
        succeeded.add(queued.request_id);
        state.clientRequests = [request, ...state.clientRequests.filter((item) => item.id !== queued.request_id && item.id !== request.id)];
      });

      const dueIds = new Set(due.map((item) => item.request_id));
      const nextOutbox = readRequestOutbox().flatMap((item) => {
        if (!dueIds.has(item.request_id)) return [item];
        if (succeeded.has(item.request_id)) return [];
        const attempts = Number(item.attempts || 0) + 1;
        const delay = Math.min(30000, 500 * Math.pow(2, Math.min(attempts, 6)));
        return [{ ...item, attempts, next_attempt_at: Date.now() + delay }];
      });
      writeRequestOutbox(nextOutbox);
      renderBillChat();
    } finally {
      state.requestOutboxBusy = false;
      if (readRequestOutbox().length) {
        window.clearTimeout(state.requestOutboxTimer);
        state.requestOutboxTimer = window.setTimeout(flushRequestOutbox, 350);
      }
    }
  };

  const createServiceNotification = async (type, message) => {
    if (!state.currentTable) return null;
    const requestId = uid();
    const tableId = state.currentTable.id;
    const sessionId = state.currentSession?.id || null;
    const request = {
      id: requestId,
      request_id: requestId,
      table_id: tableId,
      session_id: sessionId,
      request_type: type,
      table_access_code: tableCode(state.currentTable),
      message,
      status: "sending",
      created_at: new Date().toISOString()
    };
    state.clientRequests = [request, ...state.clientRequests];
    queueServiceRequest({
      request_id: requestId,
      table_id: tableId,
      session_id: sessionId,
      request_type: type,
      table_access_code: tableCode(state.currentTable),
      message
    });
    return request;
  };

  const describeAssistantItem = (item) =>
    `${item.name}: ${item.detail}`;

  const addAssistantOrder = async (order, originalMessage) => {
    if (!state.currentTable) {
      assistantSay("bot", "Primero selecciona tu mesa para poder enviar el pedido correctamente.");
      return;
    }
    await ensureOpenSession(state.currentTable.id);
    const request = await createServiceNotification(
      "other",
      `${tableLabel(state.currentTable)} solicita atención para pedir ${order.quantity} x ${order.item.name}. Mensaje del cliente: ${polishGuestText(originalMessage)}`
    );
    if (request) {
      assistantSay("bot", `Perfecto. Ya envié tu solicitud de ${order.quantity} x ${order.item.name}. El mesero te atenderá para confirmar los detalles.`);
    }
  };

  const handleAssistantMessage = async (message) => {
    const text = message.trim();
    if (!text) return;
    assistantSay("user", text);
    const normalized = normalizeText(text);
    const item = findAssistantItem(text);
    const asksCapabilities = includesAny(normalized, [
      "en que me puedes ayudar",
      "como me puedes ayudar",
      "me puedes ayudar",
      "que puedes hacer",
      "que haces",
      "hola",
      "buenas"
    ]) || normalized === "ayuda";
    const asksMenu = assistantUnderstands(normalized, "menu");
    const asksInquiry = assistantUnderstands(normalized, "inquiry");
    const asksBill = assistantUnderstands(normalized, "bill");
    const asksWaiter = assistantUnderstands(normalized, "waiter");
    const wantsOrder = assistantUnderstands(normalized, "order") || Boolean(item && !asksInquiry);

    if (asksCapabilities && !wantsOrder && !asksMenu && !asksBill && !asksWaiter) {
      assistantSay("bot", "Soy tu agente de bar. Puedes pedirme una canasta de cerveza, Ron Medellín, aguardiente, whisky, vodka, tequila, cócteles u otras bebidas. Enviaré tu solicitud al mesero para que confirme los detalles.");
      return;
    }
    if (asksMenu && !item) {
      const summary = assistantMenuSummary();
      assistantSay("bot", summary
        ? `Puedo ayudarte con opciones como ${summary}. Dime cuál deseas y la cantidad; el mesero confirmará los detalles.`
        : "Dime qué deseas pedir y enviaré la solicitud al mesero.");
      return;
    }
    const genericOrderRequest = ["quiero pedir", "quiero ordenar", "voy a pedir", "voy a ordenar"]
      .includes(normalized);
    if (wantsOrder && !item && genericOrderRequest) {
      const summary = assistantMenuSummary();
      assistantSay("bot", summary
        ? `Claro. Puedes pedir opciones como ${summary}. Escríbeme el nombre exacto de la bebida o producto y la cantidad.`
        : "Dime el nombre de la bebida o producto que deseas y lo enviaré al equipo para confirmación.");
      return;
    }
    if (item && (asksInquiry || asksMenu) && !assistantUnderstands(normalized, "order")) {
      assistantSay("bot", describeAssistantItem(item));
      return;
    }
    if (!state.currentTable) {
      assistantSay("bot", "Primero selecciona tu mesa arriba para poder enviar pedidos o avisos correctamente.");
      return;
    }
    if (asksBill) {
      await showCurrentBill();
      assistantSay("bot", "Te mostré la cuenta actual de tu mesa. Puedes consultarla nuevamente cuando quieras.");
      return;
    }
    if (asksWaiter) {
      void createRequest("waiter");
      assistantSay("bot", "Ya llamamos al mesero. Te atenderán en breve.");
      return;
    }
    const order = parseAssistantOrder(text);
    if (order) {
      assistantSay("bot", "Recibido. Estoy registrando el pedido para tu mesa.");
      void addAssistantOrder(order, text);
      return;
    }
    assistantSay("bot", "Entendido. Ya envié tu solicitud para que el mesero te atienda y confirme los detalles.");
    void createServiceNotification("other", `${tableLabel(state.currentTable)} solicita atención: ${polishGuestText(text)}`);
  };

  const addItemToSession = async (itemId) => {
    if (!state.currentTable) {
      toast("Selecciona tu mesa primero.", "error");
      return;
    }
    const session = await ensureOpenSession(state.currentTable.id);
    if (!session) return;
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return;
    const payload = {
      session_id: session.id,
      table_id: state.currentTable.id,
      menu_item_id: item.id,
      item_name: item.name,
      quantity: 1,
      unit_price: item.price,
      status: "pending"
    };
    const saved = await db(state.sb.from("session_items").insert(payload).select("*").single(), null);
    if (saved) {
      toast(`${item.name} agregado a la cuenta.`);
      await loadClientSessionItems();
      renderAccount();
    }
  };

  const createRequest = (type, message = "") => {
    if (type === "bill") return showCurrentBill();
    if (!state.currentTable) {
      toast("Selecciona tu mesa primero.", "error");
      return null;
    }
    const requestId = uid();
    const tableId = state.currentTable.id;
    const sessionId = state.currentSession?.id || null;
    const now = new Date().toISOString();
    const optimisticRequest = {
      id: requestId,
      table_id: tableId,
      session_id: sessionId,
      request_type: type,
      message,
      status: "sending",
      created_at: now,
      updated_at: now
    };
    state.clientRequests = [optimisticRequest, ...state.clientRequests];
    if (type === "bill") rememberPendingBill(requestId);

    const button = document.querySelector(`[data-request="${type}"]`);
    if (button) {
      button.classList.add("is-pending");
      window.setTimeout(() => button.classList.remove("is-pending"), 260);
    }
    toast(`${REQUEST_LABELS[type]} enviada. El equipo la recibira en segundos.`, "ok", `request-sent:${type}`);
    queueServiceRequest({
      request_id: requestId,
      table_id: tableId,
      session_id: sessionId,
      request_type: type,
      table_access_code: tableCode(state.currentTable),
      message
    });
    return optimisticRequest;
  };

  const thankBill = (id) => {
    const box = $("#billChat");
    if (!id || box?.classList.contains("is-closing")) return;
    clearPendingBill(id);
    state.clientRequests = state.clientRequests.map((request) => request.id === id
      ? { ...request, status: "resolved", resolved_at: new Date().toISOString() }
      : request);
    queueBillResolution(id);
    box?.classList.add("is-closing");
    window.setTimeout(() => {
      if (!box) return;
      box.hidden = true;
      box.innerHTML = "";
      box.classList.remove("is-closing");
      document.body.classList.remove("receipt-open");
      document.querySelector('[data-request="bill"]')?.focus({ preventScroll: true });
    }, 320);
  };

  const closeCurrentBill = () => {
    const box = $("#billChat");
    if (!state.localBillOpen || box?.classList.contains("is-closing")) return;
    state.localBillOpen = false;
    box?.classList.add("is-closing");
    window.setTimeout(() => {
      if (!box) return;
      box.hidden = true;
      box.innerHTML = "";
      box.classList.remove("is-closing");
      document.body.classList.remove("receipt-open");
      document.querySelector('[data-request="bill"]')?.focus({ preventScroll: true });
    }, 320);
  };

  const bindClient = () => {
    document.addEventListener("click", async (event) => {
      const category = event.target.closest("[data-category]");
      const add = event.target.closest("[data-add-item]");
      const request = event.target.closest("[data-request]");
      const thanks = event.target.closest("[data-thank-bill]");
      const closeBill = event.target.closest("[data-close-bill]");
      const change = event.target.closest("[data-action='change-table']");
      const suggestion = event.target.closest("[data-assistant-suggest]");

      if (category) {
        state.activeCategory = category.dataset.category;
        renderMenu();
      }
      if (add) await addItemToSession(add.dataset.addItem);
      if (request) await createRequest(request.dataset.request);
      if (thanks) thankBill(thanks.dataset.thankBill);
      if (closeBill) closeCurrentBill();
      if (suggestion) await handleAssistantMessage(suggestion.dataset.assistantSuggest);
      if (change && !state.tableLocked) {
        clearInterval(state.clientPollTimer);
        state.clientHydrationToken += 1;
        state.localBillOpen = false;
        state.currentTable = null;
        state.currentSession = null;
        state.tableAccountStatus = "idle";
        state.tableAccountTotal = 0;
        state.qrLocked = false;
        state.tableLocked = false;
        state.sessionItems = [];
        state.clientRequests = [];
        state.sb.setTableAccess("", "");
        renderTablePicker();
        renderAccount();
        renderBillChat();
      }
    });

    document.addEventListener("change", async (event) => {
      if (event.target.id === "tableSelect") {
        state.localBillOpen = false;
        state.currentTable = state.tables.find((table) => table.id === event.target.value) || null;
        if (state.currentTable) {
          state.sb.setTableAccess(state.currentTable.id, tableCode(state.currentTable));
          void flushBillResolutionOutbox();
          state.currentSession = null;
          state.sessionItems = [];
          state.clientRequests = [];
          state.clientSnapshotSignature = "";
          state.tableAccountStatus = "checking";
          state.tableAccountTotal = 0;
          state.tableLocked = false;
          renderAccount();
          renderBillChat();
          renderTablePicker();
          void hydrateSelectedTable(state.currentTable.id);
        }
        renderTablePicker();
        renderAccount();
        renderBillChat();
      }
    });

    $("#assistantForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = event.currentTarget.message;
      const message = input.value;
      input.value = "";
      await handleAssistantMessage(message);
    });
  };

  const subscribeClient = () => {
    if (!state.currentSession) return;
    clearInterval(state.clientPollTimer);
    if (state.clientChannel) state.sb.removeChannel(state.clientChannel);
    const refresh = async () => {
      if (state.clientSyncBusy || !state.currentSession) return;
      state.clientSyncBusy = true;
      try {
        if (await loadClientSnapshot()) {
          renderAccount();
          renderBillChat();
        }
      } finally {
        state.clientSyncBusy = false;
      }
    };
    state.clientChannel = state.sb
      .channel(`table:${state.currentTable.id}`, { config: { broadcast: { self: false }, private: false } })
      .on("broadcast", { event: "refresh" }, refresh)
      .subscribe();
    state.clientPollTimer = setInterval(refresh, SYNC_INTERVAL_MS);
  };

  const initClient = async () => {
    setLoading(true);
    const nativeScanValue = tableValueFromUrl();
    if (nativeScanValue && localStorage.getItem("la_licorera_17_admin_token")) {
      const adminUrl = new URL("admin.html", location.href);
      adminUrl.searchParams.set("scan", nativeScanValue);
      adminUrl.hash = "service";
      location.replace(adminUrl.href);
      return;
    }
    await loadBootstrap();
    renderBrand();
    state.currentTable = findTableFromUrl();
    if (state.currentTable) {
      const adminLink = $(".admin-link");
      if (adminLink) {
        const adminUrl = new URL("admin.html", location.href);
        adminUrl.searchParams.set("scan", tableCode(state.currentTable));
        adminUrl.hash = "service";
        adminLink.href = adminUrl.href;
        adminLink.title = "Atender esta mesa desde el panel";
      }
      state.sb.setTableAccess(state.currentTable.id, tableCode(state.currentTable));
      state.tableAccountStatus = "checking";
      void flushBillResolutionOutbox();
    }
    renderTablePicker();
    renderMenu();
    renderAccount();
    renderBillChat();
    renderAssistant();
    bindClient();
    subscribeClient();
    setLoading(false);
    // La pantalla queda usable tras el bootstrap; la cuenta se hidrata en segundo plano.
    if (state.currentTable) {
      void hydrateSelectedTable(state.currentTable.id);
    }
  };

  const mergeOptimisticRequests = (requests = []) => requests.map((request) => {
    const optimistic = state.optimisticRequestStates.get(request.id);
    return optimistic ? { ...request, ...optimistic } : request;
  });

  const sessionItemMatches = (serverItem, expectedItem) =>
    serverItem && expectedItem &&
    String(serverItem.id) === String(expectedItem.id) &&
    String(serverItem.item_name || "") === String(expectedItem.item_name || "") &&
    Number(serverItem.quantity || 0) === Number(expectedItem.quantity || 0) &&
    Number(serverItem.unit_price || 0) === Number(expectedItem.unit_price || 0) &&
    String(serverItem.notes || "") === String(expectedItem.notes || "") &&
    String(serverItem.status || "") === String(expectedItem.status || "");

  const mergeOptimisticSessions = (serverSessions = []) => {
    const merged = new Map(serverSessions.map((session) => [session.id, session]));
    state.optimisticSessionStates.forEach((overlay, sessionId) => {
      const serverSession = merged.get(sessionId);
      if (overlay.mode === "remove") {
        merged.delete(sessionId);
        if (!serverSession) state.optimisticSessionStates.delete(sessionId);
        return;
      }
      const expectedItemConfirmed = !overlay.expectedItem ||
        (serverSession?.session_items || []).some((item) => sessionItemMatches(item, overlay.expectedItem));
      const expectedSessionConfirmed = !overlay.expectedSession || (
        String(serverSession?.payer_name || "") === String(overlay.expectedSession.payer_name || "") &&
        String(serverSession?.assigned_waiter_id || "") === String(overlay.expectedSession.assigned_waiter_id || "")
      );
      if (serverSession && expectedItemConfirmed && expectedSessionConfirmed) {
        state.optimisticSessionStates.delete(sessionId);
        merged.set(sessionId, serverSession);
      } else {
        merged.set(sessionId, overlay.session);
      }
    });
    return Array.from(merged.values());
  };

  const requestKind = (request) =>
    request.request_type === "other" && String(request.message || "").trim() ? "chat" : request.request_type;

  const activeRequests = () => state.requests.filter((request) => request.status === "pending");

  const requestSignature = () => activeRequests().map((request) => request.id).join("|");

  const updateAlarmButton = () => {
    const button = $("#enableSound");
    if (!button) return;
    button.classList.toggle("sound-active", state.soundEnabled);
    button.classList.toggle("needs-sound", !state.soundEnabled);
    button.innerHTML = state.soundEnabled
      ? `${icon("volume-2", 18)} Alarma activa`
      : `${icon("volume-x", 18)} Activar alarma`;
    const hint = $("#soundHint");
    if (hint) {
      hint.textContent = state.soundEnabled
        ? (state.soundPrimed
          ? "Alarma activa en este equipo."
          : "Alarma guardada. Se reanuda con el proximo gesto en esta pantalla.")
        : "Toca aqui para permitir el sonido de las alertas.";
    }
    refreshIcons();
  };

  const getAlarmAudio = () => {
    const audio = $("#alarmAudio");
    if (!audio) return null;
    audio.volume = 1;
    return audio;
  };

  const playAlarm = async () => {
    if (!state.soundEnabled || !activeRequests().length) return;
    const audio = getAlarmAudio();
    if (!audio) return;
    window.clearTimeout(state.alarmStopTimer);
    audio.loop = true;
    if (audio.paused) audio.currentTime = 0;
    await audio.play().catch(() => {
      state.soundPrimed = false;
      updateAlarmButton();
    });
    state.alarmStopTimer = window.setTimeout(() => {
      audio.pause();
      audio.loop = false;
      audio.currentTime = 0;
    }, 30000);
  };

  const stopAlarm = () => {
    window.clearTimeout(state.alarmStopTimer);
    const audio = getAlarmAudio();
    if (!audio) return;
    audio.pause();
    audio.loop = false;
    audio.currentTime = 0;
  };

  const unlockAlarm = async ({ silent = false } = {}) => {
    const audio = getAlarmAudio();
    if (!audio) {
      if (!silent) toast("No se encontro el sonido de alarma.", "error", "alarm-audio-missing");
      return;
    }

    try {
      state.soundEnabled = true;
      state.soundPrimed = true;
      localStorage.setItem("waiter_alarm_enabled", "1");
      updateAlarmButton();
      audio.currentTime = 0;
      audio.loop = false;
      await audio.play();
      if (!silent) toast("Alarma activada.", "ok", "alarm-enabled");

      if (!activeRequests().length) {
        window.setTimeout(() => {
          if (!activeRequests().length) {
            audio.pause();
            audio.currentTime = 0;
          }
        }, 1100);
      }
    } catch (error) {
      state.soundEnabled = false;
      state.soundPrimed = false;
      localStorage.removeItem("waiter_alarm_enabled");
      updateAlarmButton();
      if (!silent) toast("El navegador bloqueo el audio. Toca Activar alarma otra vez.", "error", "alarm-permission");
    }
  };

  const armAlarmOnFirstGesture = () => {
    const prime = async (fromMouseMove = false) => {
      if (state.soundPrimed || state.soundPriming) return;
      if (fromMouseMove) {
        if (state.mousePrimeAttempted) return;
        state.mousePrimeAttempted = true;
      }
      state.soundPriming = true;
      try {
        await unlockAlarm({ silent: true });
      } finally {
        state.soundPriming = false;
      }
    };
    // Algunos navegadores aceptan mousemove; click, toque y teclado son el respaldo garantizado.
    document.addEventListener("mousemove", () => prime(true), { passive: true });
    ["pointerdown", "touchstart", "keydown"].forEach((eventName) => {
      document.addEventListener(eventName, () => prime(false), { once: true, passive: true });
    });
  };

  const startAlarmLoop = () => {
    clearInterval(state.alarmTimer);
    state.alarmTimer = setInterval(() => {
      if (!activeRequests().length) {
        const audio = getAlarmAudio();
        if (audio) {
          audio.pause();
          audio.loop = false;
          audio.currentTime = 0;
        }
      }
    }, 12000);
  };

  const refreshAdminNow = async () => {
    if (state.adminSyncBusy) return false;
    state.adminSyncBusy = true;
    try {
      const changed = await loadAdminData();
      if (changed) renderAdminLive();
      return changed;
    } finally {
      state.adminSyncBusy = false;
    }
  };

  const startAdminPolling = () => {
    clearInterval(state.adminPollTimer);
    state.adminPollTimer = setInterval(refreshAdminNow, SYNC_INTERVAL_MS);
  };

  const loadAdminData = async () => {
    const snapshot = await dbQuiet(state.sb.rpc("getAdminSnapshot", { auth_token: state.authToken }), null);
    if (!snapshot) {
      const [requests, sessions] = await Promise.all([
        db(
          state.sb.from("service_requests").select("*, restaurant_tables(table_number, table_name)")
            .in("status", ["pending", "acknowledged"]).order("created_at", { ascending: false }),
          []
        ),
        db(
          state.sb.from("table_sessions").select("*, restaurant_tables(table_number, table_name), session_items(*)")
            .eq("status", "open").order("opened_at", { ascending: false }),
          []
        )
      ]);
      state.requests = mergeOptimisticRequests(requests || []);
      state.sessions = mergeOptimisticSessions(sessions || []);
      return true;
    }
    const requests = mergeOptimisticRequests(snapshot.requests || []);
    const sessions = mergeOptimisticSessions(snapshot.sessions || []);
    const signature = JSON.stringify([
      requests.map((request) => [request.id, request.status, request.updated_at]),
      sessions.map((session) => [
        session.id,
        session.status,
        session.updated_at,
        ...(session.session_items || []).map((item) => [item.id, item.status, item.quantity, item.updated_at])
      ])
    ]);
    if (signature === state.adminSnapshotSignature) return false;
    state.adminSnapshotSignature = signature;
    state.requests = requests;
    state.sessions = sessions;
    return true;
  };

  const renderAdminShell = () => {
    renderBrand();
    const totals = {
      tables: state.tables.filter((table) => table.is_active).length,
      alerts: activeRequests().length,
      open: state.sessions.length,
      sales: state.sessions.reduce((sum, session) => sum + sessionTotal(session), 0)
    };
    $("#metricTables").textContent = totals.tables;
    $("#metricAlerts").textContent = totals.alerts;
    $("#metricOpen").textContent = totals.open;
    $("#metricSales").textContent = money(totals.sales);
  };

  const integerMoney = (value) => Math.max(0, Math.round(Number(value || 0)));

  const calculatedCharge = (configured, base) => {
    const value = Number(configured || 0);
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value <= 1) return integerMoney(base * value);
    if (value <= 100) return integerMoney(base * value / 100);
    return integerMoney(value);
  };

  const sessionTotals = (session) => {
    const subtotal = (session?.session_items || [])
      .filter((item) => item.status !== "cancelled")
      .reduce((sum, item) => sum + integerMoney(item.unit_price) * Math.max(0, Number(item.quantity || 0)), 0);
    const discount = Math.min(subtotal, integerMoney(session?.discount));
    const taxable = Math.max(0, subtotal - discount);
    const tax = session?.tax ? integerMoney(session.tax) : calculatedCharge(state.business?.tax_rate, taxable);
    const serviceFee = session?.service_fee
      ? integerMoney(session.service_fee)
      : calculatedCharge(state.business?.service_fee, taxable);
    return { subtotal: integerMoney(subtotal), discount, tax, serviceFee, total: integerMoney(taxable + tax + serviceFee) };
  };

  const sessionTotal = (session) => sessionTotals(session).total;

  const tablesSignature = () =>
    JSON.stringify({
      tables: state.tables.map((table) => [
        table.id,
        table.table_number,
        table.table_name,
        table.qr_code,
        table.is_active
      ]),
      sessions: state.sessions.map((session) => [
        session.id,
        session.table_id,
        session.status,
        sessionTotal(session),
        (session.session_items || []).length
      ]),
      requests: activeRequests().map((request) => [request.id, request.table_id, request.request_type, request.status])
    });

  const groupedActiveRequests = () => {
    const groups = new Map();
    activeRequests().forEach((request) => {
      const kind = requestKind(request);
      const key = `${request.table_id}:${request.session_id || "no-session"}:${kind}`;
      if (!groups.has(key)) {
        groups.set(key, { ...request, kind, request_ids: [], count: 0, latest_message: request.message || "" });
      }
      const group = groups.get(key);
      group.request_ids.push(request.id);
      group.count += 1;
    });
    return Array.from(groups.values());
  };

  const renderAlerts = () => {
    const box = $("#alertsPanel");
    if (!box) return;
    const alerts = groupedActiveRequests();
    const visibleAlerts = state.alertFilter === "all"
      ? alerts
      : alerts.filter((request) => request.kind === state.alertFilter);
    const renderSignature = `${state.alertFilter}:${visibleAlerts.map((request) => `${request.id}:${request.count}:${request.latest_message}`).join("|")}`;
    box.classList.toggle("has-alerts", alerts.length > 0);
    const alertCards = visibleAlerts
      .map(
        (request) => `
              <article class="alert-card alert-${request.kind}" data-alert-card="${request.id}">
                <div class="alert-icon">
                  ${
                    REQUEST_IMAGES[request.request_type]
                      ? `<img class="alert-image" src="${REQUEST_IMAGES[request.request_type]}" alt="">`
                      : icon(REQUEST_ICONS[request.request_type] || "bell", 22)
                  }
                </div>
                <div>
                  <span>${request.kind === "chat" ? "Chat / pedido" : (REQUEST_LABELS[request.request_type] || request.request_type)}</span>
                  <h3><mark class="alert-table-name">${escapeHTML(tableLabel(request.restaurant_tables))}</mark></h3>
                  ${request.message && !parseBillMessage(request.message) ? `<p>${escapeHTML(request.message)}</p>` : ""}
                  <p>${prettyDateTime(request.created_at)}</p>
                </div>
                ${request.count > 1 ? `<strong class="alert-count" aria-label="${request.count} llamados">${request.count}</strong>` : ""}
                ${
                  request.request_type === "bill"
                    ? `<button class="primary" data-send-bill="${request.request_ids.join(",")}">${icon("send", 17)} Enviar cuenta</button>`
                    : `<button class="primary" data-accept-request="${request.request_ids.join(",")}">${icon("check", 17)} Aceptar</button>`
                }
              </article>
            `
      )
      .join("");

    $("#floatingAlerts")?.remove();
    if (renderSignature !== state.alertRenderSignature) {
      state.alertRenderSignature = renderSignature;
      box.innerHTML = visibleAlerts.length
        ? alertCards
        : emptyState("Sin solicitudes en este filtro", "Las nuevas solicitudes se acumularan aqui.", "bell");
    }

    const signature = requestSignature();
    if (signature && signature !== state.lastAlertSignature) {
      state.lastAlertSignature = signature;
      playAlarm();
    }
    refreshIcons();
  };

  const renderTables = () => {
    const box = $("#tablesGrid");
    if (!box) return;
    state.tableRenderSignature = tablesSignature();
    box.innerHTML = state.tables.length
      ? state.tables
          .map((table) => {
            const session = state.sessions.find((entry) => entry.table_id === table.id);
            const pending = state.requests.filter(
              (request) => request.table_id === table.id && request.status === "pending"
            );
            return `
              <article class="table-card ${pending.length ? "needs-attention" : ""}">
                <div class="table-top">
                  <span>${icon(pending.length ? "alarm-clock" : "square", 16)} ${escapeHTML(tableLabel(table))}</span>
                  <strong>${session ? money(sessionTotal(session)) : money(0)}</strong>
                </div>
                <p>${pending.length ? `${pending.length} solicitud(es) activa(s)` : session ? "Cuenta abierta" : "Disponible"}</p>
                <div class="table-qr-inline" data-table-qr="${table.id}"></div>
                <div class="table-actions">
                  <button class="ghost small" data-copy-qr="${tableCode(table)}">
                    ${icon("qr-code", 15)} Copiar QR
                  </button>
                  <button class="ghost small" data-download-qr="${table.id}">
                    ${icon("download", 15)} Descargar QR
                  </button>
                  ${session ? `<button class="ghost small" data-view-session="${session.id}">${icon("receipt", 15)} Ver cuenta</button>` : ""}
                </div>
              </article>
            `;
          })
          .join("")
      : emptyState("Sin mesas", "Crea las mesas del negocio para generar enlaces QR.", "layout-grid");
    refreshIcons();
    renderGeneratedTableQrs();
  };

  const renderBusinessForm = () => {
    const form = $("#businessForm");
    if (!form) return;
    form.business_name.value = state.business?.business_name || "";
    form.subtitle.value = state.business?.subtitle || "";
    form.accent_color.value = state.business?.accent_color || "#f05a28";
    form.currency.value = DEFAULT_CURRENCY;
    form.logo_url.value = state.business?.logo_url || "";
    form.cover_url.value = state.business?.cover_url || "";
    ["logo_url", "cover_url"].forEach((field) => {
      const status = $(`[data-upload-status="${field}"]`);
      const box = $(`[data-upload-box="${field}"]`);
      const hasImage = Boolean(form[field]?.value);
      if (status) status.textContent = hasImage ? "Imagen cargada" : "Seleccionar imagen";
      box?.classList.toggle("has-file", hasImage);
    });
  };

  const renderTableManager = () => {
    const list = $("#tableManagerList");
    if (!list) return;
    const validIds = new Set(state.tables.map((table) => String(table.id)));
    state.selectedTableQrIds = new Set(
      [...state.selectedTableQrIds].filter((id) => validIds.has(String(id)))
    );
    list.innerHTML = state.tables.length
      ? state.tables
          .map(
            (table) => `
              <div class="manager-row table-manager-row${state.selectedTableQrIds.has(String(table.id)) ? " is-selected" : ""}">
                <label class="qr-table-checkbox" title="Seleccionar ${escapeHTML(tableLabel(table))}">
                  <input type="checkbox" data-select-table-qr="${table.id}" ${state.selectedTableQrIds.has(String(table.id)) ? "checked" : ""}>
                  <span>${icon("check", 16)}</span>
                </label>
                <div class="qr-mini" data-table-qr="${table.id}"></div>
                <div class="table-manager-copy">
                  <strong>${escapeHTML(tableLabel(table))}</strong>
                  <span>${qrTextForTable(table)}</span>
                </div>
                <div class="row-actions">
                  <button class="icon-btn" data-edit-table="${table.id}" aria-label="Editar mesa">${icon("pencil", 17)}</button>
                  <button class="icon-btn" data-download-qr="${table.id}" aria-label="Descargar QR en PDF de 6 por 6 centimetros">${icon("file-down", 17)}</button>
                  <button class="icon-btn" data-regenerate-qr="${table.id}" aria-label="Rehacer QR">${icon("refresh-cw", 17)}</button>
                  <button class="icon-btn danger" data-delete-table="${table.id}" aria-label="Eliminar mesa">${icon("trash-2", 17)}</button>
                </div>
              </div>
            `
          )
          .join("")
      : emptyState("Sin mesas", "Agrega una mesa para generar su QR.", "qr-code");
    renderQrBatchControls();
    refreshIcons();
    renderGeneratedTableQrs();
  };

  const renderQrBatchControls = () => {
    const count = state.selectedTableQrIds.size;
    const countLabel = $("#qrSelectionCount");
    const downloadButton = $("#downloadSelectedQrs");
    const selectAllButton = $("#selectAllTableQrs");
    const clearButton = $("#clearTableQrs");
    if (countLabel) countLabel.textContent = `${count} ${count === 1 ? "seleccionada" : "seleccionadas"}`;
    if (downloadButton) {
      downloadButton.disabled = count === 0;
      downloadButton.innerHTML = `${icon("file-down", 18)} Descargar PDF${count ? ` (${count})` : ""}`;
    }
    if (selectAllButton) selectAllButton.disabled = !state.tables.length || count === state.tables.length;
    if (clearButton) clearButton.disabled = count === 0;
    refreshIcons();
  };

  const normalizeTableLookup = (value = "") =>
    normalizeText(value).replace(/mesa/g, "").replace(/\s+/g, "");

  const waiterTableSearchScore = (table, query) => {
    if (!query) return Number(table.table_number || 0);
    const tableNumber = String(table.table_number || "").replace(/\s+/g, "");
    const tableName = normalizeTableLookup(table.table_name || "");
    const fullLabel = normalizeTableLookup(`${table.table_name || ""} mesa ${table.table_number || ""}`);
    if (query === tableNumber) return 0;
    if (query === tableName || query === fullLabel) return 1;
    if (tableNumber.startsWith(query)) return 10 + tableNumber.length;
    if (tableName.startsWith(query) || fullLabel.startsWith(query)) return 20;
    if (tableNumber.includes(query)) return 30 + tableNumber.length;
    if (tableName.includes(query) || fullLabel.includes(query)) return 40;
    return Number.POSITIVE_INFINITY;
  };

  const renderWaiterTableSelect = (searchValue) => {
    const combobox = $("#waiterTableCombobox");
    const options = $("#waiterTableOptions");
    if (!combobox || !options) return;
    const search = $("#waiterTableSearch");
    const status = $("#waiterTableSearchStatus");
    const query = normalizeTableLookup(searchValue === undefined ? search?.value : searchValue);
    const scoredTables = state.tables
      .filter((table) => table.is_active !== false)
      .map((table) => ({ table, score: waiterTableSearchScore(table, query) }))
      .filter((entry) => Number.isFinite(entry.score));
    const exactMatches = query ? scoredTables.filter((entry) => entry.score <= 1) : [];
    const activeTables = (exactMatches.length ? exactMatches : scoredTables)
      .sort((a, b) => a.score - b.score || Number(a.table.table_number || 0) - Number(b.table.table_number || 0))
      .map((entry) => entry.table);
    const allActiveCount = state.tables.filter((table) => table.is_active !== false).length;
    const autoSelectedTable = query && (exactMatches.length === 1 || activeTables.length === 1)
      ? (exactMatches[0]?.table || activeTables[0])
      : null;
    combobox.dataset.selectedId = autoSelectedTable?.id || "";
    combobox.dataset.activeIndex = autoSelectedTable ? String(activeTables.indexOf(autoSelectedTable)) : "-1";
    options.innerHTML = activeTables.length
      ? activeTables.map((table, index) => {
          const defaultName = `Mesa ${table.table_number}`;
          const name = String(table.table_name || "").trim();
          const hasCustomName = name && name.toLowerCase() !== defaultName.toLowerCase();
          const label = hasCustomName ? name : defaultName;
          const selected = table.id === autoSelectedTable?.id;
          return `
            <button type="button" id="waiter-table-option-${index}" class="smart-table-option${selected ? " is-selected" : ""}"
              data-waiter-table="${escapeHTML(table.id)}" role="option" aria-selected="${selected}">
              <span class="smart-table-option-icon">${icon("map-pin", 18)}</span>
              <span class="smart-table-option-copy">
                <strong>${escapeHTML(label)}</strong>
                <small>${escapeHTML(hasCustomName ? defaultName : `Numero ${table.table_number}`)}</small>
              </span>
              ${selected ? icon("check", 18) : ""}
            </button>`;
        }).join("")
      : `<div class="smart-table-empty">${allActiveCount ? "No encontramos esa mesa" : "No hay mesas activas"}</div>`;
    search?.setAttribute("aria-activedescendant", autoSelectedTable ? `waiter-table-option-${activeTables.indexOf(autoSelectedTable)}` : "");
    if (status) {
      status.classList.toggle("no-results", Boolean(query && !activeTables.length));
      status.textContent = !allActiveCount
        ? "No hay mesas activas."
        : query
          ? activeTables.length
            ? autoSelectedTable
              ? `${tableLabel(autoSelectedTable)} seleccionada. Presiona Enter para abrirla.`
              : `${activeTables.length} mesas coinciden. Toca la que necesitas.`
            : `Ninguna mesa coincide con "${String(searchValue === undefined ? search?.value || "" : searchValue).trim()}".`
          : `${allActiveCount} mesas disponibles.`;
    }
    refreshIcons();
  };

  const showWaiterTableOptions = () => {
    const combobox = $("#waiterTableCombobox");
    const options = $("#waiterTableOptions");
    const search = $("#waiterTableSearch");
    if (!combobox || !options || !search) return;
    options.hidden = false;
    combobox.classList.add("is-open");
    search.setAttribute("aria-expanded", "true");
  };

  const closeWaiterTableOptions = () => {
    const combobox = $("#waiterTableCombobox");
    const options = $("#waiterTableOptions");
    const search = $("#waiterTableSearch");
    if (!combobox || !options || !search) return;
    options.hidden = true;
    combobox.classList.remove("is-open");
    search.setAttribute("aria-expanded", "false");
  };

  const setWaiterTableActiveIndex = (requestedIndex) => {
    const combobox = $("#waiterTableCombobox");
    const options = $("#waiterTableOptions");
    const search = $("#waiterTableSearch");
    const buttons = $$('[data-waiter-table]', options);
    if (!combobox || !search || !buttons.length) return null;
    const index = (requestedIndex + buttons.length) % buttons.length;
    buttons.forEach((button, buttonIndex) => {
      const selected = buttonIndex === index;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    const selectedButton = buttons[index];
    combobox.dataset.activeIndex = String(index);
    combobox.dataset.selectedId = selectedButton.dataset.waiterTable || "";
    search.setAttribute("aria-activedescendant", selectedButton.id);
    selectedButton.scrollIntoView({ block: "nearest" });
    return selectedButton;
  };

  const openWaiterTableChoice = async (tableId) => {
    const combobox = $("#waiterTableCombobox");
    if (!tableId || !combobox || combobox.dataset.busy === "true") return;
    combobox.dataset.busy = "true";
    $$('[data-waiter-table]', combobox).forEach((button) => { button.disabled = true; });
    closeWaiterTableOptions();
    try {
      await openScannedTable(tableId);
    } finally {
      const search = $("#waiterTableSearch");
      if (search) search.value = "";
      combobox.dataset.busy = "false";
      renderWaiterTableSelect();
    }
  };

  const renderMenuManager = () => {
    const categorySelects = $$(".js-category-select");
    categorySelects.forEach((select) => {
      select.innerHTML = `
        <option value="">Elegir categoria</option>
        ${state.categories.map((category) => `<option value="${escapeHTML(category.id)}">${escapeHTML(category.name)}</option>`).join("")}
      `;
    });

    const consumptionSelect = $("#consumptionItem");
    if (consumptionSelect) {
      consumptionSelect.innerHTML = `
        <option value="">Producto personalizado</option>
        ${state.items
          .filter((item) => item.is_available)
          .map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)} - ${money(item.price)}</option>`)
          .join("")}
      `;
    }

    const categoryList = $("#categoryList");
    if (categoryList) {
      categoryList.innerHTML = state.categories.length
        ? state.categories
            .map(
              (category) => `
                <div class="manager-row category-manager-row">
                  <div class="category-token">${icon("tag", 16)}</div>
                  <div>
                    <strong>${escapeHTML(category.name)}</strong>
                    <span>Orden ${category.sort_order || 0} · ${category.is_active ? "Visible" : "Oculta"}</span>
                  </div>
                  <div class="row-actions">
                    <button class="icon-btn" data-edit-category="${category.id}" aria-label="Editar categoria">${icon("pencil", 17)}</button>
                    <button class="icon-btn danger" data-delete-category="${category.id}" aria-label="Eliminar categoria">${icon("trash-2", 17)}</button>
                  </div>
                </div>
              `
            )
            .join("")
        : emptyState("Sin categorias", "Crea categorias para ordenar el menu.", "tags");
    }

    const itemList = $("#itemList");
    if (itemList) {
      itemList.innerHTML = state.items.length
        ? state.items
            .map(
              (item) => `
                <div class="manager-row item-row product-manager-row">
                  <div class="product-thumb">
                    ${
                      item.image_url
                        ? `<img src="${escapeHTML(item.image_url)}" alt="${escapeHTML(item.name)}">`
                        : icon("utensils", 20)
                    }
                  </div>
                  <div class="product-manager-copy">
                    <strong>${escapeHTML(item.name)}</strong>
                    <span>${escapeHTML(item.description || "Sin descripcion")}</span>
                    <div class="product-badges">
                      <em>${item.menu_categories?.name || "Sin categoria"}</em>
                      <em class="${item.is_available ? "is-on" : "is-off"}">${item.is_available ? "Disponible" : "Oculto"}</em>
                    </div>
                  </div>
                  <strong class="product-price">${money(item.price)}</strong>
                  <div class="row-actions">
                    <button class="icon-btn" data-edit-item="${item.id}" aria-label="Editar producto">${icon("pencil", 17)}</button>
                    <button class="icon-btn danger" data-delete-item="${item.id}" aria-label="Eliminar producto">${icon("trash-2", 17)}</button>
                  </div>
                </div>
              `
            )
            .join("")
        : emptyState("Sin productos", "Agrega platos, bebidas o servicios.", "chef-hat");
    }
    refreshIcons();
  };

  const renderGeneratedTableQrs = () => {
    $$("[data-table-qr]").forEach((target) => {
      const table = state.tables.find((entry) => entry.id === target.dataset.tableQr);
      if (!table) return;
      renderQrImage(target, qrTextForTable(table), `QR ${tableLabel(table)}`);
    });
  };

  const renderTableFormQr = () => {
    const form = $("#tableForm");
    const preview = $("#qrPreview");
    const link = $("#qrPreviewLink");
    if (!form || !preview || !link) return;
    const number = Number(form.table_number.value);
    const current = state.tables.find((table) => table.id === form.table_id.value);
    const table = current || (number ? { table_number: number, qr_code: `mesa-${number}` } : null);
    if (!table) {
      preview.innerHTML = `${icon("qr-code", 28)}`;
      link.textContent = "Define el numero de mesa para generar el enlace exacto.";
      refreshIcons();
      return;
    }
    const url = qrTextForTable(table);
    link.textContent = url;
    renderQrImage(preview, url, `QR ${tableLabel(table)}`);
  };

  const renderAccounts = () => {
    const box = $("#accountsPanel");
    if (!box) return;
    const renderSignature = JSON.stringify([
      state.business?.tax_rate,
      state.business?.service_fee,
      state.sessions.map((session) => [
        session.id,
        session.status,
        session.payer_name,
        session.assigned_waiter_id,
        session.assigned_waiter?.full_name,
        (session.session_items || []).map((item) => [
          item.id, item.item_name, item.quantity, item.unit_price, item.notes, item.status, item.updated_at
        ])
      ])
    ]);
    if (renderSignature === state.accountsRenderSignature) return;
    state.accountsRenderSignature = renderSignature;
    box.innerHTML = state.sessions.length
      ? state.sessions
          .map((session) => {
            const billRequest = state.requests.find(
              (request) => request.session_id === session.id && request.request_type === "bill"
            );
            const items = (session.session_items || []).filter((item) => item.status !== "cancelled");
            const total = sessionTotal(session);
            const openedAt = new Date(session.opened_at || session.created_at).toLocaleTimeString("es-CO", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit"
            });
            const openedDate = new Date(session.opened_at || session.created_at).toLocaleDateString("es-CO", {
              day: "2-digit",
              month: "short",
              year: "numeric"
            });
            return `
              <article class="account-card invoice-ticket">
                <div class="invoice-total-block">
                  <span>Total actual</span>
                  <strong>${money(total)}</strong>
                </div>

                <div class="invoice-identity">
                  <span>${escapeHTML(tableLabel(session.restaurant_tables))}</span>
                  <strong>#${String(session.id).slice(0, 8).toUpperCase()}</strong>
                </div>

                <div class="invoice-meta-grid">
                  <span>Negocio</span>
                  <strong>${escapeHTML(state.business?.business_name || "Restaurante")}</strong>
                  <span>Fecha</span>
                  <strong>${openedDate}</strong>
                  <span>Hora</span>
                  <strong>${openedAt}</strong>
                  <span>Consumos</span>
                  <strong>${items.length}</strong>
                  <span>Responsable</span>
                  <strong>${escapeHTML(session.payer_name || "Por definir")}</strong>
                  <span>Mesero</span>
                  <strong>${escapeHTML(session.assigned_waiter?.full_name || "Sin asignar")}</strong>
                </div>

                <div class="invoice-lines">
                  ${items
                    .map(
                      (item) => `
                        <div class="invoice-line">
                          <div>
                            <strong>${escapeHTML(item.item_name)}</strong>
                            <span>${item.quantity} x ${money(item.unit_price)}</span>
                            <small>${escapeHTML(item.created_by_user?.full_name || "Cliente")}${item.created_at ? ` · ${new Date(item.created_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}</small>
                          </div>
                          <strong>${money(Number(item.unit_price) * Number(item.quantity))}</strong>
                          <button class="icon-btn" data-edit-consumption="${item.id}" data-session-id="${session.id}" aria-label="Editar consumo">${icon("pencil", 15)}</button>
                        </div>
                      `
                    )
                    .join("") || `<div class="invoice-empty">${icon("clipboard-list", 18)} Sin consumos registrados</div>`}
                </div>

                <div class="invoice-actions">
                  <button class="ghost small" data-add-manual="${session.id}">${icon("plus", 15)} Consumo</button>
                  ${
                    billRequest
                      ? `<button class="ghost small" data-send-bill="${billRequest.id}">${icon("send", 15)} ${
                          billRequest.status === "acknowledged" ? "Reenviar" : "Enviar cuenta"
                        }</button>`
                      : ""
                  }
                  <button class="primary small invoice-close" data-close-session="${session.id}">Cerrar ${icon("arrow-right", 15)}</button>
                </div>
              </article>
            `;
          })
          .join("")
      : emptyState("No hay cuentas abiertas", "Las mesas con consumos apareceran aqui.", "receipt-text");
    refreshIcons();
  };

  const renderAdmin = () => {
    renderAdminShell();
    renderAlerts();
    renderTables();
    renderBusinessForm();
    renderTableManager();
    renderWaiterTableSelect();
    renderMenuManager();
    renderAccounts();
  };

  const renderAdminLive = () => {
    renderAdminShell();
    renderAlerts();
    if (state.activeAdminSection === "dashboard" && tablesSignature() !== state.tableRenderSignature) renderTables();
    if (state.activeAdminSection === "accounts") renderAccounts();
  };

  const saveBusiness = async (form) => {
    const payload = {
      is_primary: true,
      business_name: form.business_name.value.trim() || "Tu restaurante",
      subtitle: form.subtitle.value.trim(),
      accent_color: form.accent_color.value || "#f05a28",
      currency: DEFAULT_CURRENCY,
      logo_url: form.logo_url.value.trim(),
      cover_url: form.cover_url.value.trim()
    };
    const original = state.business;
    state.business = { ...(state.business || {}), ...payload };
    persistBootstrapCache();
    renderBrand();
    renderBusinessForm();
    toast("Marca actualizada. El cliente ya vera esta personalizacion.");
    void (async () => {
      const saved = await retryQuiet(
        () => state.sb.from("business_settings").upsert(payload, { onConflict: "is_primary" }).select("*").single(),
        4
      );
      if (saved) {
        state.business = saved;
        persistBootstrapCache();
        return;
      }
      state.business = original;
      persistBootstrapCache();
      renderBrand();
      renderBusinessForm();
      toast("No se pudo guardar la marca. Se restauro la informacion.", "error", "business-save-failed");
    })();
  };

  const uploadAsset = async (file, fieldName) => {
    if (!file) return;
    const status = $(`[data-upload-status="${fieldName}"]`);
    const box = $(`[data-upload-box="${fieldName}"]`);
    if (status) status.textContent = "Subiendo...";
    box?.classList.add("is-uploading");
    const extension = file.name.split(".").pop() || "jpg";
    const path = `brand/${fieldName}-${uid()}.${extension}`;
    const { error } = await state.sb.storage.from("brand-assets").upload(path, file, { upsert: true });
    if (error) {
      if (status) status.textContent = "No se pudo subir";
      box?.classList.remove("is-uploading");
      toast(`No se pudo subir: ${error.message}`, "error");
      return;
    }
    const { data } = state.sb.storage.from("brand-assets").getPublicUrl(path);
    const input = $(`[name="${fieldName}"]`);
    if (input) input.value = data.publicUrl;
    if (status) status.textContent = "Imagen cargada. Guarda para aplicar.";
    box?.classList.remove("is-uploading");
    box?.classList.add("has-file");
    toast("Imagen subida. Guarda la marca para aplicarla.");
  };

  const saveTable = async (form) => {
    const number = Number(form.table_number.value);
    const payload = {
      table_number: number,
      table_name: form.table_name.value.trim() || null,
      qr_code: `mesa-${number}`,
      qr_image_url: null,
      is_active: form.is_active.checked
    };
    if (!payload.table_number) {
      toast("El numero de mesa es obligatorio.", "error");
      return;
    }
    const id = form.table_id.value;
    const existing = id ? null : state.tables.find((table) => Number(table.table_number) === number);
    const targetId = id || existing?.id;
    const isUpdate = Boolean(targetId);
    const recordId = targetId || uid();
    const original = [...state.tables];
    const optimistic = { ...(state.tables.find((table) => table.id === recordId) || {}), ...payload, id: recordId };
    state.tables = isUpdate
      ? state.tables.map((table) => table.id === recordId ? optimistic : table)
      : [...state.tables, optimistic].sort((left, right) => Number(left.table_number || 0) - Number(right.table_number || 0));
    form.reset();
    form.table_id.value = "";
    persistBootstrapCache();
    renderTableManager();
    renderTables();
    renderTableFormQr();
    toast(isUpdate ? "Mesa actualizada. QR listo para descargar." : "Mesa guardada. QR listo para descargar.");
    void (async () => {
      const saved = await retryQuiet(
        () => isUpdate
          ? state.sb.from("restaurant_tables").update(payload).eq("id", recordId).select("*").single()
          : state.sb.from("restaurant_tables").insert({ ...payload, id: recordId }).select("*").single(),
        4
      );
      if (saved) {
        state.tables = state.tables.map((table) => table.id === recordId ? saved : table);
        persistBootstrapCache();
        return;
      }
      state.tables = original;
      persistBootstrapCache();
      renderTableManager();
      renderTables();
      renderTableFormQr();
      toast("No se pudo guardar la mesa. Se restauro la informacion.", "error", `table-save-failed:${recordId}`);
    })();
  };

  const saveCategory = async (form) => {
    const payload = {
      name: form.category_name.value.trim(),
      sort_order: Number(form.category_sort.value || 0),
      is_active: form.category_active.checked
    };
    if (!payload.name) {
      toast("La categoria necesita nombre.", "error");
      return;
    }
    const id = form.category_id.value;
    const query = id
      ? state.sb.from("menu_categories").update(payload).eq("id", id).select("*").single()
      : state.sb.from("menu_categories").insert(payload).select("*").single();
    const saved = await db(query, null);
    if (saved) {
      form.reset();
      form.category_id.value = "";
      form.category_active.checked = true;
      await loadCore();
      renderAdmin();
      toast("Categoria guardada.");
    }
  };

  const saveItem = async (form) => {
    let categoryId = form.category_id.value;
    const newCategory = form.new_category.value.trim();
    if (!categoryId && newCategory) {
      const category = await db(
        state.sb.from("menu_categories").insert({ name: newCategory, is_active: true }).select("*").single(),
        null
      );
      categoryId = category?.id || "";
    }
    const payload = {
      category_id: categoryId || null,
      name: form.item_name.value.trim(),
      description: form.description.value.trim(),
      price: Number(form.price.value || 0),
      image_url: form.image_url.value.trim(),
      is_available: form.is_available.checked,
      sort_order: Number(form.sort_order.value || 0)
    };
    if (!payload.name || !payload.price) {
      toast("Producto y precio son obligatorios.", "error");
      return;
    }
    const id = form.item_id.value;
    const query = id
      ? state.sb.from("menu_items").update(payload).eq("id", id).select("*").single()
      : state.sb.from("menu_items").insert(payload).select("*").single();
    const saved = await db(query, null);
    if (saved) {
      form.reset();
      form.item_id.value = "";
      form.is_available.checked = true;
      await loadCore();
      renderAdmin();
      toast("Producto guardado.");
    }
  };

  const acknowledgeRequestOptimistically = (requestIds, payload, failureMessage) => {
    const ids = Array.isArray(requestIds) ? requestIds : String(requestIds || "").split(",").filter(Boolean);
    const idSet = new Set(ids);
    const originals = state.requests.filter((request) => idSet.has(request.id));
    if (!originals.length) return;
    const optimistic = { ...payload, updated_at: new Date().toISOString() };
    ids.forEach((id) => state.optimisticRequestStates.set(id, optimistic));
    state.requests = state.requests.map((request) => idSet.has(request.id) ? { ...request, ...optimistic } : request);
    renderAdminLive();

    void (async () => {
      const persist = () => state.sb.rpc("acknowledgeServiceRequests", {
        auth_token: state.authToken,
        ids,
        acknowledged_at: payload.acknowledged_at,
        message: payload.message
      }).then((fastResult) => {
        if (fastResult?.data && !fastResult?.error) return fastResult;
        return state.sb.from("service_requests").update(payload).in("id", ids).select("*");
      });
      const saved = await retryQuiet(
        persist,
        4
      );
      ids.forEach((id) => state.optimisticRequestStates.delete(id));
      if (!saved || !saved.length) {
        const originalMap = new Map(originals.map((request) => [request.id, request]));
        state.requests = state.requests.map((request) => originalMap.get(request.id) || request);
        renderAdminLive();
        toast(failureMessage, "error", `request-write-failed:${ids.join(":")}`);
        return;
      }
      const savedMap = new Map(saved.map((request) => [request.id, request]));
      state.requests = state.requests.map((request) => savedMap.has(request.id)
        ? { ...request, ...savedMap.get(request.id), restaurant_tables: request.restaurant_tables }
        : request);
      renderAdminLive();
    })();
  };

  const acceptRequest = async (ids) => {
    stopAlarm();
    const idList = String(ids || "").split(",").filter(Boolean);
    const sessionIds = [...new Set(state.requests.filter((request) => idList.includes(request.id)).map((request) => request.session_id).filter(Boolean))];
    if (sessionIds.length && state.currentUser?.id) {
      state.sessions = state.sessions.map((session) => {
        if (!sessionIds.includes(session.id)) return session;
        const optimisticSession = { ...session, assigned_waiter_id: state.currentUser.id, assigned_waiter: state.currentUser };
        state.optimisticSessionStates.set(session.id, {
          mode: "upsert",
          session: optimisticSession,
          expectedSession: { payer_name: optimisticSession.payer_name || "", assigned_waiter_id: state.currentUser.id }
        });
        return optimisticSession;
      });
      void (async () => {
        const savedSessions = await retryQuiet(
          () => state.sb.from("table_sessions").update({ assigned_waiter_id: state.currentUser.id }).in("id", sessionIds).select("*"),
          4
        );
        if (!savedSessions) sessionIds.forEach((sessionId) => state.optimisticSessionStates.delete(sessionId));
      })();
    }
    acknowledgeRequestOptimistically(
      ids,
      {
        status: "acknowledged",
        acknowledged_by_user_id: state.currentUser?.id || null,
        acknowledged_at: new Date().toISOString()
      },
      "No se pudo confirmar la solicitud. Volvio a la lista."
    );
  };

  const sendBillToClient = async (requestIds) => {
    stopAlarm();
    const ids = String(requestIds || "").split(",").filter(Boolean);
    const requestId = ids[0];
    const request = state.requests.find((entry) => entry.id === requestId);
    const session = state.sessions.find((entry) => entry.id === request?.session_id);
    if (!request || !session) {
      toast("No se encontro la cuenta abierta de esta mesa.", "error");
      return;
    }
    acknowledgeRequestOptimistically(
      ids,
      {
        status: "acknowledged",
        acknowledged_by_user_id: state.currentUser?.id || null,
        acknowledged_at: new Date().toISOString(),
        message: buildBillMessage(session)
      },
      "No se pudo enviar la cuenta. La solicitud volvio a la lista."
    );
  };

  const closeSession = async (id) => {
    const session = state.sessions.find((entry) => entry.id === id);
    if (!session) return;
    const totals = sessionTotals(session);
    const originalSessions = state.sessions;
    const originalRequests = state.requests;
    state.optimisticSessionStates.set(id, { mode: "remove", session });
    state.sessions = state.sessions.filter((entry) => entry.id !== id);
    state.requests = state.requests.map((request) => request.session_id === id ? { ...request, status: "resolved" } : request);
    renderAdminLive();
    void (async () => {
      const saved = await retryQuiet(
        () => state.sb.from("table_sessions").update({
          status: "closed",
          closed_at: new Date().toISOString(),
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          service_fee: totals.serviceFee,
          total: totals.total
        }).eq("id", id).select("*").single(),
        4
      );
      if (!saved) {
        state.optimisticSessionStates.delete(id);
        state.sessions = originalSessions;
        state.requests = originalRequests;
        renderAdmin();
        toast("No se pudo cerrar la cuenta. Se restauro la informacion.", "error", `close-session-failed:${id}`);
        return;
      }
      state.optimisticSessionStates.set(id, { mode: "remove", session: { ...session, ...saved } });
      await dbQuiet(state.sb.from("service_requests").update({ status: "resolved" }).eq("session_id", id), null);
    })();
  };

  const openConsumptionDialog = (sessionId) => {
    const dialog = $("#consumptionDialog");
    const form = $("#consumptionForm");
    if (!dialog || !form) return;
    form.reset();
    form.session_id.value = sessionId;
    form.session_item_id.value = "";
    const session = state.sessions.find((entry) => entry.id === sessionId);
    form.payer_name.value = session?.payer_name || "";
    form.quantity.value = 1;
    form.unit_price.value = 0;
    dialog.showModal();
    refreshIcons();
  };

  const editConsumption = (sessionId, itemId) => {
    const session = state.sessions.find((entry) => entry.id === sessionId);
    const item = session?.session_items?.find((entry) => entry.id === itemId);
    const form = $("#consumptionForm");
    const dialog = $("#consumptionDialog");
    if (!session || !item || !form || !dialog) return;
    form.reset();
    form.session_id.value = session.id;
    form.session_item_id.value = item.id;
    form.menu_item_id.value = item.menu_item_id || "";
    form.item_name.value = item.item_name || "";
    form.payer_name.value = session.payer_name || "";
    form.quantity.value = item.quantity || 1;
    form.unit_price.value = item.unit_price || 0;
    form.notes.value = item.notes || "";
    dialog.showModal();
    refreshIcons();
  };

  const addManualConsumption = async (form) => {
    const sessionId = form.session_id.value;
    const session = state.sessions.find((entry) => entry.id === sessionId);
    const selectedItem = state.items.find((item) => item.id === form.menu_item_id.value);
    const name = form.item_name.value.trim() || selectedItem?.name;
    const price = Number(form.unit_price.value || selectedItem?.price || 0);
    const quantity = Number(form.quantity.value || 1);
    const itemId = form.session_item_id.value || "";
    const payerName = form.payer_name.value.trim();
    if (!name) {
      toast("El consumo necesita nombre o producto.", "error");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 || !Number.isFinite(price) || price < 0) {
      toast("Revisa cantidad y precio antes de guardar.", "error", "invalid-consumption-values");
      return;
    }
    if (!session) return;
    const payload = {
      session_id: sessionId,
      table_id: session.table_id,
      menu_item_id: selectedItem?.id || null,
      item_name: name,
      unit_price: price,
      quantity,
      notes: form.notes.value.trim(),
      status: "served",
      created_by_user_id: itemId ? undefined : state.currentUser?.id || null,
      updated_by_user_id: state.currentUser?.id || null
    };
    const temporaryId = itemId || `local-${uid()}`;
    const optimisticItem = { ...payload, id: temporaryId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    let optimisticSession = session;
    state.sessions = state.sessions.map((entry) => entry.id === sessionId
      ? (optimisticSession = {
          ...entry,
          payer_name: payerName || entry.payer_name,
          assigned_waiter_id: state.currentUser?.id || entry.assigned_waiter_id,
          assigned_waiter: state.currentUser || entry.assigned_waiter,
          session_items: itemId
            ? (entry.session_items || []).map((item) => item.id === itemId ? { ...item, ...optimisticItem } : item)
            : [...(entry.session_items || []), optimisticItem]
        })
      : entry);
    state.optimisticSessionStates.set(sessionId, {
      mode: "upsert",
      session: optimisticSession,
      expectedItem: optimisticItem,
      expectedSession: {
        payer_name: optimisticSession.payer_name || "",
        assigned_waiter_id: optimisticSession.assigned_waiter_id || ""
      }
    });
    $("#consumptionDialog")?.close();
    renderAdminLive();
    void (async () => {
      const sessionSaved = await retryQuiet(
        () => state.sb.from("table_sessions").update({
          payer_name: payerName || session.payer_name || "",
          assigned_waiter_id: state.currentUser?.id || session.assigned_waiter_id || null
        }).eq("id", sessionId).select("*").single(),
        4
      );
      const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
      const saved = await retryQuiet(
        () => itemId
          ? state.sb.from("session_items").update(cleanPayload).eq("id", itemId).select("*").single()
          : state.sb.from("session_items").insert(cleanPayload).select("*").single(),
        4
      );
      if (!saved) {
        state.optimisticSessionStates.delete(sessionId);
        state.sessions = state.sessions.map((entry) => entry.id === sessionId
          ? session
          : entry);
        renderAdmin();
        toast("No se pudo guardar el consumo. Se revirtio el cambio.", "error", `consumption-failed:${temporaryId}`);
        return;
      }
      let confirmedSession = null;
      state.sessions = state.sessions.map((entry) => entry.id === sessionId
        ? (confirmedSession = {
            ...entry,
            ...(sessionSaved || {}),
            assigned_waiter: state.currentUser || entry.assigned_waiter,
            session_items: (entry.session_items || []).map((item) => item.id === temporaryId
              ? { ...saved, created_by_user: item.created_by_user || state.currentUser }
              : item)
          })
        : entry);
      state.optimisticSessionStates.set(sessionId, {
        mode: "upsert",
        session: confirmedSession,
        expectedItem: saved,
        expectedSession: sessionSaved ? {
          payer_name: sessionSaved.payer_name || "",
          assigned_waiter_id: sessionSaved.assigned_waiter_id || ""
        } : null
      });
    })();
  };

  const copyQr = async (code) => {
    const url = clientUrlForCode(code);
    try {
      await navigator.clipboard.writeText(url);
      toast("Enlace de QR copiado.");
    } catch (error) {
      window.prompt("Enlace para generar o validar el QR de esta mesa:", url);
    }
  };

  const downloadFromUrl = async (url, filename) => {
    try {
      const response = await fetch(url, { mode: "cors" });
      if (!response.ok) throw new Error("No se pudo descargar el archivo.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast("Abrimos el QR en una pestaña para guardarlo.", "ok");
    }
  };

  const pdfSafeText = (value = "") => String(value)
    .replace(/[Ⓡⓡ]/g, "®")
    .replace(/[\r\n\t]+/g, " ")
    .trim();

  const pdfAccentColor = () => {
    const value = String(state.business?.accent_color || "#f05a28").trim();
    const match = /^#([0-9a-f]{6})$/i.exec(value);
    if (!match) return [240, 90, 40];
    return [
      parseInt(match[1].slice(0, 2), 16),
      parseInt(match[1].slice(2, 4), 16),
      parseInt(match[1].slice(4, 6), 16)
    ];
  };

  const fitPdfText = (pdf, text, maxWidth, maxFontSize, minFontSize = 6) => {
    let fontSize = maxFontSize;
    pdf.setFontSize(fontSize);
    while (fontSize > minFontSize && pdf.getTextWidth(text) > maxWidth) {
      fontSize -= 0.5;
      pdf.setFontSize(fontSize);
    }
    return fontSize;
  };

  const drawQrCutMarks = (pdf, x, y, size) => {
    const mark = 2;
    const offset = 0.8;
    pdf.setDrawColor(150, 156, 166);
    pdf.setLineWidth(0.15);
    [[x, y], [x + size, y], [x, y + size], [x + size, y + size]].forEach(([cornerX, cornerY], index) => {
      const horizontalDirection = index % 2 === 0 ? -1 : 1;
      const verticalDirection = index < 2 ? -1 : 1;
      pdf.line(cornerX + horizontalDirection * offset, cornerY, cornerX + horizontalDirection * (offset + mark), cornerY);
      pdf.line(cornerX, cornerY + verticalDirection * offset, cornerX, cornerY + verticalDirection * (offset + mark));
    });
  };

  const drawQrPdfCard = async (pdf, table, x, y) => {
    const cardSize = 60;
    const [red, green, blue] = pdfAccentColor();
    const rawName = pdfSafeText(table.table_name);
    const fallbackName = `MESA ${table.table_number}`;
    const primaryName = (rawName || fallbackName).toUpperCase();
    const normalizedPrimary = primaryName.replace(/\s+/g, "");
    const normalizedFallback = fallbackName.replace(/\s+/g, "");
    const secondaryName = normalizedPrimary === normalizedFallback ? "ESCANEA EL CODIGO" : fallbackName;
    const businessName = pdfSafeText(state.business?.business_name || "Servicio a la mesa").toUpperCase();
    const qrDataUrl = await cachedQrDataUrl(qrTextForTable(table), 1000);

    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(30, 35, 43);
    pdf.setLineWidth(0.25);
    pdf.roundedRect(x, y, cardSize, cardSize, 1.2, 1.2, "FD");
    pdf.setFillColor(red, green, blue);
    pdf.rect(x, y, cardSize, 1.6, "F");

    pdf.setTextColor(92, 99, 112);
    pdf.setFont("helvetica", "bold");
    fitPdfText(pdf, businessName, 43, 6, 3.8);
    pdf.text(businessName, x + cardSize / 2, y + 5.1, { align: "center" });

    pdf.setTextColor(20, 23, 29);
    fitPdfText(pdf, primaryName, 52, 12.5, 7.5);
    pdf.text(primaryName, x + cardSize / 2, y + 10.1, { align: "center" });

    pdf.setTextColor(red, green, blue);
    pdf.setFont("helvetica", "bold");
    fitPdfText(pdf, secondaryName, 48, 5.7, 4.8);
    pdf.text(secondaryName, x + cardSize / 2, y + 12.8, { align: "center" });

    pdf.addImage(qrDataUrl, "PNG", x + 10.2, y + 14.2, 39.6, 39.6, undefined, "FAST");

    pdf.setTextColor(74, 81, 92);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(5.5);
    pdf.text("ORDENA Y SOLICITA ATENCION DESDE TU MESA", x + cardSize / 2, y + 57.2, { align: "center" });
    drawQrCutMarks(pdf, x, y, cardSize);
  };

  const downloadQrPdf = async (tables) => {
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) {
      toast("No se pudo cargar el generador de PDF. Revisa la conexion e intenta de nuevo.", "error", "pdf-library-missing");
      return;
    }
    const printableTables = (tables || []).filter(Boolean);
    if (!printableTables.length) {
      toast("Selecciona al menos una mesa para generar el PDF.", "error", "no-qr-selection");
      return;
    }
    const downloadButton = $("#downloadSelectedQrs");
    if (downloadButton) {
      downloadButton.disabled = true;
      downloadButton.innerHTML = `${icon("loader-circle", 18)} Generando PDF...`;
      refreshIcons();
    }
    try {
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const columns = 3;
      const rows = 4;
      const cardsPerPage = columns * rows;
      const cardSize = 60;
      const gap = 5;
      const startX = 10;
      const startY = 21;
      for (let index = 0; index < printableTables.length; index += 1) {
        if (index > 0 && index % cardsPerPage === 0) pdf.addPage("a4", "portrait");
        const pageIndex = index % cardsPerPage;
        const column = pageIndex % columns;
        const row = Math.floor(pageIndex / columns);
        await drawQrPdfCard(pdf, printableTables[index], startX + column * (cardSize + gap), startY + row * (cardSize + gap));
      }
      const filename = printableTables.length === 1
        ? `qr-mesa-${printableTables[0].table_number}-6x6.pdf`
        : `qr-${printableTables.length}-mesas-6x6.pdf`;
      pdf.save(filename);
      toast(`${printableTables.length} ${printableTables.length === 1 ? "QR listo" : "QR listos"} en PDF de 6 x 6 cm.`);
    } catch (error) {
      console.error(error);
      toast("No se pudo generar el PDF de los QR. Intenta de nuevo.", "error", "qr-pdf-failed");
    } finally {
      renderQrBatchControls();
    }
  };

  const downloadQr = async (id) => {
    const table = state.tables.find((entry) => String(entry.id) === String(id));
    if (table) await downloadQrPdf([table]);
  };

  const downloadSelectedQrs = async () => {
    const tables = state.tables.filter((table) => state.selectedTableQrIds.has(String(table.id)));
    await downloadQrPdf(tables);
  };

  const regenerateQr = async (id) => {
    const table = state.tables.find((entry) => entry.id === id);
    if (!table) return;
    if (!confirm(`Rehacer el QR de ${tableLabel(table)}? El QR impreso anterior dejara de funcionar.`)) return;
    const nextCode = `mesa-${table.table_number}-${uid().slice(0, 8)}`;
    const saved = await db(
      state.sb
        .from("restaurant_tables")
        .update({ qr_code: nextCode, qr_image_url: null })
        .eq("id", id)
        .select("*")
        .single(),
      null
    );
    if (saved) {
      await loadCore();
      renderAdmin();
      showAdminSection("menu");
      toast("QR regenerado. Descarga el nuevo antes de imprimir.");
    }
  };

  const editTable = (id) => {
    const table = state.tables.find((entry) => entry.id === id);
    const form = $("#tableForm");
    if (!table || !form) return;
    form.table_id.value = table.id;
    form.table_number.value = table.table_number;
    form.table_name.value = table.table_name || "";
    form.is_active.checked = table.is_active;
    renderTableFormQr();
    history.replaceState(null, "", "#menu");
    showAdminSection("menu");
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const editCategory = (id) => {
    const category = state.categories.find((entry) => entry.id === id);
    const form = $("#categoryForm");
    if (!category || !form) return;
    form.category_id.value = category.id;
    form.category_name.value = category.name;
    form.category_sort.value = category.sort_order || 0;
    form.category_active.checked = category.is_active;
    history.replaceState(null, "", "#menu");
    showAdminSection("menu");
  };

  const editItem = (id) => {
    const item = state.items.find((entry) => entry.id === id);
    const form = $("#itemForm");
    if (!item || !form) return;
    form.item_id.value = item.id;
    form.category_id.value = item.category_id || "";
    form.new_category.value = "";
    form.item_name.value = item.name;
    form.description.value = item.description || "";
    form.price.value = item.price;
    form.image_url.value = item.image_url || "";
    form.is_available.checked = item.is_available;
    form.sort_order.value = item.sort_order || 0;
    history.replaceState(null, "", "#menu");
    showAdminSection("menu");
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const deleteRow = async (table, id, label) => {
    if (!confirm(`Eliminar ${label}?`)) return;
    const property = {
      restaurant_tables: "tables",
      menu_categories: "categories",
      menu_items: "items"
    }[table];
    const original = property ? state[property] : null;
    if (property) state[property] = state[property].filter((entry) => entry.id !== id);
    if (property) persistBootstrapCache();
    renderAdmin();
    void (async () => {
      const removed = await retryQuiet(
        () => state.sb.from(table).delete().eq("id", id).select("*").single(),
        4
      );
      if (removed) return;
      if (property) state[property] = original;
      if (property) persistBootstrapCache();
      renderAdmin();
      toast("No se pudo eliminar. Se restauro el registro.", "error", `delete-failed:${table}:${id}`);
    })();
  };

  const bindAdmin = () => {
    $("#businessForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveBusiness(event.currentTarget);
    });
    $("#tableForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveTable(event.currentTarget);
    });
    $("#tableForm")?.addEventListener("input", (event) => {
      if (event.target.name === "table_number") renderTableFormQr();
    });
    $("#categoryForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveCategory(event.currentTarget);
    });
    $("#itemForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveItem(event.currentTarget);
    });
    $("#consumptionForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await addManualConsumption(event.currentTarget);
    });
    $("#userForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveUser(event.currentTarget);
    });
    const waiterTableSearch = $("#waiterTableSearch");
    waiterTableSearch?.addEventListener("input", (event) => {
      renderWaiterTableSelect(event.currentTarget.value);
      showWaiterTableOptions();
    });
    waiterTableSearch?.addEventListener("focus", () => {
      renderWaiterTableSelect();
      showWaiterTableOptions();
    });
    waiterTableSearch?.addEventListener("click", showWaiterTableOptions);
    waiterTableSearch?.addEventListener("keydown", async (event) => {
      const combobox = $("#waiterTableCombobox");
      const buttons = $$('[data-waiter-table]', $("#waiterTableOptions"));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        showWaiterTableOptions();
        const currentIndex = Number(combobox?.dataset.activeIndex ?? -1);
        const nextIndex = currentIndex < 0
          ? (event.key === "ArrowDown" ? 0 : buttons.length - 1)
          : (event.key === "ArrowDown" ? currentIndex + 1 : currentIndex - 1);
        setWaiterTableActiveIndex(nextIndex);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const selectedId = combobox?.dataset.selectedId || (buttons.length === 1 ? buttons[0].dataset.waiterTable : "");
        if (selectedId) await openWaiterTableChoice(selectedId);
        else showWaiterTableOptions();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeWaiterTableOptions();
      }
    });
    $("#waiterTableOptions")?.addEventListener("click", async (event) => {
      const option = event.target.closest("[data-waiter-table]");
      if (option) await openWaiterTableChoice(option.dataset.waiterTable);
    });
    $("#waiterTableForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const selectedId = $("#waiterTableCombobox")?.dataset.selectedId;
      if (selectedId) await openWaiterTableChoice(selectedId);
      else showWaiterTableOptions();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest("#waiterTableCombobox")) closeWaiterTableOptions();
    });
    $("#logoutButton")?.addEventListener("click", logoutAdmin);

    document.addEventListener("change", async (event) => {
      if (event.target.matches("[data-select-table-qr]")) {
        const id = String(event.target.dataset.selectTableQr);
        if (event.target.checked) state.selectedTableQrIds.add(id);
        else state.selectedTableQrIds.delete(id);
        event.target.closest(".table-manager-row")?.classList.toggle("is-selected", event.target.checked);
        renderQrBatchControls();
        return;
      }
      if (event.target.id === "alertFilter") {
        state.alertFilter = event.target.value || "all";
        renderAlerts();
        return;
      }
      if (event.target.matches("[data-upload]")) {
        await uploadAsset(event.target.files[0], event.target.dataset.upload);
      }
      if (event.target.name === "menu_item_id" && event.target.closest("#consumptionForm")) {
        const item = state.items.find((entry) => entry.id === event.target.value);
        const form = event.target.form;
        form.item_name.value = item?.name || "";
        form.unit_price.value = item?.price || 0;
      }
    });

    document.addEventListener("click", async (event) => {
      const navLink = event.target.closest(".admin-sidebar nav a");
      if (navLink) {
        event.preventDefault();
        const section = navLink.getAttribute("href")?.replace("#", "") || "dashboard";
        history.replaceState(null, "", `#${section}`);
        showAdminSection(section);
        if (section === "users" && state.currentUser?.role === "admin") {
          void loadUsers().then(renderUsers);
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      if (event.target.closest("[data-alert-card]")) stopAlarm();

      const target = event.target.closest("button");
      if (!target) return;
      if (target.id === "enableSound") {
        await unlockAlarm();
      }
      if (target.id === "selectAllTableQrs") {
        state.selectedTableQrIds = new Set(state.tables.map((table) => String(table.id)));
        renderTableManager();
      }
      if (target.id === "clearTableQrs") {
        state.selectedTableQrIds.clear();
        renderTableManager();
      }
      if (target.id === "downloadSelectedQrs") await downloadSelectedQrs();
      if (target.dataset.acceptRequest) await acceptRequest(target.dataset.acceptRequest);
      if (target.dataset.sendBill) await sendBillToClient(target.dataset.sendBill);
      if (target.dataset.closeSession) await closeSession(target.dataset.closeSession);
      if (target.dataset.addManual) openConsumptionDialog(target.dataset.addManual);
      if (target.dataset.editConsumption) editConsumption(target.dataset.sessionId, target.dataset.editConsumption);
      if (target.dataset.closeDialog !== undefined) target.closest("dialog")?.close();
      if (target.dataset.copyQr) await copyQr(target.dataset.copyQr);
      if (target.dataset.downloadQr) await downloadQr(target.dataset.downloadQr);
      if (target.dataset.regenerateQr) await regenerateQr(target.dataset.regenerateQr);
      if (target.dataset.viewSession) {
        history.replaceState(null, "", "#accounts");
        showAdminSection("accounts");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      if (target.dataset.editTable) editTable(target.dataset.editTable);
      if (target.dataset.editCategory) editCategory(target.dataset.editCategory);
      if (target.dataset.editItem) editItem(target.dataset.editItem);
      if (target.dataset.editUser) editUser(target.dataset.editUser);
      if (target.dataset.deleteTable) await deleteRow("restaurant_tables", target.dataset.deleteTable, "esta mesa");
      if (target.dataset.deleteCategory) await deleteRow("menu_categories", target.dataset.deleteCategory, "esta categoria");
      if (target.dataset.deleteItem) await deleteRow("menu_items", target.dataset.deleteItem, "este producto");
    });

    window.addEventListener("hashchange", () => {
      showAdminSection(location.hash.replace("#", "") || "dashboard");
    });
  };

  const subscribeAdmin = () => {
    const channel = state.sb
      .channel("admin", { config: { broadcast: { self: false }, private: false } })
      .on("broadcast", { event: "refresh" }, refreshAdminNow)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeStatus("En vivo", "live");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setRealtimeStatus("Respaldo cada 30 segundos", "fallback");
        }
      });
    state.subscriptions.push(channel);
  };

  const tableFromScannedValue = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    let code = raw;
    try {
      const url = new URL(raw);
      code = url.searchParams.get("mesa") || url.searchParams.get("table") || url.searchParams.get("t") || raw;
    } catch (error) { /* El lector puede entregar solo el codigo. */ }
    return state.tables.find((table) =>
      String(table.id) === code ||
      String(table.table_number) === code ||
      String(table.qr_code || "").toLowerCase() === code.toLowerCase()
    ) || null;
  };

  const openScannedTable = async (value) => {
    let table = tableFromScannedValue(value);
    if (!table) {
      await loadCore();
      table = tableFromScannedValue(value);
    }
    if (!table) {
      toast("No se encontro la mesa seleccionada. Actualiza la pagina e intenta de nuevo.", "error", "unknown-service-table");
      return;
    }
    toast(`${tableLabel(table)} seleccionada.`, "ok", `selected:${table.id}`);
    let session = state.sessions.find((entry) => entry.table_id === table.id && entry.status === "open");
    if (!session) {
      session = await dbQuiet(
        state.sb.from("table_sessions").select("*")
          .eq("table_id", table.id).eq("status", "open")
          .order("opened_at", { ascending: false }).limit(1).maybeSingle(),
        null
      );
    }
    if (!session) {
      session = await dbQuiet(
        state.sb.from("table_sessions").insert({
          table_id: table.id,
          status: "open",
          assigned_waiter_id: state.currentUser?.id || null
        }).select("*").single(),
        null
      );
      // Si otro dispositivo abrió la mesa al mismo tiempo, usa la sesión ganadora.
      if (!session) {
        session = await dbQuiet(
          state.sb.from("table_sessions").select("*")
            .eq("table_id", table.id).eq("status", "open")
            .order("opened_at", { ascending: false }).limit(1).maybeSingle(),
          null
        );
      }
    }
    if (session) {
      session = {
        ...session,
        restaurant_tables: table,
        assigned_waiter: state.currentUser,
        session_items: session.session_items || []
      };
      state.sessions = [session, ...state.sessions.filter((entry) => entry.id !== session.id)];
    }
    if (session && state.currentUser?.id && session.assigned_waiter_id !== state.currentUser.id) {
      session = { ...session, assigned_waiter_id: state.currentUser.id, assigned_waiter: state.currentUser };
      state.sessions = state.sessions.map((entry) => entry.id === session.id ? session : entry);
      await dbQuiet(
        state.sb.from("table_sessions").update({ assigned_waiter_id: state.currentUser.id }).eq("id", session.id).select("*").single(),
        null
      );
    }
    if (!session) {
      toast("No fue posible abrir la mesa.", "error", `open-table-failed:${table.id}`);
      return;
    }
    renderAdminLive();
    history.replaceState(null, "", "#accounts");
    showAdminSection("accounts");
    openConsumptionDialog(session.id);
  };

  const stopQrCamera = () => {
    state.qrCameraStream?.getTracks?.().forEach((track) => track.stop());
    state.qrCameraStream = null;
    const video = $("#qrCamera");
    if (video) {
      video.hidden = true;
      video.srcObject = null;
    }
  };

  const startQrCamera = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      toast("La camara necesita abrirse desde una pagina HTTPS segura.", "error", "qr-camera-insecure");
      return;
    }
    stopQrCamera();
    const video = $("#qrCamera");
    if (!video) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      state.qrCameraStream = stream;
      video.srcObject = stream;
      video.hidden = false;
      await video.play();

      let detector = null;
      if ("BarcodeDetector" in window) {
        try {
          const supported = typeof BarcodeDetector.getSupportedFormats === "function"
            ? await BarcodeDetector.getSupportedFormats()
            : ["qr_code"];
          if (supported.includes("qr_code")) detector = new BarcodeDetector({ formats: ["qr_code"] });
        } catch (error) { /* Safari y algunos WebViews exponen una implementacion incompleta. */ }
      }

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!detector && (typeof window.jsQR !== "function" || !context)) {
        stopQrCamera();
        toast("No se pudo cargar el lector QR. Recarga la pagina e intenta de nuevo.", "error", "qr-reader-unavailable");
        return;
      }

      const scan = async () => {
        if (!state.qrCameraStream) return;
        let value = "";
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
          if (detector) {
            try {
              const codes = await detector.detect(video);
              value = codes[0]?.rawValue || "";
            } catch (error) {
              detector = null;
            }
          }
          // Algunos móviles exponen BarcodeDetector pero no decodifican video correctamente.
          if (!value && typeof window.jsQR === "function" && context) {
            const scale = Math.min(1, 720 / video.videoWidth);
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            value = window.jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" })?.data || "";
          }
        }
        if (value) {
          stopQrCamera();
          await openScannedTable(value);
          return;
        }
        window.requestAnimationFrame(scan);
      };
      scan();
    } catch (error) {
      stopQrCamera();
      const errorName = String(error?.name || "");
      const message = errorName === "NotAllowedError" || errorName === "SecurityError"
        ? "Permiso de camara bloqueado. Habilitalo en la configuracion del sitio y vuelve a intentar."
        : errorName === "NotFoundError" || errorName === "OverconstrainedError"
          ? "No se encontro una camara disponible en este dispositivo."
          : errorName === "NotReadableError" || errorName === "AbortError"
            ? "La camara esta siendo usada por otra aplicacion. Cierrala y vuelve a intentar."
            : "No se pudo iniciar la camara. Recarga la pagina y vuelve a intentar.";
      toast(message, "error", `qr-camera-${errorName || "failed"}`);
    }
  };

  const setQrScanStatus = (message, tone = "scanning") => {
    const status = $("#qrScanStatus");
    if (!status) return;
    status.hidden = !message;
    status.className = `qr-scan-status ${tone}`;
    status.textContent = message;
  };

  const stopPowerfulQrCamera = async (keepStatus = false) => {
    const controls = state.qrScannerControls;
    state.qrScannerControls = null;
    try { controls?.stop?.(); } catch (error) { /* El stream pudo cerrarse antes. */ }
    const scanner = state.qrScanner;
    state.qrScanner = null;
    try { scanner?.reset?.(); } catch (error) { /* Limpieza opcional de ZXing. */ }
    stopQrCamera();
    const reader = $("#qrReader");
    if (reader) {
      reader.hidden = true;
      reader.innerHTML = "";
    }
    const choice = $("#qrCameraChoice");
    if (choice) choice.hidden = true;
    if (!keepStatus) setQrScanStatus("");
  };

  const handleDecodedQr = async (decodedText) => {
    const value = String(decodedText || "").trim();
    if (!value || state.qrScanBusy) return;
    state.qrScanBusy = true;
    const input = $("#waiterQrForm [name='qr_value']");
    if (input) input.value = value;
    setQrScanStatus("QR detectado. Abriendo la mesa...", "detected");
    try {
      await stopPowerfulQrCamera(true);
      await openScannedTable(value);
    } finally {
      state.qrScanBusy = false;
    }
  };

  const qrCameraErrorMessage = (error) => {
    const detail = `${error?.name || ""} ${error?.message || error || ""}`.toLowerCase();
    if (/notallowed|permission|denied|security/.test(detail)) {
      return "Permiso de camara bloqueado. Habilitalo para este sitio y vuelve a intentar.";
    }
    if (/notfound|devicesnotfound|overconstrained/.test(detail)) {
      return "No se encontro una camara trasera disponible.";
    }
    if (/notreadable|trackstarterror|ocupada|in use/.test(detail)) {
      return "La camara esta ocupada por otra aplicacion. Cierrala y vuelve a intentar.";
    }
    return "No se pudo iniciar el lector. Prueba con Leer foto QR.";
  };

  const cameraName = (device, index) => device.label?.trim() || `Camara ${index + 1}`;

  const cameraScore = (device) => {
    const label = String(device?.label || "").toLowerCase();
    let score = 0;
    if (/back|rear|environment|trasera|posterior|traseira/.test(label)) score += 100;
    if (/front|user|frontal/.test(label)) score -= 200;
    if (/ultra|tele|macro|depth|0[.,]5|2x|3x/.test(label)) score -= 70;
    if (/\b1x\b|back camera$|rear camera$|camara trasera$|cámara trasera$/.test(label)) score += 40;
    return score;
  };

  const populateQrCameraSelect = (devices, selectedId) => {
    state.qrCameraDevices = devices || [];
    const select = $("#qrCameraSelect");
    const choice = $("#qrCameraChoice");
    if (!select || !choice) return;
    select.innerHTML = state.qrCameraDevices.map((device, index) =>
      `<option value="${escapeHTML(device.deviceId)}">${escapeHTML(cameraName(device, index))}</option>`
    ).join("");
    if (selectedId && state.qrCameraDevices.some((device) => device.deviceId === selectedId)) {
      select.value = selectedId;
    }
    choice.hidden = state.qrCameraDevices.length < 2;
  };

  const improveQrCameraFocus = async () => {
    const track = $("#qrCamera")?.srcObject?.getVideoTracks?.()[0];
    if (!track?.applyConstraints || !track?.getCapabilities) return;
    try {
      const capabilities = track.getCapabilities();
      const advanced = [];
      if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
        advanced.push({ focusMode: "continuous" });
      }
      if (advanced.length) await track.applyConstraints({ advanced });
    } catch (error) { /* No todos los Safari aceptan restricciones avanzadas. */ }
  };

  const startPowerfulQrCamera = async (preferredDeviceId = "") => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      toast("La camara requiere abrir el panel desde HTTPS.", "error", "qr-camera-insecure");
      return;
    }
    if (typeof window.ZXingBrowser?.BrowserQRCodeReader !== "function") {
      toast("El motor ZXing no cargo. Recarga la pagina con conexion a internet.", "error", "qr-library-missing");
      return;
    }
    await stopPowerfulQrCamera();
    state.qrScanBusy = false;
    const video = $("#qrCamera");
    if (!video) return;
    video.hidden = false;
    setQrScanStatus("Solicitando la camara trasera...", "scanning");
    try {
      let cameras = [];
      try {
        cameras = await window.ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
      } catch (error) { /* Algunos Safari no enumeran dispositivos antes de autorizar. */ }
      const ranked = [...cameras].sort((a, b) => cameraScore(b) - cameraScore(a));
      const labelsAvailable = cameras.some((entry) => String(entry.label || "").trim());
      let selectedId = preferredDeviceId && cameras.some((entry) => entry.deviceId === preferredDeviceId)
        ? preferredDeviceId
        : labelsAvailable ? ranked[0]?.deviceId : "";
      populateQrCameraSelect(cameras, selectedId);
      const scanner = new window.ZXingBrowser.BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 70,
        delayBetweenScanSuccess: 500,
        tryPlayVideoTimeout: 5000
      });
      state.qrScanner = scanner;
      const videoConstraints = selectedId
        ? { deviceId: { exact: selectedId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } };
      const controls = await scanner.decodeFromConstraints({ video: videoConstraints, audio: false }, video, (result, error) => {
        if (result) void handleDecodedQr(result.getText?.() || result.text || String(result));
        // NotFoundException es normal: ZXing la emite en cada cuadro sin codigo.
        if (error && !/notfoundexception/i.test(String(error?.name || error))) {
          console.debug("QR frame:", error);
        }
      });
      state.qrScannerControls = controls;
      state.qrCameraStream = video.srcObject;
      await improveQrCameraFocus();
      selectedId = video.srcObject?.getVideoTracks?.()[0]?.getSettings?.().deviceId || selectedId;

      // Los nombres completos aparecen despues de conceder permiso en varios moviles.
      try {
        cameras = await window.ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
        populateQrCameraSelect(cameras, selectedId);
      } catch (error) { /* El lector ya funciona aunque el navegador oculte la lista. */ }
      setQrScanStatus("Lector ZXing activo. Acerca el QR hasta que se vea nitido; si no enfoca, cambia la camara.", "scanning");
    } catch (error) {
      await stopPowerfulQrCamera();
      const message = qrCameraErrorMessage(error);
      setQrScanStatus(message, "error");
      toast(message, "error", "qr-advanced-camera-failed");
    }
  };

  const scanQrImage = async (file) => {
    if (typeof window.ZXingBrowser?.BrowserQRCodeReader !== "function") {
      toast("El motor ZXing no cargo. Recarga la pagina.", "error", "qr-library-missing-file");
      return;
    }
    await stopPowerfulQrCamera();
    setQrScanStatus("Analizando la imagen...", "scanning");
    const imageUrl = URL.createObjectURL(file);
    try {
      const scanner = new window.ZXingBrowser.BrowserQRCodeReader();
      const result = await scanner.decodeFromImageUrl(imageUrl);
      await handleDecodedQr(result.getText?.() || result.text || String(result));
    } catch (error) {
      await stopPowerfulQrCamera();
      const message = "No se encontro un QR legible en la imagen. Acercate y evita reflejos.";
      setQrScanStatus(message, "error");
      toast(message, "error", "qr-image-not-readable");
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  };

  const applyCurrentUser = () => {
    document.body.dataset.userRole = state.currentUser?.role || "";
    $("#currentUserName") && ($("#currentUserName").textContent = state.currentUser?.full_name || "Sin sesion");
    $("#currentUserRole") && ($("#currentUserRole").textContent = state.currentUser?.role === "admin" ? "Administrador" : "Mesero");
    document.body.classList.toggle("admin-authenticated", Boolean(state.currentUser));
  };

  const ADMIN_USER_CACHE_KEY = "la_licorera_17_admin_user_v1";

  const waitForAdminLogin = async () => {
    const storedToken = localStorage.getItem("la_licorera_17_admin_token") || "";
    let cachedUser = null;
    try { cachedUser = JSON.parse(localStorage.getItem(ADMIN_USER_CACHE_KEY) || "null"); } catch (error) { /* cache opcional */ }
    if (storedToken && cachedUser?.id) {
      state.authToken = storedToken;
      state.currentUser = cachedUser;
      state.sb.setAuthToken(storedToken);
      applyCurrentUser();
      void state.sb.rpc("getCurrentUser", { auth_token: storedToken }).then(({ data, error }) => {
        if (data) {
          state.currentUser = data;
          localStorage.setItem(ADMIN_USER_CACHE_KEY, JSON.stringify(data));
          applyCurrentUser();
          return;
        }
        if (error && /sesion vencida|autenticacion requerida|usuario inactivo/i.test(String(error.message || ""))) {
          localStorage.removeItem("la_licorera_17_admin_token");
          localStorage.removeItem(ADMIN_USER_CACHE_KEY);
          location.reload();
        }
      }).catch(() => undefined);
      return true;
    }
    if (storedToken) {
      const user = await dbQuiet(state.sb.rpc("getCurrentUser", { auth_token: storedToken }), null);
      if (user) {
        state.authToken = storedToken;
        state.currentUser = user;
        state.sb.setAuthToken(storedToken);
        localStorage.setItem(ADMIN_USER_CACHE_KEY, JSON.stringify(user));
        applyCurrentUser();
        return true;
      }
      localStorage.removeItem("la_licorera_17_admin_token");
      localStorage.removeItem(ADMIN_USER_CACHE_KEY);
    }

    setLoading(false);
    applyCurrentUser();
    refreshIcons();
    return new Promise((resolve) => {
      const form = $("#loginForm");
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("[type='submit']");
        const errorBox = $("#loginError");
        if (button) button.disabled = true;
        if (errorBox) errorBox.textContent = "";
        const session = await dbQuiet(state.sb.rpc("login", {
          username: form.username.value.trim(),
          pin: form.pin.value
        }), null);
        if (!session?.token || !session?.user) {
          if (errorBox) errorBox.textContent = "Usuario o PIN incorrectos.";
          if (button) button.disabled = false;
          return;
        }
        state.authToken = session.token;
        state.currentUser = session.user;
        state.sb.setAuthToken(session.token);
        localStorage.setItem("la_licorera_17_admin_token", session.token);
        localStorage.setItem(ADMIN_USER_CACHE_KEY, JSON.stringify(session.user));
        applyCurrentUser();
        setLoading(true);
        resolve(true);
      });
    });
  };

  const loadUsers = async () => {
    if (state.currentUser?.role !== "admin") {
      state.users = state.currentUser ? [state.currentUser] : [];
      return;
    }
    state.users = await dbQuiet(state.sb.rpc("listUsers", { auth_token: state.authToken }), []) || [];
  };

  const renderUsers = () => {
    const list = $("#usersList");
    if (!list) return;
    list.innerHTML = state.users.length
      ? state.users.map((user) => `
          <div class="manager-row">
            <div class="category-token">${icon(user.role === "admin" ? "shield" : "user-round", 17)}</div>
            <div>
              <strong>${escapeHTML(user.full_name)}</strong>
              <span>@${escapeHTML(user.username)} · ${user.role === "admin" ? "Administrador" : "Mesero"} · ${user.is_active ? "Activo" : "Inactivo"}</span>
            </div>
            <button class="icon-btn" data-edit-user="${user.id}" aria-label="Editar usuario">${icon("pencil", 16)}</button>
          </div>`).join("")
      : emptyState("Sin usuarios", "Crea el equipo operativo.", "users");
    refreshIcons();
  };

  const saveUser = async (form) => {
    const isEditing = Boolean(form.user_id.value);
    const username = form.username.value.trim().toLowerCase();
    const pin = form.pin.value.trim();
    if (!/^[a-z0-9._-]{3,40}$/.test(username) || (!isEditing && !/^\d{4,12}$/.test(pin)) || (pin && !/^\d{4,12}$/.test(pin))) {
      toast("Revisa el usuario y usa un PIN numerico de 4 a 12 digitos.", "error", "invalid-user-fields");
      return;
    }
    const payload = {
      auth_token: state.authToken,
      id: form.user_id.value || uid(),
      full_name: form.full_name.value.trim(),
      username,
      pin,
      role: form.role.value,
      is_active: form.is_active.checked
    };
    const temporaryId = payload.id;
    const optimistic = { ...payload, id: temporaryId };
    const original = [...state.users];
    state.users = isEditing
      ? state.users.map((user) => user.id === payload.id ? { ...user, ...optimistic } : user)
      : [...state.users, optimistic];
    form.reset();
    form.user_id.value = "";
    form.is_active.checked = true;
    renderUsers();
    const saved = await retryQuiet(() => state.sb.rpc("saveUser", payload), 3);
    if (!saved) {
      state.users = original;
      renderUsers();
      toast("No se pudo guardar el usuario. Se restauro la lista.", "error", "save-user-failed");
      return;
    }
    state.users = state.users.map((user) => user.id === temporaryId || user.id === saved.id ? saved : user);
    renderUsers();
  };

  const editUser = (id) => {
    const user = state.users.find((entry) => entry.id === id);
    const form = $("#userForm");
    if (!user || !form) return;
    form.user_id.value = user.id;
    form.full_name.value = user.full_name || "";
    form.username.value = user.username || "";
    form.pin.value = "";
    form.role.value = user.role || "waiter";
    form.is_active.checked = user.is_active !== false;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const logoutAdmin = async () => {
    const token = state.authToken;
    state.authToken = "";
    state.currentUser = null;
    state.sb.setAuthToken("");
    localStorage.removeItem("la_licorera_17_admin_token");
    localStorage.removeItem(ADMIN_USER_CACHE_KEY);
    applyCurrentUser();
    void dbQuiet(state.sb.rpc("logout", { auth_token: token }), null);
    location.reload();
  };

  const initAdmin = async () => {
    setLoading(true);
    const pendingScan = new URLSearchParams(location.search).get("scan") || "";
    await waitForAdminLogin();
    state.soundEnabled = localStorage.getItem("waiter_alarm_enabled") === "1";
    const initialSection = pendingScan ? "service" : (location.hash.replace("#", "") || "dashboard");
    renderAdmin();
    renderUsers();
    showAdminSection(initialSection);
    updateAlarmButton();
    bindAdmin();
    armAlarmOnFirstGesture();
    subscribeAdmin();
    startAlarmLoop();
    setLoading(false);
    await loadBootstrap();
    renderAdmin();
    showAdminSection(initialSection);
    renderTableFormQr();
    startAdminPolling();
    void loadUsers().then(renderUsers);
    if (pendingScan) {
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete("scan");
      history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}#service`);
      await openScannedTable(pendingScan);
    }
    // El shell queda visible al instante; el snapshot pesado llega sin bloquear la interfaz.
    void refreshAdminNow();
  };

  const init = async () => {
    state.page = document.body.dataset.page || "";
    if (!connect()) {
      document.body.innerHTML = `
        <main class="setup-screen">
          <div class="setup-card">
            ${icon("database-zap", 34)}
            <h1>Conecta Supabase</h1>
            <p>Configura la URL y la anon key en <strong>app.js</strong>, y ejecuta <strong>supabase-schema.sql</strong>.</p>
          </div>
        </main>
      `;
      refreshIcons();
      return;
    }
    if (state.page === "client") {
      window.addEventListener("online", () => {
        flushRequestOutbox();
        flushBillResolutionOutbox();
      });
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
          flushRequestOutbox();
          flushBillResolutionOutbox();
        }
      });
      flushRequestOutbox();
    }
    if (state.page === "admin") await initAdmin();
    if (state.page === "client") await initClient();
    refreshIcons();
  };

  return { init };
})();

document.addEventListener("DOMContentLoaded", App.init);
