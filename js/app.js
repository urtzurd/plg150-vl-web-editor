// PLG150-VL editor: UI wiring, state, librarian and performance controls.
(function () {
  'use strict';

  const { P } = VL;
  const $ = id => document.getElementById(id);
  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------------------------------------------------------------- storage
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('plg150vl.' + key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('plg150vl.' + key, JSON.stringify(value)); return true; }
      catch { return false; }
    },
  };

  // ---------------------------------------------------------------- native parameter sets
  // Not part of the voice: sent immediately when changed (the board can't be
  // read back, so these are the editor's last sent values).
  const NOTE_CHOICES = range(128, i => [i, VL.noteName(i)]);
  const NATIVE_SYS = [
    { addr: 0x10, label: 'Breath Mode', max: 2, def: 0, opts: ['BC/WX', 'Velocity', 'Touch EG'], title: 'Source of the breath control for voices whose Breath Mode is "System": breath controller or WX, key velocity, or velocity + aftertouch (Touch EG)' },
    { addr: 0x0B, label: 'Breath Control No', max: 1, def: 0, opts: ['BC (CC 2)', 'Expression (CC 11)'], title: 'Control change used as breath control in BC/WX mode' },
    { addr: 0x0C, label: 'Breath Curve', min: 0x30, max: 0x50, def: 0x40, offset: 64, title: 'Breath control response: minus = much variation from a little breath, plus = needs more breath (BC/WX mode)' },
    { addr: 0x0F, label: 'WX Lip', max: 1, def: 0, opts: ['Normal', 'Expand'], title: 'Use the WX lip pitch bend (-16..+32) as is, or expand it to -64..+63 (recommended for the "tight lip" WX mode)' },
    { addr: 0x0D, label: 'WX Lip Lock', max: 1, def: 0, opts: ['Off', 'On'], title: 'WX Lip Lock' },
    { addr: 0x0E, label: 'Breath Set Lock', max: 1, def: 0, opts: ['Off', 'On'], title: 'Breath Set Lock' },
    { addr: 0x11, label: 'Velocity Depth', def: 0x30, title: 'Velocity breath mode: depth' },
    { addr: 0x12, label: 'Velocity Offset', def: 0x50, title: 'Velocity breath mode: offset' },
    { addr: 0x13, label: 'Touch EG Time', def: 0x2A, title: 'Touch EG breath mode: time' },
    { addr: 0x14, label: 'AT Low Depth', def: 0x1B, title: 'Touch EG breath mode: aftertouch low depth' },
    { addr: 0x15, label: 'AT Low Offset', def: 0x50, title: 'Touch EG breath mode: aftertouch low offset' },
    { addr: 0x16, label: 'AT High Depth', def: 0x25, title: 'Touch EG breath mode: aftertouch high depth' },
    { addr: 0x17, label: 'AT High Offset', def: 0x65, title: 'Touch EG breath mode: aftertouch high offset' },
  ];
  const NATIVE_PART = [
    { addr: 0x17, label: 'Amp Scale Break Pt', def: 0x3C, choices: NOTE_CHOICES, title: 'Amplitude key scaling break point' },
    { addr: 0x18, label: 'Amp Scale Depth', def: 64, offset: 64, title: 'Amplitude key scaling depth (−64 to +63)' },
    { addr: 0x19, label: 'Filter Scale Break Pt', def: 0x3C, choices: NOTE_CHOICES, title: 'Filter cutoff key scaling break point' },
    { addr: 0x1A, label: 'Filter Scale Depth', def: 64, offset: 64, title: 'Filter cutoff key scaling depth (−64 to +63)' },
  ];
  for (const d of NATIVE_SYS) Object.assign(d, { src: 'nsys', key: 'ns' + d.addr });
  for (const d of NATIVE_PART) Object.assign(d, { src: 'npart', key: 'np' + d.addr });
  for (const d of [...NATIVE_SYS, ...NATIVE_PART]) {
    d.min = d.min || 0;
    if (d.max == null) d.max = 127;
    d.fmt = 'num';
  }
  const defaults = ds => Object.fromEntries(ds.map(d => [d.addr, d.def]));

  // ---------------------------------------------------------------- settings & state
  const ROM_NAMES = Object.keys(window.VL_BANKS || {});
  // the built-in bank of the 6 Power User custom voices (named "Custom" before)
  const POWER_USER = 'VL1 Power User', OLD_POWER_USER = 'Custom';
  const settings = Object.assign({
    out: '', device: 0, channel: 0, part: 0,
    liveSend: true, autoSend: true, storeToPlg: false,
    velocity: 100, octave: 0, bank: 'Internal', perfHidden: false, gridExpanded: false,
  }, store.get('settings', {}));
  const saveSettings = () => store.set('settings', settings);
  if (settings.bank === OLD_POWER_USER) settings.bank = POWER_USER;

  const state = {
    banks: {},          // name -> { kind, voices: Uint8Array[], rom: bool, modified: bool }
    bankName: null,
    index: 0,
    edit: VL.newInternal(),
    original: VL.newInternal(),
    edited: false,
    comparing: false,
    storeMode: false,
    lastParam: '',
    nsys: Object.assign(defaults(NATIVE_SYS), store.get('nsys', {})),
    npart: Object.assign(defaults(NATIVE_PART), store.get('npart', {})),
  };
  const romCache = {};
  const bank = () => state.banks[state.bankName];
  const shownVoice = () => (state.comparing ? state.original : state.edit);
  const kind = () => VL.kindOf(state.edit);

  function loadBanks() {
    for (const n of ROM_NAMES) {
      const b = window.VL_BANKS[n];
      romCache[n] = { kind: b.kind, voices: VL.splitBank(VL.base64ToBytes(b.data), b.kind) };
      state.banks[n] = { kind: b.kind, voices: romCache[n].voices.map(VL.cloneVoice), rom: true, modified: false };
    }
    const saved = store.get('banks', {});
    // edits of the Power User bank saved under its old name
    if (saved[OLD_POWER_USER] && !saved[POWER_USER] && saved[OLD_POWER_USER].kind === 'custom') {
      saved[POWER_USER] = saved[OLD_POWER_USER];
      delete saved[OLD_POWER_USER];
      store.set('banks', saved);
    }
    for (const n in saved) {
      try {
        const { kind: k, data } = saved[n];
        const voices = VL.splitBank(VL.base64ToBytes(data), k);
        if (!voices.length || voices.length > 128) continue;
        state.banks[n] = { kind: k, voices, rom: ROM_NAMES.includes(n), modified: true };
      } catch { /* skip damaged entry */ }
    }
    if (!Object.keys(state.banks).length) state.banks.User = { kind: 'internal', voices: range(64, () => VL.newInternal()), rom: false, modified: true };
    updateCustomNames();
  }
  function persistBanks() {
    const out = {};
    for (const n in state.banks) {
      const b = state.banks[n];
      if (b.modified) out[n] = { kind: b.kind, data: VL.bytesToBase64(VL.joinBank(b.voices)) };
    }
    if (!store.set('banks', out)) toast('Browser storage is full: save your banks as .syx files', true);
  }
  // Internal voices that use a custom voice show its name: taken from the
  // "VL1 Power User" bank, or the first custom bank.
  function updateCustomNames() {
    const pu = state.banks[POWER_USER];
    const b = pu && pu.kind === 'custom' ? pu
      : Object.values(state.banks).find(x => x.kind === 'custom');
    VL.setCustomNames(b ? b.voices.map(v => VL.getName(v).trimEnd()) : []);
  }
  const bankLabel = n => n;
  // a custom bank with more voices than the board's 6 custom slots (e.g. a .lib file)
  const CUSTOM_SLOTS = 6;
  const isLibrary = b => b.kind === 'custom' && b.voices.length > CUSTOM_SLOTS;
  // LCD prefix: the kind of the shown voice
  const bankShort = () => (VL.kindOf(shownVoice()) === 'custom' ? 'CST' : 'INT');

  // ---------------------------------------------------------------- MIDI
  const midi = new Midi();
  const hex = bytes => Array.from(bytes, b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

  // Logs outgoing messages (the PLG150-VL never transmits, so there is no MIDI In).
  function log(bytes, label) {
    const isPerf = bytes[0] < 0xF0;
    if (isPerf && !$('logNotes').checked) return;
    const el = $('log');
    const shown = bytes.length > 48 ? hex(bytes.slice(0, 24)) + ` … (${bytes.length} bytes) … ` + hex(bytes.slice(-3)) : hex(bytes);
    el.textContent += `${new Date().toLocaleTimeString()} ${label ? '[' + label + '] ' : ''}${shown}\n`;
    if (el.textContent.length > 60000) el.textContent = el.textContent.slice(-40000);
    el.scrollTop = el.scrollHeight;
  }
  midi.onSend = (b, label) => log(b, label);

  function requireOutput() {
    if (midi.output) return true;
    toast('No MIDI output selected. Click "Enable MIDI" and choose the port.', true);
    return false;
  }

  function refreshPorts() {
    const sel = $('midiOut');
    const ports = midi.outputs();
    sel.innerHTML = '';
    sel.appendChild(new Option('— none —', ''));
    for (const p of ports) sel.appendChild(new Option(p.name, p.id));
    const match = ports.find(p => p.id === settings.out) || ports.find(p => p.name === settings.out);
    sel.value = match ? match.id : '';
    midi.selectOutput(sel.value);
    const st = $('midiStatus');
    st.textContent = midi.output ? 'Out: ' + midi.output.name : 'No output';
    st.className = 'status ' + (midi.output ? 'ok' : 'err');
  }

  async function enableMidi() {
    if (!midi.supported) {
      $('midiStatus').textContent = 'Web MIDI not supported (use Chrome or Edge)';
      $('midiStatus').className = 'status err';
      return;
    }
    try {
      await midi.init();
      midi.onStateChange = refreshPorts;
      refreshPorts();
      $('midiConnect').textContent = 'Rescan';
    } catch {
      $('midiStatus').textContent = 'MIDI access denied (SysEx permission needed)';
      $('midiStatus').className = 'status err';
    }
  }

  // Live parameter changes are coalesced so dragging a value sends at most
  // one message per parameter every 20 ms.
  const pending = new Map();
  let flushTimer = null;
  // Native settings are always sent; voice edits follow "Live edit".
  function queueSend(key, bytes, label, always) {
    if (!midi.output) return;
    if (!always && (!settings.liveSend || state.comparing)) return;
    pending.set(key, [bytes, label]);
    if (!flushTimer) flushTimer = setTimeout(flushPending, 20);
  }
  function flushPending() {
    flushTimer = null;
    for (const [bytes, label] of pending.values()) midi.send(bytes, label);
    pending.clear();
  }

  // While a multi-message transfer runs, an overlay with a wait cursor blocks
  // clicks and a capture-phase listener blocks keys, so nothing changes under
  // it. Held notes are released first (the overlay would swallow note-offs).
  // Elements with .busy-exempt (the bank Stop button) stay clickable.
  let busyCount = 0;
  function setBusy() {
    const busy = busyCount > 0;
    document.body.classList.toggle('busy', busy);
    $('busyOverlay').hidden = !busy;
    $('midiStatus').classList.toggle('sending', busy);
    if (busy) {
      allOff();
      const a = document.activeElement;
      if (a && a !== document.body && !a.classList.contains('busy-exempt')) a.blur();
    }
  }
  async function whileBusy(fn) {
    busyCount++;
    setBusy();
    try { return await fn(); } finally { busyCount--; setBusy(); }
  }
  window.addEventListener('keydown', e => {
    if (!busyCount) return;
    if (e.key === 'Escape' && bankSending) bankStop = true;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // The live message of a voice parameter (null: the parameter has none)
  function liveMessage(d, raw) {
    const dev = settings.device;
    if (Array.isArray(d.live)) return Sysex.param(dev, ...d.live, VL.dataBytes(d, raw));
    if (d.live === 'part') return Sysex.part(dev, settings.part, d.partAddr, [raw]);
    return null;
  }
  // Current voice messages for the edit buffer. A custom voice is sent whole
  // (Common Misc + Element bulk dumps). An internal voice has no model data of
  // its own, so its settings are sent as parameter changes onto the voice the
  // host has selected (which should be its source voice).
  const voiceMessages = v => {
    const dev = settings.device;
    if (VL.kindOf(v) === 'custom') {
      return [[Sysex.currentMisc(dev, v), 'Current voice common'], [Sysex.currentElement(dev, v), 'Current voice element']];
    }
    return VL.list.filter(d => d.live && VL.has(v, d)).map(d => [liveMessage(d, VL.get(v, d)), d.key]);
  };
  async function sendVoice(v = state.edit) {
    if (!requireOutput()) return;
    pending.clear();
    const custom = VL.kindOf(v) === 'custom';
    await whileBusy(() => midi.sendSequence(voiceMessages(v), custom ? 40 : 8));
  }
  // Messages that write voice i of a bank into the board's memory
  const slotMessages = (k, i, v) => {
    const dev = settings.device;
    return k === 'custom'
      ? [[Sysex.customCommon(dev, i, v), `Custom voice ${i + 1} common`], [Sysex.customElement(dev, i, v), `Custom voice ${i + 1} element`]]
      : [[Sysex.internal(dev, i, v), `Internal voice ${i + 1}`]];
  };

  let bankSending = false, bankStop = false;
  async function sendBank() {
    if (bankSending) { bankStop = true; return; }
    const b = bank();
    if (isLibrary(b)) {
      toast(`"${state.bankName}" is a library of ${b.voices.length} custom voices, but the PLG150-VL has 6 custom voice slots. Store the voices you want in a 6-voice Custom bank, then send that bank.`, true);
      return;
    }
    if (!requireOutput()) return;
    const what = b.kind === 'custom' ? `Custom bank (33/2) voices 1–${b.voices.length}` : `Internal bank (33/3) voices 1–${b.voices.length}`;
    if (!confirm(`Send the ${b.voices.length} voices of "${bankLabel(state.bankName)}" to the PLG150-VL ${what}?\n\nThis replaces those voices on the board.`)) return;
    const list = b.voices.flatMap((v, i) => slotMessages(b.kind, i, v));
    bankSending = true; bankStop = false;
    const btn = $('sendBank');
    btn.classList.add('on');
    btn.classList.add('busy-exempt');
    btn.title = 'Stop the bank transfer (Esc)';
    const ok = await whileBusy(() => midi.sendSequence(list, b.kind === 'custom' ? 120 : 60, {
      shouldStop: () => bankStop,
      onProgress: (i, n) => { btn.textContent = `Stop (${i}/${n})`; },
    }));
    btn.classList.remove('busy-exempt');
    bankSending = false;
    updateSendBankTitle();
    btn.classList.remove('on');
    btn.textContent = 'Send Bank';
    toast(ok ? `Sent "${bankLabel(state.bankName)}" to the PLG ${what}` : 'Bank transfer stopped', !ok);
  }

  // ---------------------------------------------------------------- toast
  let toastTimer;
  function toast(msg, err) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 3500);
  }

  // ---------------------------------------------------------------- parameter access
  // A control is bound to a voice parameter (VL.P entries) or to a native
  // parameter (src nsys / npart).
  const bound = [];
  const byKey = new Map();

  function getRaw(d) {
    if (d.src) return state[d.src][d.addr];
    return VL.get(shownVoice(), d);
  }
  const sgn = n => (n > 0 ? '+' + n : String(n));
  const fmtValue = (d, raw) => {
    if (d.choices) return (d.choices.find(c => c[0] === raw) || [raw, String(raw)])[1];
    if (d.src && !d.opts) return d.offset === 64 ? sgn(raw - 64) : String(raw - (d.offset || 0));
    if (d.src) return d.opts[raw - d.min] ?? String(raw);
    return VL.format(d, raw, shownVoice());
  };
  const labelOf = d => (d.src ? d.label : VL.labelOf(d, shownVoice()));
  const isVoiceParam = d => !d.src;
  const maxOf = d => (d.src ? d.max : VL.maxOf(d, shownVoice()));
  // a voice parameter that the shown voice doesn't have (e.g. portamento mode of an internal voice)
  const missing = d => isVoiceParam(d) && !VL.has(shownVoice(), d);
  const optsOf = d => (d.src ? d.opts : VL.optsOf(d, shownVoice()));

  function commit(d, raw) {
    raw = clamp(raw, d.min, maxOf(d));
    const dev = settings.device;
    if (d.src) {
      state[d.src][d.addr] = raw;
      store.set(d.src, state[d.src]);
      const msg = d.src === 'npart' ? Sysex.part(dev, settings.part, d.addr, [raw]) : Sysex.system(dev, d.addr, [raw]);
      queueSend(d.key, msg, 'Native ' + d.label, true);
      refreshKey(d.key);
      return;
    }
    if (state.comparing || missing(d)) return;
    if (d.model) { commitModel(d, raw); return; }
    VL.set(state.edit, d, raw);
    markEdited();
    const msg = liveMessage(d, raw);
    if (msg) queueSend('v' + d.key, msg, d.key);
    afterParamChange(d, raw);
  }

  // Model parameters (Model tab). Breakpoint notes stay in order, and editing
  // the last breakpoint in use updates the padding copies after it.
  function commitModel(d, raw) {
    const v = state.edit, bp = d.bp;
    const k = bp ? VLModel.used(v, bp) : 0;
    if (d.bpNote) {
      const [lo, hi] = VLModel.noteRange(v, bp, d.bpIndex, k);
      raw = clamp(raw, lo, hi);
    }
    VL.set(v, d, raw);
    if (bp && d.bpIndex === k - 1) VLModel.pad(v, bp, k);
    modelChanged();
    state.lastParam = `${labelOf(d)} = ${fmtValue(d, VL.get(v, d))}`;
    // Extended Res. Freq. changes how the Child Reed Res. Freq. bytes are read
    if (d.refreshAll) refreshAll();
    refreshKey(d.key);
    if (bp) refreshKey(bp.key);
    updateLcd();
  }
  function modelChanged() {
    markEdited();
    updateModelInfo();
    queueModelSend();
  }

  // The model has no parameter change messages that are known to work, so a
  // model edit sends the whole Current Voice element (1387 bytes, about 0.45 s
  // over a MIDI cable). Like a voice change, the transfer shows the wait cursor
  // and the busy overlay, which block clicks and keys; so it is sent once you
  // stop: 400 ms after the last change, and not while you drag a value or
  // type in a model field (then as soon as you finish).
  let modelTimer = null;
  const MODEL_SEND_DELAY = 400;
  const typingInModel = () => {
    const a = document.activeElement;
    return !!(a && a.tagName === 'INPUT' && a.closest('#tab-model'));
  };
  function queueModelSend() {
    if (!midi.output || !settings.liveSend || state.comparing || kind() !== 'custom') return;
    clearTimeout(modelTimer);
    modelTimer = setTimeout(sendModelNow, MODEL_SEND_DELAY);
  }
  function sendModelNow() {
    modelTimer = null;
    if (!midi.output || state.comparing || kind() !== 'custom') return;
    if (dragSession || typingInModel()) { modelTimer = setTimeout(sendModelNow, 150); return; }
    const bytes = Sysex.currentElement(settings.device, state.edit);
    whileBusy(() => midi.sendSequence([[bytes, 'Current voice element (model)']], 0));
  }

  function afterParamChange(d, raw) {
    state.lastParam = `${labelOf(d)} = ${fmtValue(d, raw)}`;
    if (d.key === 'srcBank') {
      // the program list depends on the bank; custom voices are 1-6
      if (VL.get(state.edit, P.srcProg) > VL.maxOf(P.srcProg, state.edit)) VL.set(state.edit, P.srcProg, 0);
      refreshKey('srcProg');
    }
    if (d.ctrlGroup) refreshGroup(d.ctrlGroup); else refreshKey(d.key);
    updateLcd();
  }

  function register(c) {
    bound.push(c);
    const key = c.d.key;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
    c.refresh();
    return c;
  }
  const refreshKey = key => (byKey.get(key) || []).forEach(c => c.refresh());
  // a VL control: its source, depth/curve (active state follows the source) and graph
  function refreshGroup(id) {
    const c = VL.CONTROLS.find(x => x.id === id);
    for (const d of [c.src, c.depth, c.curve, c.upper, c.lower, c.mode]) if (d) refreshKey(d.key);
    drawControl(c);
  }
  function refreshAll() {
    applyKind();
    bound.forEach(c => c.refresh());
    VL.CONTROLS.forEach(drawControl);
    updateModelInfo();
    updateLcd();
  }

  // Compare: voice controls are read-only and show the original values;
  // unchanged ones are greyed out, changed ones blink.
  function compareState(d) {
    if (!state.comparing || !isVoiceParam(d) || missing(d)) return { cmp: false, changed: false };
    return { cmp: true, changed: VL.get(state.original, d) !== VL.get(state.edit, d) };
  }
  function applyCompare(wrap, d) {
    const { cmp, changed } = compareState(d);
    wrap.classList.toggle('cmp-same', cmp && !changed);
    wrap.classList.toggle('cmp-changed', changed);
    return cmp;
  }
  const activeOf = d => (isVoiceParam(d) ? VL.isActive(d, shownVoice()) : true);

  // ---------------------------------------------------------------- vertical drag
  // The full range is covered in about 250 px of travel (2–12 px per step);
  // hold Shift for single steps every 12 px. onClick runs for a press and
  // release without movement.
  let dragSession = null;
  function attachDrag(target, d, { isDisabled = () => false, onClick, threshold = 2, focus = false } = {}) {
    target.addEventListener('pointerdown', e => {
      if (e.button !== 0 || isDisabled()) return;
      if (e.target.tagName === 'INPUT' && e.target !== target) return;   // typing in a knob's value box
      if (dragSession) dragSession.end(false);
      e.preventDefault();
      const a = document.activeElement;
      if (a && a.tagName === 'INPUT' && a !== target) a.blur();
      if (focus) target.focus({ preventScroll: true });
      const startY = e.clientY, start = getRaw(d);
      const px = clamp(250 / (maxOf(d) - d.min + 1), 2, 12);
      let moved = false;
      const move = ev => {
        if (ev.pointerId !== e.pointerId) return;
        const dy = startY - ev.clientY;
        if (!moved) {
          if (Math.abs(dy) < threshold) return;
          moved = true;
          document.body.classList.add('dragging');
        }
        ev.preventDefault();
        const raw = clamp(start + Math.round(dy / (ev.shiftKey ? 12 : px)), d.min, maxOf(d));
        if (raw !== getRaw(d)) commit(d, raw);
      };
      const end = clicked => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('blur', onCancel);
        document.body.classList.remove('dragging');
        dragSession = null;
        if (clicked && !moved && onClick) onClick(e);
      };
      const onUp = ev => { if (ev.pointerId === e.pointerId) end(true); };
      const onCancel = () => end(false);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('blur', onCancel);
      dragSession = { end };
    });
  }

  // keyboard stepping for focusable controls
  function attachKeys(target, d, isDisabled) {
    target.addEventListener('keydown', e => {
      if (isDisabled() || (e.target !== target && e.target.tagName === 'INPUT')) return;
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      let raw;
      if (step) raw = getRaw(d) + step;
      else if (e.key === 'Home') raw = d.min;
      else if (e.key === 'End') raw = maxOf(d);
      else return;
      e.preventDefault();
      commit(d, clamp(raw, d.min, maxOf(d)));
    });
  }

  // ---------------------------------------------------------------- widgets
  // Knob: drag up/down, arrow keys when focused, double-click for the default.
  function makeKnob(parent, d, o = {}) {
    const wrap = h('div', 'knob' + (o.cls ? ' ' + o.cls : ''));
    wrap.tabIndex = 0;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('knob-svg');
    const k = Graphics.createKnob(svg);
    const val = h('span', 'knob-val');
    const lab = h('span', 'knob-lbl');
    wrap.append(svg, val, lab);
    place(parent, wrap, o, 1);
    const disabled = () => (state.comparing && isVoiceParam(d)) || missing(d);
    // Click the value (without dragging) to type a new one.
    const startEdit = () => {
      if (disabled() || wrap.querySelector('.knob-edit')) return;
      const input = h('input', 'knob-edit');
      input.type = 'text';
      input.value = val.textContent;
      input.setAttribute('aria-label', labelOf(d));
      val.hidden = true;
      val.after(input);
      input.focus();
      input.select();
      let done = false;
      const finish = apply => {
        if (done) return;
        done = true;
        if (apply && input.value.trim() !== val.textContent) {
          const raw = parseValue(d, input.value);
          if (raw == null) toast(`"${input.value}" is not a valid ${labelOf(d)} value`, true);
          else if (raw !== getRaw(d)) commit(d, raw);
          else showParam(d);
        }
        input.remove();
        val.hidden = false;
        wrap.focus({ preventScroll: true });
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        e.stopPropagation();
      });
      input.addEventListener('blur', () => finish(true));
    };
    attachDrag(wrap, d, { isDisabled: disabled, focus: true, onClick: e => { if (e.target === val) startEdit(); } });
    attachKeys(wrap, d, disabled);
    wrap.addEventListener('dblclick', e => {
      if (e.target === val || e.target.tagName === 'INPUT') return;   // the value is click-to-type
      if (!disabled()) commit(d, d.def);
    });
    wrap.addEventListener('focus', () => showParam(d));
    return register({
      d, wrap,
      refresh() {
        const raw = getRaw(d);
        const max = maxOf(d);
        const frac = (raw - d.min) / (max - d.min || 1);
        const bip = isVoiceParam(d) ? VL.isBipolar(d) : d.offset === 64;
        const center = d.center != null ? d.center : 64;
        const from = bip ? (center - d.min) / (max - d.min) : 0;
        Graphics.updateKnob(k, frac, from);
        val.textContent = missing(d) ? '—' : fmtValue(d, raw);
        const label = o.label != null ? o.label : labelOf(d);
        lab.textContent = label;
        wrap.title = missing(d) ? `${o.title || labelOf(d)}: not in this kind of voice`
          : `${o.title || labelOf(d)}: ${fmtValue(d, raw)}\nDrag up/down (Shift = fine)\nDouble-click = default (${fmtValue(d, d.def)})`;
        wrap.classList.toggle('inactive', !activeOf(d));
        wrap.setAttribute('aria-label', `${label} ${val.textContent}`);
        applyCompare(wrap, d);
      },
    });
  }

  // Lamp list: a panel button that steps through the options, with one lamp
  // per option (click a lamp to pick it).
  function makeLamps(parent, d, o = {}) {
    const wrap = h('div', 'lamps' + (o.cls ? ' ' + o.cls : ''));
    const btn = h('button', 'pbtn');
    btn.type = 'button';
    const list = h('ul', 'lamp-list');
    const lab = h('span', 'lamps-lbl', o.label || '');
    const col = h('div', 'lamps-btncol');
    col.append(btn, lab);
    wrap.append(col, list);
    place(parent, wrap, o, 2);
    const labels = o.labels || optsOf(d);
    const lamps = labels.map((t, i) => {
      const li = h('li', 'lamp', t);
      li.addEventListener('click', () => { if (!disabled()) commit(d, d.min + i); });
      list.appendChild(li);
      return li;
    });
    const disabled = () => (state.comparing && isVoiceParam(d)) || missing(d);
    btn.addEventListener('click', () => {
      if (disabled()) return;
      const raw = getRaw(d);
      commit(d, raw >= maxOf(d) ? d.min : raw + 1);
    });
    btn.addEventListener('focus', () => showParam(d));
    return register({
      d, wrap,
      refresh() {
        const raw = getRaw(d);
        lamps.forEach((li, i) => li.classList.toggle('on', !missing(d) && raw === d.min + i));
        btn.title = missing(d) ? `${labelOf(d)}: not in this kind of voice` : `${labelOf(d)}: ${fmtValue(d, raw)} (click to step)`;
        btn.disabled = disabled();
        wrap.classList.toggle('inactive', !activeOf(d));
        applyCompare(wrap, d);
      },
    });
  }

  // Panel push button with an LED (on/off parameter)
  function makeToggle(parent, d, o = {}) {
    const wrap = h('div', 'toggle' + (o.cls ? ' ' + o.cls : ''));
    const btn = h('button', 'pbtn');
    btn.type = 'button';
    const led = h('span', 'led-dot');
    btn.appendChild(led);
    const lab = h('span', 'toggle-lbl', o.label || labelOf(d));
    wrap.append(btn, lab);
    place(parent, wrap, o, 1);
    const disabled = () => (state.comparing && isVoiceParam(d)) || missing(d);
    const isOn = () => getRaw(d) === (o.on ?? 1);
    btn.addEventListener('click', () => {
      if (disabled()) return;
      commit(d, isOn() ? (o.off ?? 0) : (o.on ?? 1));
    });
    btn.addEventListener('focus', () => showParam(d));
    return register({
      d, wrap,
      refresh() {
        const on = !missing(d) && isOn();
        btn.classList.toggle('lit', on);
        btn.setAttribute('aria-pressed', String(on));
        btn.title = `${o.title || labelOf(d)}: ${fmtValue(d, getRaw(d))}`;
        btn.disabled = disabled();
        wrap.classList.toggle('inactive', !activeOf(d));
        applyCompare(wrap, d);
      },
    });
  }

  // Dark LCD-style drop-down for long lists
  function makeLcdSelect(parent, d, o = {}) {
    const wrap = h('label', 'lcdsel' + (o.cls ? ' ' + o.cls : ''));
    const sel = h('select');
    const lab = h('span', 'lcdsel-lbl', o.label || '');
    wrap.append(sel, lab);
    place(parent, wrap, o, 2);
    let sig = '';
    sel.addEventListener('change', () => commit(d, +sel.value));
    sel.addEventListener('focus', () => showParam(d));
    return register({
      d, wrap,
      refresh() {
        const ls = optsOf(d) || range(maxOf(d) - d.min + 1, i => fmtValue(d, d.min + i));
        const s = ls.join('|');
        if (s !== sig) {
          sig = s;
          sel.innerHTML = '';
          ls.forEach((t, i) => sel.appendChild(new Option(t, d.min + i)));
        }
        const raw = getRaw(d);
        if (![...sel.options].some(op => +op.value === raw)) sel.appendChild(new Option(String(raw), raw));
        sel.value = raw;
        sel.title = `${o.title || labelOf(d)}: ${fmtValue(d, raw)}`;
        sel.disabled = (state.comparing && isVoiceParam(d)) || missing(d);
        wrap.classList.toggle('inactive', !activeOf(d));
        applyCompare(wrap, d);
      },
    });
  }

  // Form field (Detail / Native pages): a select for lists and formatted
  // values, a drag number box for plain numbers.
  const NUMERIC_OFFSET = { num: 0, sgn: 0, s64: 64, st: 64, cent: 64 };
  function makeField(parent, d, o = {}) {
    const wrap = h('div', 'field' + (o.wide ? ' wide' : ''));
    const lab = h('span');
    wrap.appendChild(lab);
    const offset = d.offset != null ? d.offset : NUMERIC_OFFSET[d.fmt];
    const numeric = !d.opts && !d.choices && !d.fmtFn && offset != null && !o.select;
    const disabled = () => (state.comparing && isVoiceParam(d)) || missing(d);
    let input, sig = '';
    if (!numeric) {
      input = h('select');
      input.addEventListener('change', () => commit(d, +input.value));
      wrap.appendChild(input);
    } else {
      input = h('input');
      input.type = 'number';
      wrap.classList.add('num');
      input.min = d.min - offset; input.max = d.max - offset; input.step = 1;
      input.addEventListener('input', () => {
        if (input.value === '' || isNaN(+input.value)) return;
        commit(d, clamp(Math.round(+input.value) + offset, d.min, maxOf(d)));
      });
      input.addEventListener('change', () => c.refresh());
      input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') input.blur(); });
      const box = h('div', 'numbox spin');
      box.appendChild(input);
      input.addEventListener('focus', () => box.classList.add('editing'));
      input.addEventListener('blur', () => box.classList.remove('editing'));
      for (const [cls, step, text] of [['spin-up', 1, '▲'], ['spin-down', -1, '▼']]) {
        const btn = h('button', 'spin-btn ' + cls, text);
        btn.type = 'button';
        btn.tabIndex = -1;
        // the refresh leaves a focused input alone (it may be mid-typing), so the
        // stepped value is written to the box here
        btn.addEventListener('click', () => {
          if (disabled()) return;
          commit(d, clamp(getRaw(d) + step, d.min, maxOf(d)));
          input.value = getRaw(d) - offset;
        });
        box.appendChild(btn);
      }
      const focusBox = () => { input.focus(); input.select(); };
      // a click on the box focuses the input for typing, except on the ▲/▼ buttons
      attachDrag(box, d, {
        isDisabled: disabled,
        onClick: e => { if (!e.target.closest('.spin-btn') && document.activeElement !== input) focusBox(); },
      });
      attachDrag(lab, d, { isDisabled: disabled });
      wrap.appendChild(box);
    }
    parent.appendChild(wrap);
    input.addEventListener('focus', () => showParam(d));
    const c = register({
      d, wrap, input,
      refresh() {
        const raw = getRaw(d);
        lab.textContent = o.label || labelOf(d);
        wrap.title = (o.title || d.title || labelOf(d)) + (missing(d) ? ' (not in this kind of voice)' : '');
        if (!numeric) {
          const entries = d.choices ? d.choices
            : (optsOf(d) || range(maxOf(d) - d.min + 1, i => fmtValue(d, d.min + i))).map((t, i) => [d.min + i, t]);
          const s = entries.map(e => e[1]).join('|');
          if (s !== sig) {
            sig = s;
            input.innerHTML = '';
            for (const [val, t] of entries) input.appendChild(new Option(t, val));
          }
          if (![...input.options].some(op => +op.value === raw)) input.appendChild(new Option(String(raw), raw));
          input.value = raw;
        } else if (document.activeElement !== input) {
          input.value = raw - offset;
        }
        input.disabled = disabled();
        wrap.classList.toggle('inactive', !activeOf(d));
        applyCompare(wrap, d);
      },
    });
    return c;
  }

  // Typed knob value -> raw value. An exact match of any displayed value
  // (case/space-insensitive: "C#3", "Off", "+64") wins; otherwise the number in
  // the text picks the raw value whose displayed number is nearest, so
  // out-of-range numbers snap to the ends. null if unreadable.
  const ZERO_WORDS = { off: 0, c: 0 };
  function numberIn(text) {
    const t = text.toLowerCase().replace(/\s+/g, '').replace('−', '-');
    if (t in ZERO_WORDS) return ZERO_WORDS[t];
    const m = t.match(/[-+]?\d*\.?\d+/);
    if (!m) return null;
    return parseFloat(m[0]);
  }
  function parseValue(d, text) {
    const norm = x => x.toLowerCase().replace(/\s+/g, '').replace('−', '-');
    const want = norm(text);
    if (!want) return null;
    const entries = range(maxOf(d) - d.min + 1, i => [d.min + i, fmtValue(d, d.min + i)]);
    const exact = entries.find(([, f]) => norm(f) === want);
    if (exact) return exact[0];
    const n = numberIn(text);
    if (n == null) return null;
    let best = null, bestDist = Infinity;
    for (const [raw, f] of entries) {
      const fn = numberIn(f);
      if (fn == null) continue;
      const dist = Math.abs(fn - n);
      if (dist < bestDist) { best = raw; bestDist = dist; }
    }
    return best;
  }

  function showParam(d) {
    if (missing(d)) return;
    state.lastParam = `${labelOf(d)} = ${fmtValue(d, getRaw(d))}`;
    updateLcd();
  }

  // ---------------------------------------------------------------- voice page (main panel)
  // Every control sits on one panel-wide grid of 20 equal columns, so controls
  // line up with the blocks above and below. Blocks and their rows are CSS
  // subgrids; controls are placed by absolute column ("at"), one cell for a
  // knob or button, two or more for lamp lists and selectors. Narrow windows
  // fall back to wrapping rows (the placements are ignored).
  let curStart = 1;
  function place(parent, wrap, o, defSpan) {
    if (o.at) wrap.style.gridColumn = `${o.at - curStart + 1} / span ${o.span || defSpan}`;
    parent.appendChild(wrap);
  }
  const blocks = {};
  // col: first column, span: columns, row: panel grid row; kind: shown only for that kind of voice
  function block(id, title, o) {
    const b = h('section', 'blk' + (o.cls ? ' ' + o.cls : ''));
    b.style.gridColumn = `${o.col} / span ${o.span}`;
    b.style.gridRow = `${o.row} / span 1`;
    curStart = o.col;
    const head = h('div', 'blk-head');
    const h3 = h('h3', null, title);
    head.appendChild(h3);
    if (o.title) head.title = o.title;
    if (o.detail) {
      const btn = h('button', 'detail-btn', 'DETAIL');
      btn.type = 'button';
      btn.title = 'Show all parameters as a list';
      btn.addEventListener('click', () => showTab(o.detail));
      head.appendChild(btn);
    }
    b.appendChild(head);
    $('synth').appendChild(b);
    blocks[id] = { b, head, kind: o.kind };
    return b;
  }
  const row = parent => { const r = h('div', 'krow'); parent.appendChild(r); return r; };
  // a plain grid cell for custom content
  const cell = (parent, cls, at, span = 1) => {
    const c = h('div', cls);
    c.style.gridColumn = `${at - curStart + 1} / span ${span}`;
    parent.appendChild(c);
    return c;
  };

  const graphics = { resp: {} };
  // Panel layout of the twelve VL controls: 3 rows of 4 blocks
  const CONTROL_ROWS = [['pres', 'emb', 'tng', 'bnz'], ['scr', 'grl', 'thr', 'hrm'], ['dmp', 'abs', 'filt', 'amp']];

  function buildVoicePage() {
    // ---- row 1: voice, board voice / model, scaling / portamento
    let b = block('voice', 'VOICE', { col: 1, span: 9, row: 1, detail: 'detail' });
    let r = row(b);
    const nameCell = cell(r, 'lcdsel wide name-cell', 1, 2);
    nameCell.append(makeNameInput(), h('span', 'lcdsel-lbl', 'VOICE NAME'));
    makeKnob(r, P.level, { at: 3, label: 'LEVEL' });
    makeLamps(r, P.assign, { at: 4, label: 'ASSIGN', labels: ['BOTTOM', 'TOP', 'LAST'] });
    makeLamps(r, P.expMode, { at: 6, label: 'EXPRESSION', labels: ['BC', 'VOLUME'], title: 'Expression mode' });
    makeLamps(r, P.portaMode, { at: 8, label: 'PORTA MODE', labels: ['FULLTIME', 'FINGERED'] });

    // internal voices: the board voice they use, and key scaling
    b = block('source', 'BOARD VOICE', {
      col: 10, span: 7, row: 1, kind: 'internal', detail: 'detail',
      title: 'The Preset or Custom voice whose model this internal voice plays. To hear the voice while editing, select this board voice (or the internal voice) on the host synth.',
    });
    r = row(b);
    makeLamps(r, P.srcBank, { at: 10, label: 'BANK', labels: ['PRESET 1', 'PRESET 2', 'CUSTOM'] });
    makeLcdSelect(r, P.srcProg, { at: 12, span: 5, label: 'VOICE', cls: 'wide' });
    b = block('scaling', 'KEY SCALING', { col: 17, span: 4, row: 1, kind: 'internal' });
    r = row(b);
    makeKnob(r, P.ampBp, { at: 17, label: 'AMP BP', title: 'Amplitude scaling break point' });
    makeKnob(r, P.ampDepth, { at: 18, label: 'AMP DPT', title: 'Amplitude scaling depth' });
    makeKnob(r, P.fltBp, { at: 19, label: 'FLT BP', title: 'Filter cutoff scaling break point' });
    makeKnob(r, P.fltDepth, { at: 20, label: 'FLT DPT', title: 'Filter cutoff scaling depth' });

    // custom voices: the model, portamento and bend
    b = block('model', 'MODEL', {
      col: 10, span: 7, row: 1, kind: 'custom', detail: 'model',
      title: 'A custom voice carries its own VL model (driver, pipe/string, modifiers). Edit it on the Model tab (DETAIL).',
    });
    r = row(b);
    const elemCell = cell(r, 'lcdsel wide name-cell', 10, 3);
    elemCell.append(makeElementNameInput(), h('span', 'lcdsel-lbl', 'ELEMENT NAME'));
    graphics.model = cell(r, 'model-info', 13, 4);
    b = block('porta', 'PORTA / BEND', { col: 17, span: 4, row: 1, kind: 'custom', detail: 'detail' });
    r = row(b);
    makeToggle(r, P.portaSw, { at: 17, label: 'PORTA' });
    makeKnob(r, P.portaTime, { at: 18, label: 'TIME', title: 'Portamento time' });
    makeKnob(r, P.bendPitch, { at: 19, label: 'BEND ▲', title: 'Pitch bend range up' });
    makeKnob(r, P.bendLow, { at: 20, label: 'BEND ▼', title: 'Pitch bend range down' });

    // ---- rows 2-4: the twelve VL controls
    CONTROL_ROWS.forEach((ids, ri) => ids.forEach((id, ci) => {
      const c = VL.CONTROLS.find(x => x.id === id);
      const col = 1 + ci * 5;
      const bb = block('c-' + id, c.short, { col, span: 5, row: 2 + ri, title: `${c.name}: ${c.desc}`, cls: 'ctl-blk' });
      const rr = row(bb);
      if (c.mode) {
        makeLcdSelect(rr, c.src, { at: col, span: 2, label: 'SOURCE', cls: 'wide' });
        makeKnob(rr, c.upper, { at: col + 2, label: 'UPPER', title: 'Embouchure upper depth' });
        makeKnob(rr, c.lower, { at: col + 3, label: 'LOWER', title: 'Embouchure lower depth' });
        makeToggle(rr, c.mode, { at: col + 4, label: 'MIN BASE', title: 'Embouchure mode: lit = Minimum Base, unlit = Center Base' });
      } else {
        makeLcdSelect(rr, c.src, { at: col, span: 3, label: 'SOURCE', cls: 'wide' });
        makeKnob(rr, c.depth, { at: col + 3, label: 'DEPTH' });
        makeKnob(rr, c.curve, { at: col + 4, label: 'CURVE' });
      }
      graphics.resp[id] = Graphics.createResponse(bb);
    }));
  }

  function drawControl(c) {
    const v = shownVoice();
    const src = VL.get(v, c.src);
    const off = VL.SRC_OFF(src);
    const o = { off, srcLabel: VL.srcShort(src) };
    if (c.mode) Object.assign(o, { emb: true, upper: VL.get(v, c.upper), lower: VL.get(v, c.lower), minBase: VL.get(v, c.mode) === 1 });
    else Object.assign(o, { bipolar: src === 98, depth: VL.get(v, c.depth), curve: VL.get(v, c.curve) });
    Graphics.drawResponse(graphics.resp[c.id], o);
    const bb = blocks['c-' + c.id].b;
    bb.classList.toggle('off', off);
    bb.classList.toggle('hot', !off);
  }

  // custom voices: element name and a fingerprint of the model data
  function updateModelInfo() {
    const el = graphics.model;
    if (!el) return;
    el.innerHTML = '';
    const v = shownVoice();
    if (VL.kindOf(v) !== 'custom') return;
    const model = VL.elementData(v).subarray(0x3D);
    let hsh = 0x811C9DC5;
    for (const x of model) { hsh ^= x; hsh = Math.imul(hsh, 0x01000193) >>> 0; }
    const line = (t, cls) => { const d = h('div', cls, t); el.appendChild(d); };
    line(`VL MODEL  ${model.length} bytes`);
    line(`ID ${hsh.toString(16).toUpperCase().padStart(8, '0')}`);
    line('edit on the Model tab', 'dim');
    el.title = 'The VL model data of this custom voice (element bytes 3D-56A). The ID is a checksum, so you can tell voices that share a model; it changes when you edit the model.';
  }

  // Blocks and Detail panels that only exist for one kind of voice
  let shownKind = null;
  function applyKind() {
    const k = VL.kindOf(shownVoice());
    if (k === shownKind) return;
    shownKind = k;
    for (const id in blocks) if (blocks[id].kind) blocks[id].b.hidden = blocks[id].kind !== k;
    document.querySelectorAll('[data-kind]').forEach(el => { el.hidden = el.dataset.kind !== k; });
  }

  // ---------------------------------------------------------------- name inputs
  // Voice name (8 characters, both kinds): stored in the voice; the board has no
  // name display, so it isn't sent live. All copies are kept in sync by updateLcd().
  function makeNameInput() {
    const input = h('input', 'mono voice-name');
    input.type = 'text'; input.maxLength = 8;
    input.title = 'Voice name (8 characters)';
    input.addEventListener('input', () => {
      if (state.comparing) return;
      VL.setName(state.edit, input.value);
      markEdited();
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') input.blur(); });
    return input;
  }
  // Element name (10 characters, custom voices): sent as Current Voice element changes
  function makeElementNameInput() {
    const input = h('input', 'mono elem-name');
    input.type = 'text'; input.maxLength = 10;
    input.title = 'Element name (10 characters)';
    input.addEventListener('input', () => {
      if (state.comparing || kind() !== 'custom') return;
      VL.setElementName(state.edit, input.value);
      markEdited();
      const e = VL.elementData(state.edit);
      for (let i = 0; i < 10; i++) queueSend('en' + i, Sysex.param(settings.device, 0x20, 0x00, i, [e[i]]), 'Element name');
      updateLcd();
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') input.blur(); });
    return input;
  }

  // ---------------------------------------------------------------- detail page
  function panelBlock(parentId, title, o = {}) {
    const p = h('div', 'panel block' + (o.cls ? ' ' + o.cls : ''));
    if (o.kind) p.dataset.kind = o.kind;
    p.appendChild(h('h3', null, title));
    const f = h('div', o.table || 'fields');
    p.appendChild(f);
    if (o.note) p.appendChild(h('p', 'note', o.note));
    $(parentId).appendChild(p);
    return f;
  }

  function buildDetailPage() {
    let f = panelBlock('detailRow', 'Voice');
    const nameWrap = h('label', 'field');
    nameWrap.title = 'Voice name (8 characters)';
    nameWrap.append(h('span', null, 'Voice Name'), makeNameInput());
    f.appendChild(nameWrap);
    const elemWrap = h('label', 'field');
    elemWrap.dataset.kind = 'custom';
    elemWrap.title = 'Element name (10 characters)';
    elemWrap.append(h('span', null, 'Element Name'), makeElementNameInput());
    f.appendChild(elemWrap);
    makeField(f, P.level);
    makeField(f, P.assign);
    makeField(f, P.expMode, { title: 'Expression mode' });

    f = panelBlock('detailRow', 'Board Voice', {
      kind: 'internal',
      note: 'An internal voice plays the model of this Preset or Custom voice with its own control settings. Select the internal voice (bank 33/3) or this board voice on the host synth to hear it.',
    });
    makeField(f, P.srcBank);
    makeField(f, P.srcProg, { wide: true });
    makeField(f, P.ampBp);
    makeField(f, P.ampDepth);
    makeField(f, P.fltBp);
    makeField(f, P.fltDepth);

    f = panelBlock('detailRow', 'Pitch / Portamento', { kind: 'custom' });
    makeField(f, P.monoPoly);
    makeField(f, P.noteShift);
    makeField(f, P.detune);
    makeField(f, P.bendPitch, { label: 'Bend Up' });
    makeField(f, P.bendLow, { label: 'Bend Down' });
    makeField(f, P.portaSw);
    makeField(f, P.portaMode);
    makeField(f, P.portaTime);

    f = panelBlock('detailRow', 'Output', { kind: 'custom' });
    makeField(f, P.velDepth);
    makeField(f, P.velOffset);
    makeField(f, P.pan);
    makeField(f, P.dry);
    makeField(f, P.chorus);
    makeField(f, P.reverb);
    makeField(f, P.variation);

    // the twelve VL controls as a table
    f = panelBlock('detailRow', 'VL Controls', { cls: 'wide-block', table: 'ctab c4' });
    ['Control', 'Source', 'Depth / Upper', 'Curve / Lower', 'Emb. Mode'].forEach(t => f.appendChild(h('span', 'ctab-head', t)));
    for (const c of VL.CONTROLS) {
      const lbl = h('span', 'ctab-row', c.name);
      lbl.title = c.desc;
      f.appendChild(lbl);
      makeField(f, c.src, { select: true });
      if (c.mode) {
        makeField(f, c.upper);
        makeField(f, c.lower);
        makeField(f, c.mode);
      } else {
        makeField(f, c.depth);
        makeField(f, c.curve);
        f.appendChild(h('span', 'empty'));
      }
    }

    // custom voice common: controller routings
    f = panelBlock('detailRow', 'Controllers (custom voice common)', {
      kind: 'custom', cls: 'wide-block', table: 'ctab c5',
      note: 'These custom voice common settings (and the Pitch / Portamento and Output panels) are stored in the custom voice and sent with Send Bank or Store → PLG. They have no Current Voice message, so Live edit and Send Voice do not send them.',
    });
    ['', 'Pitch', 'Filter', 'Amplitude', 'LFO PMod', 'LFO FMod'].forEach(t => f.appendChild(h('span', 'ctab-head', t)));
    for (const [k, name] of VL.CTRL_ROWS) {
      f.appendChild(h('span', 'ctab-row', name));
      for (const p of ['Pitch', 'Filter', 'Amp', 'LfoP', 'LfoF']) makeField(f, P[k + p]);
    }
    f.appendChild(h('span', 'ctab-row', 'AC1 CC'));
    makeField(f, P.ac1No, { title: 'Control change number of Assignable Controller 1' });

    f = panelBlock('detailRow', 'Scale Tuning (cents)', { kind: 'custom', cls: 'wide-block' });
    for (let i = 0; i < 12; i++) makeField(f, P['tune' + i], { label: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][i] });
  }

  // ---------------------------------------------------------------- native page
  function buildNativePage() {
    let f = panelBlock('nativeRow', 'PLG150-VL System', {
      note: 'Breath Mode, Breath Control No and Breath Curve decide how a voice is "blown": with a breath controller (BC/WX), by key velocity, or by velocity plus aftertouch (Touch EG). Voices use them when their part Breath Mode is "System".',
    });
    NATIVE_SYS.forEach(d => makeField(f, d, { wide: d.addr === 0x0B }));
    f = panelBlock('nativeRow', 'VL Part (key scaling)');
    NATIVE_PART.forEach(d => makeField(f, d, { wide: true }));
  }
  // ---------------------------------------------------------------- model page
  // The physical model of a custom voice (model.js), on five pages after the
  // VL70m Expert Editor's: a block per section, a field per value, and for the
  // parameters that change across the keyboard a breakpoint table (built when
  // it is first opened).
  const openBp = new Set();
  function buildModelPage() {
    const root = $('tab-model');
    const none = h('p', 'note', 'Internal voices play the model of a board voice and have no model data of their own. Pick a custom voice (VL1 Power User or VLEditor banks) to edit its model.');
    none.dataset.kind = 'internal';
    root.appendChild(none);
    const wrap = h('div');
    wrap.dataset.kind = 'custom';
    root.appendChild(wrap);
    const nav = h('div', 'btn-row model-nav');
    wrap.append(nav, h('p', 'note', 'The physical model of this custom voice. Yamaha doesn\'t document it: the map comes from the VL70m Expert Editor, so some names and meanings are approximate. Small changes can make a voice silent or out of tune; Compare and the original in the bank are your undo. With Live edit on, each change sends the whole current voice element. BP parameters change across the keyboard: each breakpoint adds an offset to the value from its note up.'));
    const pages = VLModel.PAGES.map((pg, pi) => {
      const btn = h('button', 'btn small', pg.name);
      btn.type = 'button';
      btn.addEventListener('click', () => showPage(pi));
      nav.appendChild(btn);
      const page = h('div', 'global-row model-page');
      page.id = 'modelPage' + pi;
      wrap.appendChild(page);
      for (const g of pg.groups) {
        const f = panelBlock(page.id, g.name, { cls: 'model-block' });
        for (const p of g.params) {
          // a parameter's fields stay on one row: value(s), then its breakpoints;
          // a dual parameter gets its name above "Low / High"
          const cells = p.values.length + (p.bpInfo ? 1 : 0);
          let m = f;
          if (cells > 1) {
            m = h('div', 'mparam');
            m.style.gridColumn = `span ${cells}`;
            m.style.gridTemplateColumns = `repeat(${cells}, minmax(0, 1fr))`;
            if (p.dual) {
              const name = h('span', 'mparam-name', p.label);
              if (p.title) name.title = p.title;
              m.appendChild(name);
            }
            f.appendChild(m);
          }
          // short label on the field, full name (and description) in the tooltip
          p.values.forEach((d, j) => makeField(m, d, {
            label: p.dual ? p.dual[j] : p.short,
            title: (p.dual ? `${p.label} ${p.dual[j]}` : p.label) + (p.title ? ': ' + p.title : ''),
            wide: cells === 1 && !!(d.opts && d.opts.some(o => o.length > 12)),
          }));
          if (p.bpInfo) makeBpButton(m, p.bpInfo);
        }
        for (const p of g.params) if (p.bpInfo) makeBpEditor(f.parentElement, p.bpInfo);
      }
      return { btn, page };
    });
    function showPage(i) {
      settings.modelPage = i; saveSettings();
      pages.forEach((x, j) => { x.btn.classList.toggle('on', i === j); x.page.hidden = i !== j; });
    }
    showPage(clamp(settings.modelPage || 0, 0, pages.length - 1));
  }
  const bpUsed = bp => (VL.kindOf(shownVoice()) === 'custom' ? VLModel.used(shownVoice(), bp) : 0);
  const refreshBp = bp => {
    refreshKey(bp.key);
    for (const e of bp.entries) [e.note, ...e.offs].forEach(d => refreshKey(d.key));
  };
  function makeBpButton(parent, bp) {
    const wrap = h('div', 'field bp-field');
    const btn = h('button', 'btn small bp-btn');
    btn.type = 'button';
    wrap.append(h('span', null, 'Breakpoints'), btn);
    wrap.title = `Breakpoints of ${bp.param.label}: offsets added to the value from a note up (up to ${bp.n})`;
    btn.addEventListener('click', () => {
      if (openBp.has(bp.key)) openBp.delete(bp.key); else openBp.add(bp.key);
      refreshKey(bp.key);
    });
    parent.appendChild(wrap);
    register({
      d: { key: bp.key }, wrap,
      refresh() {
        const open = openBp.has(bp.key);
        btn.textContent = `${open ? '▲' : '▼'} ${bpUsed(bp)} of ${bp.n}`;
        btn.classList.toggle('on', open);
      },
    });
  }
  function makeBpEditor(panel, bp) {
    const box = h('div', 'bp-editor');
    box.hidden = true;
    panel.appendChild(box);
    let rows = null, count = null;
    const build = () => {
      const head = h('div', 'bp-head');
      count = h('select');
      for (let i = 1; i <= bp.n; i++) count.appendChild(new Option(String(i), i));
      count.title = 'Number of breakpoints in use. Adding one copies the last breakpoint at a higher note (no change in sound until you edit it); removing drops the last ones.';
      count.addEventListener('change', () => {
        if (state.comparing || kind() !== 'custom') return;
        if (!VLModel.setUsed(state.edit, bp, +count.value)) toast('No notes left above the last breakpoint: lower its note first', true);
        modelChanged();
        refreshBp(bp);
      });
      const lbl = h('label', 'check');
      lbl.append('Breakpoints in use ', count);
      head.append(h('strong', null, bp.param.label), lbl);
      const nv = bp.entries[0].offs.length;
      const tab = h('div', 'ctab bp-tab');
      tab.style.gridTemplateColumns = `32px repeat(${1 + nv}, minmax(64px, 120px))`;
      ['#', 'Note', ...range(nv, j => (nv > 1 ? 'Offset ' + bp.param.dual[j] : 'Offset'))].forEach(t => tab.appendChild(h('span', 'ctab-head', t)));
      rows = bp.entries.map((e, i) => {
        const num = h('span', 'ctab-row', String(i + 1));
        tab.appendChild(num);
        return [num, makeField(tab, e.note).wrap, ...e.offs.map(d => makeField(tab, d).wrap)];
      });
      box.append(head, tab);
    };
    register({
      d: { key: bp.key },
      refresh() {
        const open = openBp.has(bp.key) && VL.kindOf(shownVoice()) === 'custom';
        box.hidden = !open;
        if (!open) return;
        if (!rows) build();
        const k = bpUsed(bp);
        count.value = k;
        count.disabled = state.comparing;
        rows.forEach((cells, i) => cells.forEach(c => { c.hidden = i >= k; }));
      },
    });
  }

  function sendNativeAll() {
    if (!requireOutput()) return;
    const dev = settings.device;
    const list = [
      ...NATIVE_SYS.map(d => [Sysex.system(dev, d.addr, [state.nsys[d.addr]]), 'Native system ' + d.label]),
      ...NATIVE_PART.map(d => [Sysex.part(dev, settings.part, d.addr, [state.npart[d.addr]]), 'Native part ' + d.label]),
    ];
    whileBusy(() => midi.sendSequence(list, 15)).then(() => toast('Native settings sent'));
  }

  // ---------------------------------------------------------------- LCD
  // 21 characters: bank (3) + number (3) + an 8-character name + source
  const LCD_CHARS = 21;
  function updateLcd() {
    const num = String(state.index + 1).padStart(3, '0');
    const v = shownVoice();
    Graphics.drawSevenSegment($('ledSvg'), num, state.edited);
    $('led').setAttribute('aria-label', `Voice ${num}${state.edited ? ', edited' : ''}`);
    $('led').classList.toggle('blink', state.comparing);
    $('lcd1').textContent = `${bankShort()} ${num} ${VL.displayName(v)}`.slice(0, LCD_CHARS);
    $('lcd2').textContent = (state.comparing ? 'COMPARE' : state.storeMode ? 'STORE: SELECT SLOT'
      : state.lastParam || VL.sourceLabel(v)).slice(0, LCD_CHARS);
    const name = VL.getName(v).trimEnd();
    const nameChanged = VL.getName(state.original) !== VL.getName(state.edit);
    document.querySelectorAll('.voice-name').forEach(ni => {
      if (document.activeElement !== ni) ni.value = name;
      ni.disabled = state.comparing;
      ni.parentElement.classList.toggle('cmp-same', state.comparing && !nameChanged);
      ni.parentElement.classList.toggle('cmp-changed', state.comparing && nameChanged);
    });
    const ename = VL.getElementName(v).trimEnd();
    const enameChanged = VL.getElementName(state.original) !== VL.getElementName(state.edit);
    document.querySelectorAll('.elem-name').forEach(ni => {
      if (document.activeElement !== ni) ni.value = ename;
      ni.disabled = state.comparing || VL.kindOf(v) !== 'custom';
      ni.parentElement.classList.toggle('cmp-same', state.comparing && !enameChanged);
      ni.parentElement.classList.toggle('cmp-changed', state.comparing && enameChanged);
    });
  }

  // "Edited" means the edit buffer actually differs from the voice as selected.
  function markEdited() {
    state.edited = !VL.sameVoice(state.edit, state.original);
    updateLcd();
  }

  // ---------------------------------------------------------------- librarian
  function voiceButton(v, i) {
    const b = h('button', 'voice-btn' + (i === state.index ? ' sel' : ''));
    b.type = 'button';
    b.dataset.src = VL.sourceCode(v);
    b.appendChild(h('span', 'num', String(i + 1).padStart(3, '0') + ' ' + (VL.kindOf(v) === 'custom' ? 'CST' : VL.sourceLabel(v).slice(0, 3))));
    b.appendChild(h('span', 'name', VL.getName(v).trimEnd()));
    b.title = `${VL.displayName(v)} — ${VL.sourceLabel(v)}`;
    b.addEventListener('click', () => onVoiceButton(i));
    return b;
  }
  function buildVoiceGrid() {
    const grid = $('voiceGrid');
    const keep = grid.scrollTop;
    grid.innerHTML = '';
    bank().voices.forEach((v, i) => grid.appendChild(voiceButton(v, i)));
    grid.classList.toggle('store-mode', state.storeMode);
    grid.scrollTop = keep;
    // the expand handle only matters for banks with more than two rows
    $('gridToggle').hidden = bank().voices.length <= 32;
    revealSelectedVoice();
  }

  // Collapsed grid (2 rows, scrolling): keep the selected voice's row in view.
  function revealSelectedVoice() {
    const grid = $('voiceGrid');
    const sel = grid.querySelector('.voice-btn.sel');
    if (!sel || !grid.classList.contains('collapsed')) return;
    const pad = parseFloat(getComputedStyle(grid).paddingTop) || 0;
    const top = sel.offsetTop - pad, bottom = sel.offsetTop + sel.offsetHeight + pad;
    if (top < grid.scrollTop) grid.scrollTop = top;
    else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight;
  }
  function setGridExpanded(expanded) {
    settings.gridExpanded = expanded; saveSettings();
    $('voiceGrid').classList.toggle('collapsed', !expanded);
    const t = $('gridToggle');
    t.textContent = expanded ? '▲ 2 rows' : '▼ All voices';
    t.title = expanded ? 'Show only two rows of voices (scrolling)' : 'Show all voices of the bank';
    t.setAttribute('aria-expanded', String(expanded));
    revealSelectedVoice();
  }

  function onVoiceButton(i) {
    if (state.storeMode) {
      const b = bank();
      if (VL.kindOf(state.edit) !== b.kind) {
        const an = k => (k === 'internal' ? 'an internal' : 'a custom');
        toast(`${an(kind()).replace(/^a/, 'A')} voice can't be stored in ${an(b.kind)} bank. Pick ${an(kind())} bank.`, true);
        return;
      }
      if (!confirm(`Store "${VL.displayName(state.edit)}" to ${bankLabel(state.bankName)} #${i + 1}, replacing "${VL.displayName(b.voices[i])}"?`)) return;
      b.voices[i] = VL.cloneVoice(state.edit);
      b.modified = true;
      persistBanks();
      if (b.kind === 'custom') updateCustomNames();
      state.storeMode = false;
      state.index = i;
      state.original = VL.cloneVoice(state.edit);
      state.edited = false;
      buildVoiceGrid();
      buildBankSelect();
      refreshAll();
      if (settings.storeToPlg && midi.output && b.kind === 'custom' && i >= CUSTOM_SLOTS) {
        toast(`Stored to ${bankLabel(state.bankName)} #${i + 1}. Not sent: the PLG150-VL has custom voices 1–${CUSTOM_SLOTS} only.`);
      } else if (settings.storeToPlg && midi.output) {
        midi.sendSequence(slotMessages(b.kind, i, state.edit), 60);
        toast(`Stored to ${bankLabel(state.bankName)} #${i + 1} and sent to PLG ${b.kind} voice ${i + 1}`);
      } else {
        toast(`Stored to ${bankLabel(state.bankName)} #${i + 1}. Use "Send Bank" to write the bank to the PLG.`);
      }
      return;
    }
    selectVoice(i);
  }

  function selectVoice(i, opts = {}) {
    if (state.edited && !opts.force && !confirm('The current voice has unsaved edits. Discard them?')) return;
    state.comparing = false;
    state.index = i;
    state.edit = VL.cloneVoice(bank().voices[i]);
    state.original = VL.cloneVoice(state.edit);
    state.edited = false;
    state.lastParam = '';
    $('compare').classList.remove('on');
    buildVoiceGrid();
    refreshAll();
    if (settings.autoSend && midi.output && !opts.noSend) sendVoice();
  }

  function buildBankSelect() {
    const sel = $('bankSelect');
    sel.innerHTML = '';
    for (const n in state.banks) {
      const c = state.banks[n];
      // "Internal (64)", "My lib (Custom, 128)"; custom banks of up to 6 voices
      // (the board's custom slots) show just their name
      const kindName = c.kind === 'custom' ? 'Custom' : 'Internal';
      const info = c.kind === 'custom' && !isLibrary(c) ? ''
        : ` (${n === kindName ? c.voices.length : `${kindName}, ${c.voices.length}`})`;
      sel.appendChild(new Option(`${bankLabel(n)}${info}${c.rom && c.modified ? ' edited' : ''}`, n));
    }
    sel.appendChild(new Option('＋ New internal bank', '__new'));
    const c = state.banks[state.bankName];
    if (c && (!c.rom || c.modified)) {
      sel.appendChild(new Option(c.rom ? '↺ Revert this bank' : '✕ Remove this bank', '__remove'));
    }
    sel.value = state.bankName;
    updateSendBankTitle();
  }

  function updateSendBankTitle() {
    if (bankSending) return;
    const b = bank();
    $('saveBank').textContent = isLibrary(b) ? 'Save .lib' : 'Save .syx';
    $('saveBank').title = isLibrary(b)
      ? 'Save this library bank as a VL70m Expert Editor library (.lib, 128 custom voices)'
      : 'Save the current bank as a .syx file (Internal or Custom Voice bulk dumps)';
    $('sendBank').title = isLibrary(b)
      ? `A library of ${b.voices.length} custom voices: the PLG150-VL has only 6 custom voice slots, so a library can't be sent as a bank. Click a voice to play it (it is sent to the current voice), or store it in a 6-voice Custom bank and send that.`
      : b.kind === 'custom'
      ? `Send the ${b.voices.length} voices of this bank to the PLG150-VL Custom bank (Bank MSB 33, LSB 2), voices 1–${b.voices.length}, as Custom Voice bulk dumps (with their models). To hear them, select that bank on the part. The Custom bank is lost at power-off.`
      : 'Send the 64 voices of this bank to the PLG150-VL Internal bank (Bank MSB 33, LSB 3), voices 1–64, as Internal Voice bulk dumps. To hear them, select that bank on the part. The Internal bank is lost at power-off.';
  }

  function selectBank(name, opts = {}) {
    if (state.edited && !opts.force && !confirm('The current voice has unsaved edits. Discard them?')) {
      $('bankSelect').value = state.bankName;
      return;
    }
    state.bankName = name;
    settings.bank = name; saveSettings();
    state.storeMode = false;
    buildBankSelect();
    selectVoice(0, { force: true, noSend: opts.noSend });
  }

  function uniqueName(base) {
    const n = base.replace(/\.[^.]+$/, '').slice(0, 24) || 'User';
    if (!state.banks[n]) return n;
    for (let i = 2; ; i++) if (!state.banks[`${n} (${i})`]) return `${n} (${i})`;
  }

  function onBankSelect() {
    const v = $('bankSelect').value;
    if (v === '__new') {
      const name = uniqueName('User');
      state.banks[name] = { kind: 'internal', voices: range(64, () => VL.newInternal()), rom: false, modified: true };
      persistBanks();
      selectBank(name);
    } else if (v === '__remove') {
      const c = bank();
      if (!confirm(c.rom ? `Revert "${state.bankName}" to the factory voices?` : `Remove bank "${state.bankName}" from the editor?`)) {
        $('bankSelect').value = state.bankName;
        return;
      }
      if (c.rom) {
        state.banks[state.bankName] = { kind: romCache[state.bankName].kind, voices: romCache[state.bankName].voices.map(VL.cloneVoice), rom: true, modified: false };
      } else {
        delete state.banks[state.bankName];
      }
      persistBanks();
      updateCustomNames();
      selectBank(c.rom ? state.bankName : Object.keys(state.banks)[0], { force: true });
    } else {
      selectBank(v);
    }
  }

  function importFile(bytes, name) {
    if (VL.isLibFile(bytes)) {
      const voices = VL.parseLibFile(bytes);
      if (!voices.length) { toast('The library file has no voices', true); return; }
      const n = uniqueName(name);
      state.banks[n] = { kind: 'custom', voices, rom: false, modified: true };
      persistBanks();
      updateCustomNames();
      selectBank(n, { noSend: true });
      toast(`Loaded library "${n}" (${voices.length} custom voices)`);
      return;
    }
    const res = VL.parseSyxFile(bytes);
    res.warnings.forEach(w => toast(w, true));
    const added = [];
    if (res.internal) {
      const n = uniqueName(res.custom ? name.replace(/\.[^.]+$/, '') + ' INT' : name);
      state.banks[n] = { kind: 'internal', voices: res.internal, rom: false, modified: true };
      added.push(n);
    }
    if (res.custom) {
      const n = uniqueName(res.internal ? name.replace(/\.[^.]+$/, '') + ' CST' : name);
      state.banks[n] = { kind: 'custom', voices: res.custom, rom: false, modified: true };
      added.push(n);
    }
    if (added.length) {
      persistBanks();
      updateCustomNames();
      selectBank(added[0], { noSend: true });
      toast(`Loaded ${added.map(n => `"${n}" (${state.banks[n].voices.length} voices)`).join(' and ')}`);
    } else if (res.single) {
      if (state.edited && !confirm('Replace the current edits with the voice from the file?')) return;
      // a voice of the other kind gets an Init voice of its own kind as "original"
      if (VL.kindOf(res.single) !== VL.kindOf(state.original)) {
        state.original = VL.kindOf(res.single) === 'custom' ? VL.initCustom(res.single) : VL.newInternal();
      }
      state.edit = res.single;
      state.comparing = false;
      $('compare').classList.remove('on');
      markEdited();
      refreshAll();
      toast(`Loaded ${VL.kindOf(res.single)} voice "${VL.displayName(res.single)}" into the edit buffer`);
      if (settings.autoSend && midi.output) sendVoice();
    } else {
      toast('No PLG150-VL voice data (Custom, Internal or Current Voice bulk dumps) found', true);
    }
  }

  function download(name, bytes) {
    const blob = new Blob([Uint8Array.from(bytes)], { type: 'application/octet-stream' });
    const a = h('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const fileSafe = s => s.trim().replace(/[^\w\-. ]+/g, '_') || 'voice';
  // bulk dumps of voice i of a kind, for files (device number 0)
  const fileBytes = (k, i, v) => (k === 'custom'
    ? [...Sysex.customCommon(0, i, v), ...Sysex.customElement(0, i, v)]
    : Sysex.internal(0, i, v));

  // ---------------------------------------------------------------- tabs
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    history.replaceState(null, '', name === 'voice' ? location.pathname + location.search : '#' + name);
  }

  // ---------------------------------------------------------------- keyboard & wheels
  const KEY_COUNT = 61;
  const keyEls = new Map();
  const down = new Set();
  const baseNote = () => 36 + settings.octave * 12;   // 36 = C1 (Yamaha naming)

  function noteOn(note, vel) {
    if (note < 0 || note > 127 || down.has(note)) return;
    down.add(note);
    keyEls.get(note)?.classList.add('down');
    midi.send([0x90 | settings.channel, note, vel || settings.velocity]);
  }
  function noteOff(note) {
    if (!down.has(note)) return;
    down.delete(note);
    keyEls.get(note)?.classList.remove('down');
    midi.send([0x80 | settings.channel, note, 64]);
  }
  function allOff() { [...down].forEach(noteOff); }

  function buildKeyboard() {
    const kb = $('keyboard');
    kb.innerHTML = '';
    keyEls.clear();
    const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
    const base = baseNote();
    const whites = range(KEY_COUNT, i => base + i).filter(n => !isBlack(n)).length;
    const ww = 100 / whites;
    let wi = 0;
    for (let i = 0; i < KEY_COUNT; i++) {
      const note = base + i;
      const k = h('div', 'key ' + (isBlack(note) ? 'black' : 'white'));
      if (isBlack(note)) {
        k.style.left = `calc(${wi * ww}% - ${ww * 0.32}%)`;
        k.style.width = ww * 0.64 + '%';
      } else {
        k.style.left = wi * ww + '%';
        k.style.width = ww + '%';
        if (note % 12 === 0) k.appendChild(h('span', 'lbl', VL.noteName(note)));
        wi++;
      }
      k.dataset.note = note;
      keyEls.set(note, k);
      kb.appendChild(k);
    }
    $('octLabel').textContent = `${VL.noteName(base)}–${VL.noteName(base + KEY_COUNT - 1)}`;
  }

  function setupKeyboardPointer() {
    const kb = $('keyboard');
    const active = new Map();   // pointerId -> note
    const velFromEvent = (e, key) => {
      // lower on the key = louder, scaled around the velocity slider value
      const r = key.getBoundingClientRect();
      const y = clamp((e.clientY - r.top) / r.height, 0, 1);
      return clamp(Math.round(settings.velocity * (0.55 + 0.6 * y)), 1, 127);
    };
    const keyAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el && el.classList.contains('key') ? el : null;
    };
    kb.addEventListener('pointerdown', e => {
      const key = keyAt(e.clientX, e.clientY);
      if (!key) return;
      kb.setPointerCapture(e.pointerId);
      const note = +key.dataset.note;
      active.set(e.pointerId, note);
      noteOn(note, velFromEvent(e, key));
    });
    kb.addEventListener('pointermove', e => {
      if (!active.has(e.pointerId)) return;
      const key = keyAt(e.clientX, e.clientY);
      const note = key ? +key.dataset.note : null;
      if (note === active.get(e.pointerId)) return;
      noteOff(active.get(e.pointerId));
      if (note != null) { active.set(e.pointerId, note); noteOn(note, velFromEvent(e, key)); }
      else active.set(e.pointerId, null);
    });
    const end = e => {
      if (!active.has(e.pointerId)) return;
      const n = active.get(e.pointerId);
      if (n != null) noteOff(n);
      active.delete(e.pointerId);
    };
    kb.addEventListener('pointerup', end);
    kb.addEventListener('pointercancel', end);
  }

  // Computer keyboard: two rows like a tracker. Z = C of the lowest octave.
  const KEYMAP = {
    z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12,
    q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24,
  };
  function setupComputerKeys() {
    const typing = () => {
      const a = document.activeElement;
      return a && (a.tagName === 'INPUT' && a.type !== 'checkbox' && a.type !== 'range' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA');
    };
    const noteFor = k => baseNote() + 24 + KEYMAP[k];   // starts at C3
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && state.storeMode) { state.storeMode = false; buildVoiceGrid(); updateLcd(); return; }
      if (typing() || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const k = e.key.toLowerCase();
      if (k in KEYMAP) { noteOn(noteFor(k)); e.preventDefault(); }
    });
    document.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      if (k in KEYMAP) noteOff(noteFor(k));
    });
    window.addEventListener('blur', allOff);
  }

  // Generic vertical wheel. value is 0..1; springBack returns it to 0.5 on
  // release; resetTo: value set by a double-click.
  function setupWheel(el, initial, { springBack = false, resetTo = null } = {}, onChange) {
    const thumb = el.firstElementChild;
    let value = initial;
    const draw = () => {
      const r = el.clientHeight - thumb.offsetHeight - 4;
      thumb.style.top = (2 + (1 - value) * r) + 'px';
    };
    const setFromY = y => {
      const r = el.getBoundingClientRect();
      const t = thumb.offsetHeight;
      value = clamp(1 - (y - r.top - t / 2) / (r.height - t), 0, 1);
      draw();
      onChange(value);
    };
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); setFromY(e.clientY); });
    el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) setFromY(e.clientY); });
    const release = () => {
      if (!springBack) return;
      value = 0.5; draw(); onChange(value);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    if (resetTo != null) el.addEventListener('dblclick', () => { value = resetTo; draw(); onChange(value); });
    new ResizeObserver(draw).observe(el);
    draw();
  }

  function setupPerformance() {
    let lastBend = -1, lastMod = -1, lastBreath = -1, lastAt = -1;
    const ch = () => settings.channel;
    setupWheel($('pitchWheel'), 0.5, { springBack: true }, v => {
      const val = v === 0.5 ? 8192 : Math.round(v * 16383);
      if (val === lastBend) return;
      lastBend = val;
      midi.send([0xE0 | ch(), val & 0x7F, val >> 7]);
    });
    setupWheel($('modWheel'), 0, {}, v => {
      const val = Math.round(v * 127);
      if (val === lastMod) return;
      lastMod = val;
      midi.send([0xB0 | ch(), 1, val]);
    });
    setupWheel($('breathWheel'), 0, { resetTo: 0 }, v => {
      const val = Math.round(v * 127);
      if (val === lastBreath) return;
      lastBreath = val;
      midi.send([0xB0 | ch(), 2, val]);
    });
    setupWheel($('atWheel'), 0, { resetTo: 0 }, v => {
      const val = Math.round(v * 127);
      if (val === lastAt) return;
      lastAt = val;
      midi.send([0xD0 | ch(), val]);
    });
    let sustain = false;
    $('sustain').addEventListener('click', () => {
      sustain = !sustain;
      $('sustain').classList.toggle('on', sustain);
      midi.send([0xB0 | ch(), 64, sustain ? 127 : 0]);
    });
    $('panic').addEventListener('click', () => {
      allOff();
      midi.send([0xB0 | ch(), 120, 0]);
      midi.send([0xB0 | ch(), 123, 0]);
      midi.send([0xB0 | ch(), 121, 0]);
      sustain = false;
      $('sustain').classList.remove('on');
    });
    $('velocity').value = settings.velocity;
    $('velOut').textContent = settings.velocity;
    $('velocity').addEventListener('input', e => {
      settings.velocity = +e.target.value;
      $('velOut').textContent = settings.velocity;
      saveSettings();
    });
    const shift = d => {
      const o = clamp(settings.octave + d, -2, 2);
      if (o === settings.octave) return;
      allOff();
      settings.octave = o; saveSettings();
      buildKeyboard();
    };
    // Hiding the footer only frees screen space; the computer keys still play.
    const showPerf = hidden => {
      document.body.classList.toggle('perf-hidden', hidden);
      $('perfToggle').textContent = hidden ? '▲ Keyboard' : '▼ Keyboard';
      $('perfToggle').title = hidden ? 'Show the keyboard' : 'Hide the keyboard';
      $('perfToggle').setAttribute('aria-expanded', String(!hidden));
    };
    showPerf(settings.perfHidden);
    $('perfToggle').addEventListener('click', () => {
      settings.perfHidden = !settings.perfHidden; saveSettings();
      if (settings.perfHidden) allOff();
      showPerf(settings.perfHidden);
    });
    $('octDown').addEventListener('click', () => shift(-1));
    $('octUp').addEventListener('click', () => shift(1));
    buildKeyboard();
    setupKeyboardPointer();
    setupComputerKeys();
  }

  // ---------------------------------------------------------------- setup bar & buttons
  function setupControls() {
    const fill = (sel, n, f, val) => { for (let i = 0; i < n; i++) sel.appendChild(new Option(f(i), i)); sel.value = val; };
    fill($('deviceId'), 16, i => String(i + 1), settings.device);
    fill($('midiChannel'), 16, i => String(i + 1), settings.channel);
    fill($('plgPart'), 16, i => String(i + 1), settings.part);
    $('deviceId').addEventListener('change', e => { settings.device = +e.target.value; saveSettings(); });
    $('midiChannel').addEventListener('change', e => { allOff(); settings.channel = +e.target.value; saveSettings(); });
    $('plgPart').addEventListener('change', e => { settings.part = +e.target.value; saveSettings(); });
    $('midiOut').addEventListener('change', e => {
      allOff();
      midi.selectOutput(e.target.value);
      settings.out = midi.output ? midi.output.name : ''; saveSettings();
      refreshPorts();
    });
    $('midiConnect').addEventListener('click', enableMidi);

    const bindCheck = (id, key) => {
      $(id).checked = settings[key];
      $(id).addEventListener('change', e => { settings[key] = e.target.checked; saveSettings(); });
    };
    bindCheck('liveSend', 'liveSend');
    bindCheck('autoSend', 'autoSend');
    bindCheck('storeToPlg', 'storeToPlg');

    $('sendVoice').addEventListener('click', () => sendVoice(shownVoice()));
    $('sendBank').addEventListener('click', sendBank);
    $('compare').addEventListener('click', () => {
      if (!state.edited) { toast('Nothing to compare: no parameter differs from the original voice'); return; }
      state.comparing = !state.comparing;
      $('compare').classList.toggle('on', state.comparing);
      refreshAll();
      if (midi.output) sendVoice(shownVoice());
    });
    $('storeVoice').addEventListener('click', () => {
      if (state.comparing) return;
      state.storeMode = !state.storeMode;
      buildVoiceGrid();
      updateLcd();
      if (state.storeMode) toast('Click the destination voice button (Esc to cancel)');
    });
    $('initVoice').addEventListener('click', () => {
      if (state.comparing) return;
      const custom = kind() === 'custom';
      if (!confirm(custom ? 'Initialize the voice common and the controls? The VL model of this custom voice is kept.'
        : 'Initialize the edit buffer to Init Voice?')) return;
      state.edit = custom ? VL.initCustom(state.edit) : VL.newInternal();
      state.lastParam = '';
      markEdited();
      refreshAll();
      if (midi.output) sendVoice();
    });
    $('exportVoice').addEventListener('click', () => {
      const v = state.edit;
      const k = VL.kindOf(v);
      const slot = k === 'custom' ? (state.index < 6 ? state.index : 0) : state.index & 0x3F;
      download(fileSafe(VL.getName(v)) + '.syx', fileBytes(k, slot, v));
    });

    $('bankSelect').addEventListener('change', onBankSelect);
    $('gridToggle').addEventListener('click', () => setGridExpanded(!settings.gridExpanded));
    $('voiceGrid').classList.toggle('collapsed', !settings.gridExpanded);
    $('loadFile').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      importFile(new Uint8Array(await f.arrayBuffer()), f.name);
    });
    $('saveBank').addEventListener('click', () => {
      const b = bank();
      if (isLibrary(b)) {
        download(fileSafe(bankLabel(state.bankName)) + '.lib', VL.buildLibFile(b.voices));
        return;
      }
      const bytes = b.voices.flatMap((v, i) => fileBytes(b.kind, i, v));
      download(fileSafe(bankLabel(state.bankName)) + '.syx', bytes);
    });

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

    $('sendNativeAll').addEventListener('click', sendNativeAll);
    $('resetNative').addEventListener('click', () => {
      if (!confirm('Reset the native settings to their defaults and send them?')) return;
      Object.assign(state.nsys, defaults(NATIVE_SYS));
      Object.assign(state.npart, defaults(NATIVE_PART));
      store.set('nsys', state.nsys); store.set('npart', state.npart);
      refreshAll();
      if (midi.output) sendNativeAll();
    });
    $('clearLog').addEventListener('click', () => { $('log').textContent = ''; });

    window.addEventListener('beforeunload', e => {
      if (state.edited) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    setupControls();
    setupPerformance();
    loadBanks();
    state.bankName = state.banks[settings.bank] ? settings.bank : Object.keys(state.banks)[0];
    buildVoicePage();
    buildDetailPage();
    buildNativePage();
    buildModelPage();
    buildBankSelect();
    selectVoice(0, { force: true, noSend: true });
    setGridExpanded(settings.gridExpanded);
    document.body.classList.remove('loading');
    const hashTab = location.hash.slice(1);
    if (document.querySelector(`.tab[data-tab="${CSS.escape(hashTab)}"]`)) showTab(hashTab);
    // Re-open MIDI automatically if the permission was granted before.
    if (midi.supported && navigator.permissions) {
      navigator.permissions.query({ name: 'midi', sysex: true })
        .then(p => { if (p.state === 'granted') enableMidi(); })
        .catch(() => {});
    }
  }
  boot();
})();
