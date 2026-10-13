const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const slice = (a, b) => source.slice(source.indexOf('  const ' + a + ' ='), source.indexOf('  const ' + b + ' =', source.indexOf('  const ' + a + ' =') + 1));
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };

function harness() {
  const state = { soundEnabled: true, soundPrimed: false, announcedRequestIds: new Set(), alertAnnouncementQueue: [], requests: [] };
  const events = new Map(), timers = new Map(), storage = new Map(), calls = [], voices = [];
  let blocked = true, timerId = 0;
  class Audio {
    constructor() { this.volume = 1; this.handlers = new Map(); }
    async play() { calls.push({ audio: this, volume: this.volume, blocked }); if (blocked) throw Error('NotAllowedError'); }
    pause() {}
    addEventListener(name, fn) { this.handlers.set(name, fn); }
    removeEventListener(name) { this.handlers.delete(name); }
  }
  class Utterance { constructor(text) { this.text = text; } }
  const alarm = new Audio();
  const window = { SpeechSynthesisUtterance: Utterance,
    speechSynthesis: { resume() {}, getVoices: () => [{ lang: 'es-CO' }], speak: u => voices.push(u), cancel() {} },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id) };
  const context = vm.createContext({ state, Audio, RECEIPT_SOUND: 'receipt.mp3', window, SpeechSynthesisUtterance: Utterance,
    document: { addEventListener(name, fn, options) { events.set(name, { fn, options }); } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    getAlarmAudio: () => alarm, updateAlarmButton() {}, toast() {}, hasOpenAdminChatForRequest: () => false,
    activeRequests: () => state.requests.filter(r => r.status === 'pending'), requestVoiceText: r => 'Mesa ' + r.table_id + ' solicita al mesero.',
    Date, Map, Set });
  vm.runInContext(slice('getReceiptAudio', 'latestClientBill') + slice('speakAlertRequests', 'disableAlarm')
    + slice('primeAlertVoice', 'startAlarmLoop')
    + ';globalThis.api={playReceiptSound,playClientChatReceipt,playAdminChatReceipt,armClientSoundsOnFirstGesture,armAlarmOnFirstGesture,playAlarm};', context);
  return { state, calls, voices, storage, api: context.api, alarm,
    unblock() { blocked = false; }, block() { blocked = true; },
    async gesture(name) { const event = events.get(name); assert.ok(event); assert.equal(event.options.capture, true); event.fn({ target: { closest: () => null } }); await settle(); },
    async finishUnlock() { for (const [id, timer] of [...timers]) if (timer.ms === 450 || timer.ms === 1100) { timers.delete(id); timer.fn(); } await settle(); },
    async finishTone() { alarm.handlers.get('ended')?.(); await settle(); }
  };
}

test('Admin conserva solicitudes anteriores al gesto y anuncia tono y voz al terminar el deslizamiento', async () => {
  const h = harness(); h.api.armAlarmOnFirstGesture();
  h.state.requests = [{ id: 'a', table_id: '12', status: 'pending' }];
  h.api.playAlarm(); await settle();
  assert.equal(h.calls.length, 0); assert.equal(h.state.alertAnnouncementQueue.length, 1);
  await h.gesture('touchstart'); assert.equal(h.state.soundPrimed, false);
  h.unblock(); await h.gesture('touchend'); assert.equal(h.state.soundPrimed, true);
  await h.finishUnlock(); await h.finishTone();
  assert.ok(h.voices.some(u => u.volume === 0), 'Prepara la voz dentro del gesto.');
  assert.equal(h.voices.filter(u => u.volume === 1).length, 1);
  h.api.playAlarm(); await settle(); assert.equal(h.voices.filter(u => u.volume === 1).length, 1);
});

test('Un bloqueo posterior del tono conserva la solicitud para el siguiente toque sin anunciarla dos veces', async () => {
  const h = harness(); h.api.armAlarmOnFirstGesture(); h.unblock(); await h.gesture('pointerup');
  h.state.requests = [{ id: 'a', table_id: '20', status: 'pending' }];
  h.block(); h.api.playAlarm(); await settle();
  assert.equal(h.state.soundPrimed, false); assert.equal(h.state.alertAnnouncementQueue.length, 1);
  h.unblock(); await h.gesture('click'); await h.finishUnlock(); await h.finishTone();
  assert.equal(h.voices.filter(u => u.volume === 1).length, 1); assert.equal(h.state.alertAnnouncementQueue.length, 0);
});

test('Index recupera el sonido de atención y cuenta bloqueados al terminar el gesto usando el mismo audio', async () => {
  const h = harness(); h.api.armClientSoundsOnFirstGesture();
  await h.api.playClientChatReceipt('atendida'); await h.api.playReceiptSound('cuenta');
  assert.equal(h.state.pendingReceiptSounds.size, 2);
  h.unblock(); await h.gesture('touchend');
  assert.equal(h.state.pendingReceiptSounds.size, 0); assert.equal(h.storage.get('receipt_sound_cuenta'), '1');
  assert.equal(new Set(h.calls.map(c => c.audio)).size, 1, 'Reutiliza el elemento desbloqueado en móvil.');
  const count = h.calls.length; await h.api.playReceiptSound('cuenta'); assert.equal(h.calls.length, count);
});

test('Los gestos no reactivan una alarma que el administrador desactivó', async () => {
  const h = harness(); h.state.soundEnabled = false; h.api.armAlarmOnFirstGesture();
  h.unblock(); await h.gesture('touchend'); assert.equal(h.calls.length, 0); assert.equal(h.voices.length, 0);
});

test('Index reintenta un aviso pendiente si el navegador vuelve a bloquear el audio', async () => {
  const h = harness(); h.api.armClientSoundsOnFirstGesture(); h.unblock(); await h.gesture('pointerup');
  h.block(); await h.api.playClientChatReceipt('atendida'); assert.equal(h.state.receiptSoundPrimed, false);
  h.unblock(); await h.gesture('click'); assert.equal(h.state.pendingReceiptSounds.size, 0);
});
