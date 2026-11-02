// PLG150-VL voice model: parameter map, value formatting and SysEx file parsing.
//
// The PLG150-VL uses the VL70-m native format (model 57). Two kinds of voice
// can be written to the board (Owner's Manual, MIDI Data Format):
//
//   Custom voice   (bank 33/2, 6 slots)   Common 30 00 0n (0xA3 bytes, table 9)
//                                         Element 31 00 0n (0x56B bytes, table 9)
//                  A complete VL voice: the element holds the controller set
//                  (0x0A-0x3C) followed by the physical model data
//                  (0x3D-0x56A, "not used" in the manual; mapped in model.js).
//   Internal voice (bank 33/3, 64 slots)  40 00 nn (0xA3 bytes, table 10)
//                  A VL70-m style voice: it points to a Preset or Custom
//                  voice (the model) and has its own controller set.
//
// In the editor a voice is a Uint8Array: 163 bytes = internal voice,
// 1550 bytes = custom voice (common followed by element).
//
// The edit buffer is sent to the board's Current Voice (table 4 and 8):
//   10 00 00  Common Misc (0x0F bytes): name, level, assign mode, porta mode
//   20 00 00  Element (0x56B bytes); 20 00 0A-3C take parameter changes.
// Depths are 8-bit two's complement sent as 2 bytes (bit 7, bits 6-0):
// -127 = 01 01, +127 = 00 7F. Curves are 7-bit two's complement (70-10 = -16..+16).
(function () {
  'use strict';

  const COMMON_SIZE = 0xA3, ELEMENT_SIZE = 0x56B;
  const INTERNAL_SIZE = 0xA3;
  const CUSTOM_SIZE = COMMON_SIZE + ELEMENT_SIZE;      // 1550
  const CTL_INT = 0x70;                                // controller set in an internal voice
  const CTL_ELEM = 0x0A;                               // ... in an element
  const CTL_CST = COMMON_SIZE + CTL_ELEM;              // ... in a custom voice
  const kindOf = v => (v.length === CUSTOM_SIZE ? 'custom' : 'internal');

  // ------------------------------------------------------------------ lists
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = n => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2);   // 0 = C-2, 60 = C3

  // Preset voice names (Owner's Manual, Voice List p.37-38)
  const PRESET1 = ['Mad Tube', 'VintgLd', 'SpaceZoo', 'GuitHero', 'StoneHng', 'Whizzer', 'SimpleBa',
    'ClavBass', 'SuperBas', 'New Slap', 'RockPigs', 'Igneous', '50 / 50', 'Cybastrg', 'Wynth', 'BuzzSaw',
    'ZubZub', 'Blue', 'OsciLead', 'SqrLead', 'Bigger', 'AnaSquid', 'SharpSyn', 'AnaWave', 'AnaWurl',
    'Babalog', 'FngrBass', 'Upright', 'Fnground', 'Birdland', 'FlageoBs', 'DampBass', 'Fretles!',
    'Frtles!2', 'ThumBass', 'RockBass', 'SmooBass', 'WarmBass', 'YamaBass', 'Box Bass', 'BassCab',
    'FruitBas', 'AcidBas!', 'SqrBass!', 'PulsClav', 'MogueBas', 'BoppaBas', 'BuzzrBas', 'MuteHrBs',
    'TekBass', 'TranzBas', 'Chamlion', 'ParaSyn', 'SteamBas', 'BooBass', 'WhelkBas', 'AtackSyn',
    'Q.Klav', 'Sitar!', 'India', 'YamSteel', 'StungSt', 'Mu', 'Waterphn', 'DinoPerc', 'Formula',
    'Jurassic', 'Devil', 'SpcHorse', 'Jason', 'Suedhead', 'Spanish', 'JazzGtr!', 'JazzyGtr', 'L7 Pluck',
    'WetPluck', 'Comp Gtr', 'FunkyGtr', 'Thin Gtr', 'Carlos', 'Destiny', 'Gonzo', 'Grunge', 'Ossyncro',
    'Talk Box', 'SyncLed', 'Old Mini', 'Fat Mini', 'Parlopho', 'SimpleSy', 'Choronic', 'SlitMinu',
    'SynHarmo', 'Flaggoot', 'SynSkex', 'ResoSqr', 'WurliLd', 'FlatLead', 'PhilTur', 'ChalPuls',
    'Pluck Ld', 'Brassyn', 'AcoSynLd', 'Moby', 'Digitrn', 'LyricOff', 'Rezzawi', 'Macro', 'Claribo',
    'Binaphon', 'MokoPipe', 'AliBaba', 'Persinet', 'PicoPipe', 'Gertrude', 'Xynth', 'Duality', 'AltKwek',
    'Softblow', 'AlbaPipe', 'Electrum', 'Edgeopho', 'BassCla!', 'WX Clari', 'WX Oboe', 'WX J Gtr',
    'Shakuha!', 'LipClari'];
  const PRESET2 = ['Vento', 'Floboe', 'Sintax', 'Eastern', 'Trumpet!', 'SoprSax!', 'LiteAlto', 'Trmbone!',
    'BtlFlute', 'Air Sax', 'TenrSax!', 'Coca', 'JetLpBow', 'Viol Inn', 'MuteCone', 'BrethBow', 'Trumpt!2',
    'FluglHr!', 'Cornet', 'JzTrump', 'JzTrump2', 'Flumpet', 'WXTrumpt', 'MuteTp!', 'MuteTp!2', 'Melwbone',
    'NerzoBr', 'Horn!', 'Horn!2', 'NuHorne', 'WX Horn', 'Tuba!', 'NuViolin', 'C Violin', 'BrtVioln',
    'MuteViol', 'BrtViola', 'ViolOutt', 'Cello!', 'Eleanor', 'Nu Cello', 'Contrair', 'DoublBow',
    'Piccolo!', 'Piccol!2', 'BowPicol', 'C Flute', 'C Flute2', 'JazFlute', 'OakFlute', 'BtlFlut2',
    'RzdeFlt', 'Flutuen', 'Nz Flute', 'WX Shaku', 'Pan Pipe', 'PanPicol', 'Bamboo', 'Andean', 'Flurinet',
    'SoftReed', 'Flurmod', 'Jhopali', 'Baroquen', 'SquealAT', 'NuSopSax', 'CvSopSax', 'SoprPipe',
    'LiteSopr', 'AnaSoprn', 'NuAltSax', 'SweetAlt', 'AltoSax!', 'HarpAlto', 'HarpAlt2', 'GlassAlt',
    'AcidSax', 'WackSax', 'NuTenrSx', 'MildTenr', 'Jazz Sax', 'TenorSub', 'BellMike', 'GlasTenr',
    'FnkyTenr', 'OldTenor', 'BrtTenor', 'BariSax!', 'VoxoSaxo', 'Oboe!', 'Oboe!2', 'Noboe', 'OboeWhi',
    'DblReedy', 'TripleRd', 'EngHorn!', 'Loboe', 'Bassoon!', 'Clarint!', 'LitePipe', 'HyperCla',
    'Clarint2', 'IslePipe', 'Chanter', 'ThaiReed', 'Recordr!', 'Claricrd', 'SoftPipe', 'BowdSaw',
    'Ocarina!', 'Lonely', 'Ophelia', 'Maysbe?', 'MizuHorn', 'PicoStrg', 'Sylophon', 'BowLead', 'Squeeze',
    'MouthKey', 'AmpdHarp', 'CromHarp', 'WahUpHp', 'YamaBotl', 'Blowsoo', 'Brappo', 'Crumbon', 'Klarina',
    'ReedWin'];
  const SOURCE_BANKS = ['Preset 1', 'Preset 2', 'Custom'];
  const SOURCE_SHORT = ['Pr1', 'Pr2', 'Cst'];
  // names of the custom voices, for the source program list (set by the app)
  let customNames = ['', '', '', '', '', ''];

  // Controller numbers: off, 1-95, AT, VEL, PB (Owner's Manual p.29)
  const CC_NAMES = { 1: 'Mod Wheel', 2: 'Breath', 4: 'Foot Ctrl', 5: 'Porta Time', 6: 'Data Entry',
    7: 'Volume', 10: 'Pan', 11: 'Expression', 13: 'CC 13', 64: 'Hold 1', 65: 'Porta Sw', 67: 'Soft Pedal',
    71: 'Harm. Content', 72: 'Release', 73: 'Attack', 74: 'Brightness', 91: 'Reverb', 93: 'Chorus', 94: 'Variation' };
  const SRC_OFF = v => v === 0 || v === 32;            // 0 and 32 are bank select: off
  const srcName = v => (v === 0 ? 'Off' : v === 32 ? '32 (off)' : v === 96 ? 'AT' : v === 97 ? 'Velocity'
    : v === 98 ? 'Pitch Bend' : String(v).padStart(2, '0') + (CC_NAMES[v] ? ' ' + CC_NAMES[v] : ''));
  const srcShort = v => (v === 0 ? 'OFF' : v === 32 ? 'OFF' : v === 96 ? 'AT' : v === 97 ? 'VEL' : v === 98 ? 'PB' : 'CC' + v);
  const SOURCES = Array.from({ length: 99 }, (_, i) => srcName(i));

  // ------------------------------------------------------------------ formatting
  const sign = n => (n > 0 ? '+' + n : String(n));
  const FMT = {
    num: r => String(r),
    sgn: r => sign(r),
    s64: r => sign(r - 64),
    note: r => noteName(r),
    st: r => sign(r - 64) + ' st',
    cent: r => sign(r - 64) + ' c',
    fcent: r => sign((r - 64) * 150) + ' c',        // -9600..+9450 cents
    pct: r => sign(Math.round((r - 64) * 100 / 64)) + '%',
    pan: r => (r === 0 ? 'Random' : r === 64 ? 'C' : r < 64 ? 'L' + (64 - r) : 'R' + (r - 64)),
    hz: r => sign((r - 128) / 10) + ' Hz',
    cc95: r => (r === 0 ? 'Off' : 'CC ' + r),
    src: srcName,
  };

  // ------------------------------------------------------------------ parameter map
  // Each parameter: { key, label, int, cst, enc, min, max, def, fmt|opts|fmtFn, live, center }
  //   int / cst: byte offset in an internal / custom voice (null: not in that kind)
  //   enc: u7 (one byte), s8 (2 bytes, -127..+127), s7 (7-bit signed), nib (2 nibbles, 0-255)
  //   live: [ah, am, al] of the Current Voice parameter change, 'part' for the
  //         native part scaling (09 0p xx), or null (no live message)
  const P = {};
  const list = [];
  function def(key, o) {
    const d = Object.assign({ key, int: null, cst: null, enc: 'u7', min: 0, max: 127, def: 0, fmt: 'num', live: null }, o);
    if (d.center == null) d.center = d.min < 0 ? 0 : (d.bipolar ? 64 : null);
    P[key] = d;
    list.push(d);
    return d;
  }

  // --- common
  def('level', { label: 'Voice Level', int: 0x08, cst: 0x09, def: 127, live: [0x10, 0x00, 0x09] });
  def('assign', { label: 'Assign Mode', int: 0x09, cst: 0x0A, max: 2, def: 2, opts: ['Bottom', 'Top', 'Last'], live: [0x10, 0x00, 0x0A] });
  def('portaMode', { label: 'Portamento Mode', cst: 0x0D, max: 1, opts: ['Fulltime', 'Fingered'], live: [0x10, 0x00, 0x0D] });
  // --- internal voice only
  def('ampBp', { label: 'Amp Scale Break Point', int: 0x37, def: 0x3C, fmt: 'note', live: 'part', partAddr: 0x17 });
  def('ampDepth', { label: 'Amp Scale Depth', int: 0x38, def: 64, fmt: 's64', bipolar: true, live: 'part', partAddr: 0x18 });
  def('fltBp', { label: 'Filter Scale Break Point', int: 0x39, def: 0x3C, fmt: 'note', live: 'part', partAddr: 0x19 });
  def('fltDepth', { label: 'Filter Scale Depth', int: 0x3A, def: 64, fmt: 's64', bipolar: true, live: 'part', partAddr: 0x1A });
  def('srcBank', { label: 'Source Bank', int: 0x3B, max: 2, opts: SOURCE_BANKS });
  const isCustomSrc = v => kindOf(v) === 'internal' && v[0x3B] === 2;
  def('srcProg', {
    label: 'Source Voice', int: 0x3C,
    opts: v => {
      const b = kindOf(v) === 'internal' ? v[0x3B] : 0;
      if (b === 2) return customNames.map((n, i) => `${i + 1} ${n || 'Custom ' + (i + 1)}`);
      return (b === 1 ? PRESET2 : PRESET1).map((n, i) => `${String(i + 1).padStart(3, '0')} ${n}`);
    },
    maxV: v => (isCustomSrc(v) ? 5 : 127),
  });
  // --- custom voice common only (no Current Voice message: stored in the voice)
  def('monoPoly', { label: 'Mono/Poly', cst: 0x0F, max: 1, def: 1, opts: ['Mono', 'Poly'] });
  def('noteShift', { label: 'Note Shift', cst: 0x10, min: 0x28, max: 0x58, def: 64, fmt: 'st', bipolar: true });
  def('detune', { label: 'Detune', cst: 0x11, enc: 'nib', max: 255, def: 128, fmt: 'hz', bipolar: true, center: 128 });
  def('velDepth', { label: 'Velocity Sense Depth', cst: 0x14, def: 64 });
  def('velOffset', { label: 'Velocity Sense Offset', cst: 0x15, def: 64 });
  def('pan', { label: 'Pan', cst: 0x16, def: 64, fmt: 'pan', bipolar: true });
  def('dry', { label: 'Dry Level', cst: 0x19, def: 127 });
  def('chorus', { label: 'Chorus Send', cst: 0x1A });
  def('reverb', { label: 'Reverb Send', cst: 0x1B, def: 40 });
  def('variation', { label: 'Variation Send', cst: 0x1C });
  const CTRL_ROWS = [['mw', 'MW', 0x1D], ['bend', 'Bend', 0x22], ['at', 'AT', 0x33], ['ac1', 'AC1', 0x39]];
  for (const [k, name, o] of CTRL_ROWS) {
    def(k + 'Pitch', { label: `${name} Pitch Control`, cst: o, min: k === 'bend' ? 0x28 : 0x28, max: 0x58, def: k === 'bend' ? 0x42 : 64, fmt: 'st', bipolar: true });
    def(k + 'Filter', { label: `${name} Filter Control`, cst: o + 1, def: 64, fmt: 'fcent', bipolar: true });
    def(k + 'Amp', { label: `${name} Amplitude Control`, cst: o + 2, def: 64, fmt: 'pct', bipolar: true });
    def(k + 'LfoP', { label: `${name} LFO PMod Depth`, cst: o + 3, def: k === 'mw' ? 10 : 0 });
    def(k + 'LfoF', { label: `${name} LFO FMod Depth`, cst: o + 4 });
  }
  def('ac1No', { label: 'AC1 Controller', cst: 0x38, max: 95, def: 16, fmt: 'cc95' });
  def('bendLow', { label: 'Bend Pitch Low Control', cst: 0x40, min: 0x28, max: 0x58, def: 0x3E, fmt: 'st', bipolar: true });
  def('portaSw', { label: 'Portamento Switch', cst: 0x3E, max: 1, opts: ['Off', 'On'] });
  def('portaTime', { label: 'Portamento Time', cst: 0x3F });
  for (let i = 0; i < 12; i++) {
    def('tune' + i, { label: `Scale Tuning ${NOTE_NAMES[i]}`, cst: 0x27 + i, def: 64, fmt: 'cent', bipolar: true });
  }

  // --- controller set (both kinds; Current Voice element 20 00 0A-3C)
  const ctl = (key, rel, o) => def(key, Object.assign({ int: CTL_INT + rel, cst: CTL_CST + rel, live: [0x20, 0x00, CTL_ELEM + rel] }, o));
  ctl('expMode', 0, { label: 'Expression Mode', max: 1, opts: ['BC', 'Volume'] });
  // the twelve controlled parameters, in element order
  const CONTROLS = [
    { id: 'pres', name: 'Pressure', short: 'PRESSURE', desc: 'Breath pressure on the reed or mouthpiece, or bow speed on the string. Off = maximum pressure at all times.' },
    { id: 'filt', name: 'Filter', short: 'FILTER', desc: 'Cutoff of the dynamic filter.' },
    { id: 'amp', name: 'Amplitude', short: 'AMPLITUDE', desc: 'Output amplitude.' },
    { id: 'emb', name: 'Embouchure', short: 'EMBOUCHURE', desc: 'Tightness of the lips on the reed or each other, or bow pressure on the string. Off = medium embouchure.' },
    { id: 'tng', name: 'Tonguing', short: 'TONGUING', desc: 'Half-tonguing: the slit between reed tip and mouthpiece. Off = no tonguing.' },
    { id: 'scr', name: 'Scream', short: 'SCREAM', desc: 'Drives the model into chaotic oscillation.' },
    { id: 'bnz', name: 'Breath Noise', short: 'BREATH NOISE', desc: 'Amount of breath noise.' },
    { id: 'grl', name: 'Growl', short: 'GROWL', desc: 'Periodic pressure modulation (growl).' },
    { id: 'thr', name: 'Throat Formant', short: 'THROAT', desc: "The simulated player's lungs, trachea and mouth: roughness. Some reed voices only." },
    { id: 'hrm', name: 'Harmonic Enhancer', short: 'HARMONIC ENH.', desc: 'Harmonic enhancer depth (wet/dry). Used by few voices.' },
    { id: 'dmp', name: 'Damping', short: 'DAMPING', desc: 'Losses in the body or on the string (air friction).' },
    { id: 'abs', name: 'Absorption', short: 'ABSORPTION', desc: 'High-frequency loss at the end of the pipe or string.' },
  ];
  let rel = 1;
  for (const c of CONTROLS) {
    c.src = ctl(c.id + 'Src', rel, { label: `${c.name} Control`, max: 98, opts: SOURCES, ctrlGroup: c.id });
    if (c.id === 'emb') {
      c.upper = ctl('embUpper', rel + 1, { label: 'Embouchure Upper Depth', enc: 's8', min: -127, max: 127, def: 0, fmt: 'sgn', ctrlGroup: c.id });
      c.lower = ctl('embLower', rel + 3, { label: 'Embouchure Lower Depth', enc: 's8', min: -127, max: 127, def: 0, fmt: 'sgn', ctrlGroup: c.id });
      c.mode = ctl('embMode', rel + 5, { label: 'Embouchure Mode', max: 1, opts: ['Center Base', 'Minimum Base'], ctrlGroup: c.id });
      rel += 6;
    } else {
      c.depth = ctl(c.id + 'Depth', rel + 1, { label: `${c.name} Depth`, enc: 's8', min: -127, max: 127, def: 0, fmt: 'sgn', ctrlGroup: c.id });
      c.curve = ctl(c.id + 'Curve', rel + 3, { label: `${c.name} Curve`, enc: 's7', min: -16, max: 16, def: 0, fmt: 'sgn', ctrlGroup: c.id });
      rel += 4;
    }
  }
  // Init: pressure on the breath controller at full depth, the rest off
  P.presSrc.def = 2;
  P.presDepth.def = 127;
  // a control's depth/curve are inactive while its source is off
  for (const c of CONTROLS) {
    for (const d of [c.depth, c.curve, c.upper, c.lower, c.mode]) if (d) d.active = v => !SRC_OFF(get(v, c.src));
  }

  // ------------------------------------------------------------------ access
  const offsetOf = (v, d) => (kindOf(v) === 'custom' ? d.cst : d.int);
  const has = (v, d) => offsetOf(v, d) != null;
  function get(v, d) {
    const o = offsetOf(v, d);
    if (o == null) return d.def;
    switch (d.enc) {
      case 's8': { const b = ((v[o] & 1) << 7) | (v[o + 1] & 0x7F); return b >= 128 ? b - 256 : b; }
      case 's7': { const b = v[o] & 0x7F; return b >= 64 ? b - 128 : b; }
      case 'nib': return ((v[o] & 0x0F) << 4) | (v[o + 1] & 0x0F);
      case 'u14': return ((v[o] & 0x7F) << 7) | (v[o + 1] & 0x7F);
      case 's9': { const b = ((v[o] & 3) << 7) | (v[o + 1] & 0x7F); return b >= 256 ? b - 512 : b; }
      case 'crf': {
        if (!crfExtended(v)) { const b = ((v[o] & 1) << 7) | (v[o + 1] & 0x7F); return b >= 128 ? b - 256 : b; }
        const b = ((v[o] & 7) << 7) | (v[o + 1] & 0x7F); return b >= 512 ? b - 1024 : b;
      }
      default: return v[o];
    }
  }
  // Child Reed Resonance Frequency (model element 501-564): two bytes like s8,
  // but with "Extended Res. Freq." (element 500) on, a 10-bit value (-512..511),
  // as in the Power User voice SuprJazz.
  const crfExtended = v => v.length === CUSTOM_SIZE && v[COMMON_SIZE + 500] === 1;
  // data bytes as sent in a parameter change / stored in the voice
  function dataBytes(d, val, v) {
    switch (d.enc) {
      case 'crf': {
        if (v && crfExtended(v)) { const b = val & 0x3FF; return [(b >> 7) & 7, b & 0x7F]; }
        const b = Math.max(-128, Math.min(127, val)) & 0xFF; return [(b >> 7) & 1, b & 0x7F];
      }
      case 's8': { const b = val & 0xFF; return [(b >> 7) & 1, b & 0x7F]; }
      case 's7': return [val & 0x7F];
      case 'nib': return [(val >> 4) & 0x0F, val & 0x0F];
      case 'u14': return [(val >> 7) & 0x7F, val & 0x7F];
      case 's9': { const b = val & 0x1FF; return [(b >> 7) & 3, b & 0x7F]; }
      default: return [val & 0x7F];
    }
  }
  function set(v, d, val) {
    const o = offsetOf(v, d);
    if (o == null) return;
    dataBytes(d, val, v).forEach((b, i) => { v[o + i] = b; });
  }
  const labelOf = (d, v) => (typeof d.label === 'function' ? d.label(v) : d.label);
  const optsOf = (d, v) => (typeof d.opts === 'function' ? d.opts(v) : d.opts);
  const maxOf = (d, v) => (d.maxV ? d.maxV(v) : d.max);
  const isActive = (d, v) => has(v, d) && (d.active ? d.active(v) : true);
  const isBipolar = d => d.center != null;
  function format(d, raw, v) {
    if (d.opts) {
      const o = optsOf(d, v);
      const s = o && o[raw - d.min];
      return s != null ? s : String(raw);
    }
    if (d.fmtFn) return d.fmtFn(raw);
    return FMT[d.fmt](raw);
  }

  function readText(v, ofs, n) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const c = v[ofs + i];
      s += c >= 0x20 && c < 0x7F ? String.fromCharCode(c) : ' ';
    }
    return s;
  }
  function writeText(v, ofs, n, text) {
    const s = (text || '').padEnd(n, ' ').slice(0, n);
    for (let i = 0; i < n; i++) {
      const c = s.charCodeAt(i);
      v[ofs + i] = c >= 0x20 && c < 0x7F ? c : 0x20;
    }
  }
  // voice name: 8 characters at the start of both kinds
  const getName = v => readText(v, 0, 8);
  const setName = (v, name) => writeText(v, 0, 8, name);
  // element name: 10 characters, custom voices only
  const getElementName = v => (kindOf(v) === 'custom' ? readText(v, COMMON_SIZE, 10) : '');
  const setElementName = (v, name) => { if (kindOf(v) === 'custom') writeText(v, COMMON_SIZE, 10, name); };
  const displayName = v => getName(v).trimEnd() || '(no name)';
  // short description of the voice's model: "Pr2 010 Air Sax" or "Custom model"
  function sourceLabel(v) {
    if (kindOf(v) === 'custom') return `Model: ${getElementName(v).trimEnd()}`;
    const b = v[0x3B], p = v[0x3C];
    if (b === 2) return `Cst ${p + 1} ${customNames[p] || ''}`.trimEnd();
    const names = b === 1 ? PRESET2 : PRESET1;
    return `${SOURCE_SHORT[b] || '?'} ${String(p + 1).padStart(3, '0')} ${names[p] || ''}`.trimEnd();
  }
  // colour group of a voice button
  const sourceCode = v => (kindOf(v) === 'custom' ? 'model' : ['p1', 'p2', 'cu'][v[0x3B]] || 'p1');

  // ------------------------------------------------------------------ new voices
  const fromB64 = s => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const TEMPLATES = window.VL_TEMPLATES || {};
  function resetFields(v) {
    for (const d of list) if (has(v, d)) set(v, d, d.def);
  }
  // Internal voice: the "not used" bytes come from the most common values of the factory voices
  function newInternal() {
    const v = TEMPLATES.internal ? fromB64(TEMPLATES.internal) : new Uint8Array(INTERNAL_SIZE);
    resetFields(v);
    setName(v, 'Init');
    return v;
  }
  // Custom voice: the model can't be created here, so Init keeps the element's model data
  // and resets the common and the controller set.
  function initCustom(model) {
    const v = new Uint8Array(CUSTOM_SIZE);
    if (TEMPLATES.customCommon) v.set(fromB64(TEMPLATES.customCommon), 0);
    v.set(model.subarray(COMMON_SIZE), COMMON_SIZE);
    resetFields(v);
    setName(v, 'Init');
    return v;
  }
  const cloneVoice = v => new Uint8Array(v);
  const sameVoice = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const commonData = v => v.slice(0, COMMON_SIZE);
  const elementData = v => v.slice(COMMON_SIZE, CUSTOM_SIZE);
  // Current Voice Common Misc (10 00 00, 15 bytes) built from a custom voice common
  function commonMisc(v) {
    const m = new Uint8Array(0x0F);
    for (let i = 0; i < 8; i++) m[i] = v[i];
    m[0x09] = v[0x09]; m[0x0A] = v[0x0A]; m[0x0D] = v[0x0D];
    return m;
  }

  // ------------------------------------------------------------------ files
  function splitSysex(bytes) {
    const out = [];
    let start = -1;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0xF0) start = i;
      else if (bytes[i] === 0xF7 && start >= 0) { out.push(bytes.subarray(start, i + 1)); start = -1; }
    }
    return out;
  }

  // Parses native PLG150-VL bulk dumps (model 57) in any file: .syx, or a
  // Motif "Plugin All Bulk" (.w2b etc.), whose data chunk is the same dumps.
  //   30 00 0n + 31 00 0n  custom voice n     40 00 nn  internal voice nn
  //   10 00 00 + 20 00 00  current voice (a custom voice without its common extras)
  // Returns { custom: Uint8Array[6]|null, internal: Uint8Array[64]|null, single, warnings }.
  function parseSyxFile(bytes) {
    const warnings = [];
    const cc = new Array(6).fill(null), ce = new Array(6).fill(null);
    const ints = new Array(64).fill(null);
    let nInt = 0, badSum = 0, xg = 0;
    const cur = {};
    for (const m of splitSysex(bytes)) {
      if (m.length < 12 || m[1] !== 0x43 || (m[2] & 0xF0) !== 0x00) continue;
      if (m[3] === 0x4C) { xg++; continue; }
      if (m[3] !== 0x57) continue;
      const count = (m[4] << 7) | m[5];
      const [ah, am, al] = [m[6], m[7], m[8]];
      const data = m.subarray(9, m.length - 2);
      if (data.length !== count) continue;
      let sum = 0;
      for (let i = 4; i < m.length - 1; i++) sum += m[i];
      if (sum & 0x7F) badSum++;
      if (ah === 0x30 && am === 0 && al < 6 && count === COMMON_SIZE) cc[al] = new Uint8Array(data);
      else if (ah === 0x31 && am === 0 && al < 6 && count === ELEMENT_SIZE) ce[al] = new Uint8Array(data);
      else if (ah === 0x40 && am === 0 && al < 64 && count === INTERNAL_SIZE) { ints[al] = new Uint8Array(data); nInt++; }
      else if (ah === 0x10 && am === 0 && al === 0 && count === 0x0F) cur.misc = data;
      else if (ah === 0x20 && am === 0 && al === 0 && count === ELEMENT_SIZE) cur.elem = data;
    }
    if (badSum) warnings.push(`${badSum} message(s) with a wrong checksum (loaded anyway)`);
    const customs = [];
    for (let i = 0; i < 6; i++) {
      if (cc[i] && ce[i]) { const v = new Uint8Array(CUSTOM_SIZE); v.set(cc[i]); v.set(ce[i], COMMON_SIZE); customs[i] = v; }
      else if (ce[i]) { const v = initCustom(new Uint8Array(CUSTOM_SIZE).fill(0)); v.set(ce[i], COMMON_SIZE); writeText(v, 0, 8, readText(ce[i], 0, 8)); customs[i] = v; warnings.push(`Custom voice ${i + 1} has no common block: common initialized`); }
    }
    const nCustom = customs.filter(Boolean).length;
    let single = null;
    if (cur.elem) {
      single = initCustom(new Uint8Array(CUSTOM_SIZE));
      single.set(cur.elem, COMMON_SIZE);
      if (cur.misc) { for (let i = 0; i < 8; i++) single[i] = cur.misc[i]; single[0x09] = cur.misc[0x09]; single[0x0A] = cur.misc[0x0A]; single[0x0D] = cur.misc[0x0D]; }
      else setName(single, readText(cur.elem, 0, 8));
    }
    // a file with just one voice is loaded into the edit buffer
    if (!single && nCustom === 1 && nInt === 0) single = customs.find(Boolean);
    if (!single && nInt === 1 && nCustom === 0) single = ints.find(Boolean);
    const isSingle = single && nCustom + nInt <= 1;
    let custom = null, internal = null;
    if (!isSingle && nCustom) {
      const tpl = customs.find(Boolean);
      custom = customs.map(v => v || initCustom(tpl));
      if (nCustom < 6) warnings.push(`File has ${nCustom} custom voice(s); the other slots are Init voices with the model of the first one`);
    }
    if (!isSingle && nInt) {
      internal = ints.map(v => v || newInternal());
      if (nInt < 64) warnings.push(`File has ${nInt} internal voice(s); the other slots are Init Voice`);
    }
    if (xg && !nCustom && !nInt && !single) warnings.push('Only XG part data found: this editor reads PLG150-VL native voice dumps');
    return { custom, internal, single: isSingle ? single : null, warnings };
  }

  // VL70m Expert Editor library (.lib, D. Rice and A. Michael): a 0xC00-byte
  // header ("LM  0268", "VED1.0 Beta", "P_VER_3.30R", then 128 8-character voice
  // names at 0x400 and 128 x 8 spaces at 0x800), followed by up to 128 custom
  // voices of 1550 bytes (common 163 + element 1387), the same layout as here.
  const LIB_HEADER = 0xC00, LIB_VOICES = 128;
  const LIB_SIGNATURE = 'LM  0268        VED1.0 Beta     P_VER_3.30R     ';
  // header bytes 0x30-0x57 of VLEDITOR.LIB (meaning unknown), kept in written files
  const LIB_EXTRA = [0x1a, 0x01, 0x00, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x04, 0x00, 0x00, 0x7f, 0x00, 0x40, 0x00,
    0, 0, 0, 0, 0x40, 0, 0, 0, 0x00, 0x30, 0x50, 0x2a, 0x1b, 0x50, 0x25, 0x65];
  const isLibFile = bytes => bytes.length >= LIB_HEADER + CUSTOM_SIZE && readText(bytes, 0, 4) === 'LM  ';
  function parseLibFile(bytes) {
    const n = Math.min(LIB_VOICES, Math.floor((bytes.length - LIB_HEADER) / CUSTOM_SIZE));
    return Array.from({ length: n }, (_, i) =>
      bytes.slice(LIB_HEADER + i * CUSTOM_SIZE, LIB_HEADER + (i + 1) * CUSTOM_SIZE).map(b => b & 0x7F));
  }
  // A library always holds 128 voices: missing ones are Init voices with the
  // model of the first voice.
  function buildLibFile(voices) {
    const out = new Uint8Array(LIB_HEADER + LIB_VOICES * CUSTOM_SIZE);
    writeText(out, 0, LIB_SIGNATURE.length, LIB_SIGNATURE);
    out.set(LIB_EXTRA, 0x30);
    out.fill(0x20, 0x800, LIB_HEADER);
    for (let i = 0; i < LIB_VOICES; i++) {
      const v = voices[i] || initCustom(voices[0]);
      out.set(v, LIB_HEADER + i * CUSTOM_SIZE);
      writeText(out, 0x400 + i * 8, 8, getName(v));
    }
    return out;
  }

  function base64ToBytes(b64) { return fromB64(b64); }
  function bytesToBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const voiceSize = kind => (kind === 'custom' ? CUSTOM_SIZE : INTERNAL_SIZE);
  function splitBank(bytes, kind) {
    const n = voiceSize(kind);
    return Array.from({ length: Math.floor(bytes.length / n) }, (_, i) => bytes.slice(i * n, (i + 1) * n));
  }
  function joinBank(voices) {
    const n = voices.length ? voices[0].length : 0;
    const out = new Uint8Array(voices.length * n);
    voices.forEach((v, i) => out.set(v, i * n));
    return out;
  }

  window.VL = {
    COMMON_SIZE, ELEMENT_SIZE, INTERNAL_SIZE, CUSTOM_SIZE, CTL_ELEM,
    P, list, CONTROLS, get, set, dataBytes, has, labelOf, optsOf, maxOf, isActive, isBipolar, format, FMT,
    kindOf, getName, setName, getElementName, setElementName, displayName, sourceLabel, sourceCode,
    newInternal, initCustom, cloneVoice, sameVoice, commonData, elementData, commonMisc,
    splitSysex, parseSyxFile, isLibFile, parseLibFile, buildLibFile, base64ToBytes, bytesToBase64, splitBank, joinBank, voiceSize,
    noteName, srcName, srcShort, SRC_OFF, SOURCES, PRESET1, PRESET2, SOURCE_BANKS, CTRL_ROWS,
    setCustomNames: names => { customNames = names.slice(0, 6); },
  };
})();
