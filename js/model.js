// PLG150-VL model (element) parameters: the physical model of a custom voice.
//
// Yamaha doesn't document the model area of the element (bytes 3D-56A are "not
// used" in the manual). This map was reverse engineered from the VL70m Expert
// Editor (VLEDITOR.EXE, D. Rice and A. Michael, 1999): its parameter table gives
// the offset, range and options of each parameter, its dialogs give the names,
// and Manny Fernandez's VL Programming Guide gives the breakpoint counts. The
// map was checked against the 128 voices of VLEDITOR.LIB and the 6 Power User
// custom voices (every value in range, every breakpoint list in note order).
//
// Offsets (o) are element byte offsets; in a custom voice add COMMON_SIZE.
// Encodings: u7 one byte, s7 7-bit signed, s8 two bytes -128..127 (bit 7, bits
// 6-0), u14 two bytes 0..255 (MSB, LSB), s9 two bytes -256..255, note (0 = C-2),
// enum (one byte, opts), crf (Child Reed Res. Freq.: s8, or 10 bits with Extended
// Res. Freq. on).
// dual: two values (e.g. the Low and High embouchure limits), stored one after
// the other.
// bp: breakpoints (the [>] parameters). After the value(s) come bp entries of
// (note, offset[, offset 2]), notes ascending; an offset is added to the value
// for that note. Unused entries repeat the last used one.
// Not mapped (kept as is): element 3D-45, the second byte of the resonator
// delays, and the two per-note tables at 3EB-56A (most likely the tube length
// per note written by the Expert Editor's tuning function, and a second
// per-note byte).
(function () {
  'use strict';

  const { COMMON_SIZE } = VL;

  const PAGES = [
    { name: "Pipe & Driver", groups: [
      { name: "Algorithm", params: [
        { o: 672, label: "Algorithm", enc: 'enum', opts: ["Pipe + Breath Noise", "String + Breath Noise", "Pipe", "String"], title: "Resonator type and whether breath noise is mixed in" },
      ] },
      { name: "Pipe", params: [
        { o: 238, label: "Short Length Mode", enc: 'enum', opts: ["Absolute", "Relative"] },
        { o: 239, label: "Short Length / Ratio", enc: 'u14', bp: 16, title: "Distance of the driver from the closed end of the tube (absolute) or its ratio to the total length (relative)" },
        { o: 289, label: "High Freq. Abs. Mode", enc: 'enum', opts: ["Both", "One"] },
        { o: 290, label: "Absorption", enc: 'u7', bp: 8, title: "Cutoff of the filter that models high-frequency loss at the bell" },
        { o: 307, label: "Damping/Decay", enc: 'u7', bp: 6, dual: ["A", "B"], title: "Two values: per the VL guide one applies while the key is held (decay) and one after release (damping). Which byte is which is not confirmed." },
        { o: 327, label: "Register Key Open", enc: 'note', title: "Note at which the register (octave) key opens" },
        { o: 328, label: "Low/High Mode Balance", enc: 'u7', bp: 4, title: "1st harmonic damping: balance between the low and high modes" },
      ] },
      { name: "Driver", params: [
        { o: 337, label: "Pressure Input Gain", enc: 's7', bp: 8 },
        { o: 354, label: "Pressure Level to Reed", enc: 'u7', bp: 5 },
        { o: 365, label: "Slit Sign", enc: 'enum', opts: ["Neg", "Pos"], title: "Direction in which the reed oscillates" },
        { o: 366, label: "Add. Reed Aperture", enc: 's7', title: "Additional gap between the reed and the mouthpiece" },
        { o: 367, label: "Slit Sat. Feedback Bal.", enc: 's7', title: "Balance between the inner (simple) and outer (complex) slit saturation feedback" },
        { o: 368, label: "Graham Function Arg.", enc: 's7', bp: 5 },
        { o: 379, label: "Driver Output", enc: 'enum', opts: ["Shut Off", "Through"] },
        { o: 380, label: "Driver Output Level", enc: 's7', max: 55, bp: 5 },
      ] },
      { name: "Parent Reed", params: [
        { o: 396, label: "Force to Parent Reed", enc: 'u7' },
        { o: 397, label: "Output Level", enc: 'u7' },
        { o: 398, label: "Cutoff", enc: 'u7', bp: 5 },
        { o: 409, label: "Lip Collision", enc: 's7', bp: 5 },
      ] },
    ] },
    { name: "Reed & Excitation", groups: [
      { name: "Child Reed", params: [
        { o: 391, label: "Force to Child Reed", enc: 'u7' },
        { o: 392, label: "Reed Displ. Output", enc: 'u7' },
        { o: 393, label: "Reed Velocity Output", enc: 'u7' },
        { o: 394, label: "Resonance Control", enc: 'enum', opts: ["Absolute", "Relative"] },
        { o: 395, label: "Resonance Lag Time", enc: 'u7' },
      ] },
      { name: "Embouchure Control", params: [
        { o: 422, label: "Slit Initial Aperture", enc: 'u7', bp: 8, dual: ["Low", "High"] },
        { o: 448, label: "Mouthpiece Narrowness", enc: 'u7', bp: 8, dual: ["Low", "High"] },
        { o: 474, label: "Reed Flexibility", enc: 'u7', bp: 8, dual: ["Low", "High"] },
        { o: 500, label: "Extended Res. Freq.", enc: 'enum', opts: ["Off", "On"], refresh: true, title: "Extended range of the child reed resonance frequency" },
        { o: 501, label: "Child Reed Res. Freq.", enc: 'crf', bp: 12, dual: ["Low", "High"], title: "-128..127, or -512..511 with Extended Res. Freq. on (the stored bytes are read differently when you switch it)" },
        { o: 565, label: "Child Reed Res. Amount", enc: 'u7', bp: 12, dual: ["Low", "High"] },
      ] },
      { name: "Pressure Control", params: [
        { o: 420, label: "Pressure to Reed Thickness", enc: 'u7', max: 16 },
        { o: 421, label: "Pressure to Reed Res.", enc: 'u7', max: 16 },
      ] },
      { name: "Beat", params: [
        { o: 603, label: "Amount", enc: 's7', bp: 8 },
        { o: 620, label: "High Freq. Emphasis", enc: 'u7', max: 125, bp: 6 },
      ] },
      { name: "Excitation", params: [
        { o: 633, label: "Level to Pipe", enc: 's8', bp: 3 },
        { o: 644, label: "Level to Reed", enc: 's8', bp: 3 },
        { o: 655, label: "LPF Cutoff", enc: 'u7', bp: 3 },
        { o: 665, label: "Pulse Width", enc: 'u7', bp: 3 },
        { o: 662, label: "Velocity → Level", enc: 'u7', max: 16 },
        { o: 663, label: "Velocity → Cutoff", enc: 'u7', max: 16 },
        { o: 664, label: "Velocity → Width", enc: 'u7', max: 16 },
      ] },
      { name: "Compensation", params: [
        { o: 965, label: "Pitch Compensation", enc: 's9', bp: 12 },
      ] },
    ] },
    { name: "Noise & Throat", groups: [
      { name: "Breath Noise", params: [
        { o: 95, label: "Kind", enc: 'enum', opts: ["Normal", "Harsh 1", "Harsh 2", "Low Lips 1", "Low Lips 2", "Med Lips 1", "Med Lips 2", "Hi Lips 1", "Hi Lips 2", "Jet", "Lo Jet", "Med Jet", "Hi Jet", "Stream 1", "Stream 2", "Stream 3", "Stream 4", "Plastic 1", "Plastic 2", "Dark Woody", "Metal 1", "Metal 2", "Rain"] },
        { o: 72, label: "Level", enc: 'u7', bp: 6 },
        { o: 85, label: "HPF Cutoff", enc: 'u7', max: 125, bp: 2 },
        { o: 90, label: "LPF Cutoff", enc: 'u7', bp: 2 },
        { o: 96, label: "Key-on Reset", enc: 'enum', opts: ["Off", "On"] },
        { o: 97, label: "Function Input Gain", enc: 'u7', max: 32 },
        { o: 98, label: "Level Ctrl Balance", enc: 's7' },
      ] },
      { name: "Throat Formant", params: [
        { o: 99, label: "Pitch Tracking", enc: 'enum', opts: ["Fixed", "Key Track"] },
        { o: 100, label: "Pitch", enc: 's8', min: -128, bp: 8 },
        { o: 126, label: "Intensity", enc: 's8', bp: 4 },
        { o: 140, label: "Amount", enc: 's7', bp: 4 },
        { o: 149, label: "HPF", enc: 'u7', max: 125, bp: 3 },
        { o: 156, label: "LPF", enc: 'u7', bp: 3 },
      ] },
      { name: "Mixing / Amplitude", params: [
        { o: 163, label: "Driver Output Mix", enc: 'u7', bp: 6 },
        { o: 176, label: "Pipe/String Output Mix", enc: 'u7', bp: 6 },
        { o: 189, label: "Tap Output Mix", enc: 'u7', bp: 6 },
        { o: 202, label: "Tap Output Sign", enc: 'enum', opts: ["Neg", "Pos"] },
        { o: 203, label: "Tap Position", enc: 'enum', opts: ["Driving Point", "Fixed", "Key Track"] },
        { o: 204, label: "Tap Location", enc: 'u7', bp: 8 },
        { o: 221, label: "Total Amplitude Level", enc: 'u7', bp: 8 },
      ] },
      { name: "Speed", params: [
        { o: 70, label: "Crossfade Speed", enc: 'u7', max: 96 },
        { o: 71, label: "Interpolate Speed", enc: 'u7', max: 50 },
      ] },
    ] },
    { name: "Modifiers & EQ", groups: [
      { name: "Harmonic Enhancer", params: [
        { o: 673, label: "Carrier Wave", enc: 'enum', opts: ["Normal", "Breath Noise", "Flow Rate", "Beat", "Slit Friction", "Reed"] },
        { o: 674, label: "Carrier HPF", enc: 'u7', bp: 4 },
        { o: 683, label: "Carrier Overdrive", enc: 's7', bp: 4 },
        { o: 692, label: "Carrier Level", enc: 'u7', bp: 6 },
        { o: 705, label: "Modulator Wave", enc: 'enum', opts: ["Normal", "Breath Noise", "Flow Rate", "Beat", "Slit Friction", "Reed"] },
        { o: 706, label: "Modulator HPF", enc: 'u7', bp: 2 },
        { o: 711, label: "Modulator Overdrive", enc: 's7', bp: 2 },
        { o: 716, label: "Modulator Phase", enc: 'u7' },
        { o: 717, label: "Modulator Index", enc: 'u7', bp: 4 },
        { o: 726, label: "Wet/Dry Balance", enc: 's7', bp: 4 },
      ] },
      { name: "Dynamic Filter", params: [
        { o: 735, label: "Type", enc: 'enum', opts: ["LPF", "BPF", "HPF", "BEF"] },
        { o: 736, label: "Input Gain", enc: 'u7' },
        { o: 737, label: "Cutoff Mode", enc: 'enum', opts: ["Fixed", "Key Track"] },
        { o: 738, label: "Cutoff", enc: 'u7', bp: 3 },
        { o: 745, label: "Resonance", enc: 'u7', bp: 3 },
        { o: 752, label: "Wet/Dry Balance", enc: 's7' },
      ] },
      { name: "Equalizer", params: [
        { o: 753, label: "Input Gain", enc: 'u7' },
        { o: 772, label: "Post EQ Boost", enc: 's7', min: -8, max: 8 },
        { o: 754, label: "HPF Cutoff", enc: 'u7', bp: 4 },
        { o: 763, label: "LPF Cutoff", enc: 'u7', bp: 4 },
        { o: 773, label: "EQ1 Frequency", enc: 'u7', max: 48 },
        { o: 774, label: "EQ1 Resonance", enc: 'u7' },
        { o: 775, label: "EQ1 Level", enc: 's7' },
        { o: 776, label: "EQ2 Frequency", enc: 'u7', min: 22, max: 70 },
        { o: 777, label: "EQ2 Resonance", enc: 'u7' },
        { o: 778, label: "EQ2 Level", enc: 's7' },
        { o: 779, label: "EQ3 Frequency", enc: 'u7', min: 42, max: 90 },
        { o: 780, label: "EQ3 Resonance", enc: 'u7' },
        { o: 781, label: "EQ3 Level", enc: 's7' },
        { o: 782, label: "EQ4 Frequency", enc: 'u7', min: 64, max: 112 },
        { o: 783, label: "EQ4 Resonance", enc: 'u7' },
        { o: 784, label: "EQ4 Level", enc: 's7' },
        { o: 785, label: "EQ5 Frequency", enc: 'u7', min: 64 },
        { o: 786, label: "EQ5 Resonance", enc: 'u7' },
        { o: 787, label: "EQ5 Level", enc: 's7' },
      ] },
      { name: "Resonator (strings)", params: [
        { o: 789, label: "Input Gain", enc: 'u7' },
        { o: 790, label: "Delay 1", enc: 'u7', max: 102 },
        { o: 792, label: "Delay 2", enc: 'u7', max: 102 },
        { o: 794, label: "Delay 3", enc: 'u7', max: 102 },
        { o: 796, label: "Delay 4", enc: 'u7', max: 102 },
        { o: 798, label: "Decay Time", enc: 'u7' },
        { o: 799, label: "LPF Cutoff", enc: 'u7' },
        { o: 800, label: "Conjunction", enc: 's7' },
        { o: 801, label: "Phase", enc: 's7', min: -16, max: 16 },
        { o: 802, label: "Wet Level", enc: 'u7' },
        { o: 803, label: "Dry Level", enc: 'u7' },
      ] },
    ] },
    { name: "Envelopes", groups: [
      { name: "Pressure EG", params: [
        { o: 860, label: "Mode", enc: 'enum', opts: ["Disable", "ASDR", "AR"] },
        { o: 804, label: "Velocity → Level", enc: 'u7', max: 16 },
        { o: 805, label: "Velocity → Rate", enc: 'u7', max: 16 },
        { o: 806, label: "Attack Rate 1", enc: 'u7', bp: 4 },
        { o: 815, label: "Attack Level 1", enc: 'u7', bp: 4 },
        { o: 824, label: "Attack Rate 2", enc: 'u7', bp: 4 },
        { o: 833, label: "Decay Rate", enc: 'u7', bp: 4 },
        { o: 842, label: "Sustain Level", enc: 'u7', bp: 4 },
        { o: 851, label: "Release Rate", enc: 'u7', bp: 4 },
      ] },
      { name: "Embouchure / Pitch EG", params: [
        { o: 861, label: "Velocity → Level", enc: 'u7', max: 16 },
        { o: 862, label: "Velocity → Rate", enc: 'u7' },
        { o: 863, label: "Hold Time", enc: 'u7', bp: 2 },
        { o: 868, label: "Initial Level", enc: 's7', bp: 2 },
        { o: 873, label: "Attack Rate", enc: 'u7', bp: 2 },
        { o: 878, label: "Attack Level", enc: 'u7', bp: 2 },
        { o: 883, label: "Decay Rate", enc: 'u7', bp: 2 },
        { o: 888, label: "Release Rate", enc: 'u7', bp: 2 },
        { o: 893, label: "Release Level", enc: 'u7', bp: 2 },
        { o: 898, label: "Depth → Embouchure", enc: 'u7', max: 64 },
        { o: 899, label: "Depth → Pitch", enc: 'u7', max: 64 },
      ] },
      { name: "Vibrato", params: [
        { o: 900, label: "Delay Time", enc: 'u7', bp: 2 },
        { o: 905, label: "Sustain Level", enc: 'u7', bp: 2 },
        { o: 910, label: "Depth", enc: 'u7' },
        { o: 911, label: "Depth → Embouchure", enc: 'u7' },
        { o: 912, label: "Depth → Pitch", enc: 'u7' },
        { o: 913, label: "Depth → Pressure", enc: 'u7' },
        { o: 914, label: "Offset", enc: 's8' },
        { o: 916, label: "Speed", enc: 'u7', bp: 2 },
        { o: 921, label: "Speed Shift", enc: 'u7', max: 16 },
      ] },
      { name: "Growl", params: [
        { o: 922, label: "Depth → Pressure", enc: 'u7' },
        { o: 923, label: "Offset", enc: 's8' },
        { o: 925, label: "Speed", enc: 'u7', bp: 2 },
      ] },
      { name: "Amplitude / Filter EG", params: [
        { o: 930, label: "Velocity → Level", enc: 'u7', max: 16 },
        { o: 931, label: "Velocity → Rate", enc: 'u7', max: 16 },
        { o: 932, label: "Attack Rate 1", enc: 'u7', bp: 2 },
        { o: 937, label: "Attack Level 1", enc: 'u7', bp: 2 },
        { o: 942, label: "Attack Rate 2", enc: 'u7', bp: 2 },
        { o: 947, label: "Decay Rate", enc: 'u7', bp: 2 },
        { o: 952, label: "Sustain Level", enc: 'u7', bp: 2 },
        { o: 957, label: "Release Rate", enc: 'u7', bp: 2 },
        { o: 962, label: "Depth → Amplitude", enc: 'u7' },
        { o: 963, label: "Depth → Filter", enc: 's8' },
      ] },
    ] },  ];

  // Short field labels (the full name is in the tooltip, the LCD and the
  // breakpoint tables). The group heading gives the context, e.g. "Force → Reed"
  // under Child Reed or Parent Reed.
  const SHORT = {
    'Short Length Mode': 'Length Mode', 'Short Length / Ratio': 'Short Length', 'High Freq. Abs. Mode': 'HF Abs. Mode',
    'Register Key Open': 'Register Key', 'Low/High Mode Balance': 'Lo/Hi Balance',
    'Pressure Input Gain': 'Press. Gain', 'Pressure Level to Reed': 'Press. → Reed', 'Add. Reed Aperture': 'Add. Aperture',
    'Slit Sat. Feedback Bal.': 'Slit Sat. Bal.', 'Graham Function Arg.': 'Graham Arg.', 'Driver Output Level': 'Output Level',
    'Force to Parent Reed': 'Force → Reed', 'Force to Child Reed': 'Force → Reed', 'Reed Displ. Output': 'Displ. Output',
    'Reed Velocity Output': 'Vel. Output', 'Resonance Control': 'Res. Control', 'Resonance Lag Time': 'Res. Lag Time',
    'Extended Res. Freq.': 'Ext. Res. Freq', 'Pressure to Reed Thickness': 'Press. → Thick.', 'Pressure to Reed Res.': 'Press. → Res.',
    'High Freq. Emphasis': 'HF Emphasis', 'Pitch Compensation': 'Pitch Comp.',
    'Function Input Gain': 'Func. Input', 'Level Ctrl Balance': 'Lvl Ctrl Bal.', 'Pitch Tracking': 'Pitch Track',
    'Driver Output Mix': 'Driver Mix', 'Pipe/String Output Mix': 'Pipe/Str. Mix', 'Tap Output Mix': 'Tap Mix',
    'Tap Output Sign': 'Tap Sign', 'Total Amplitude Level': 'Total Level', 'Crossfade Speed': 'Xfade Speed',
    'Interpolate Speed': 'Interp. Speed', 'Carrier Overdrive': 'Carrier Drive', 'Modulator Wave': 'Mod. Wave',
    'Modulator HPF': 'Mod. HPF', 'Modulator Overdrive': 'Mod. Drive', 'Modulator Phase': 'Mod. Phase',
    'Modulator Index': 'Mod. Index', 'Wet/Dry Balance': 'Wet/Dry',
    'Velocity → Level': 'Vel → Level', 'Velocity → Rate': 'Vel → Rate', 'Velocity → Cutoff': 'Vel → Cutoff',
    'Velocity → Width': 'Vel → Width', 'Attack Level 1': 'Atk Level 1', 'Depth → Embouchure': 'Depth → Emb.',
    'Depth → Pressure': 'Depth → Press.', 'Depth → Amplitude': 'Depth → Amp', 'Depth → Filter': 'Depth → Filt.',
  };

  const NB = { u7: 1, s7: 1, enum: 1, note: 1, s8: 2, u14: 2, s9: 2, crf: 2 };      // bytes per value
  const ENC = { u7: 'u7', enum: 'u7', note: 'u7', s7: 's7', s8: 's8', u14: 'u14', s9: 's9', crf: 'crf' };
  const OFS_ENC = { u7: 's7', enum: 's7', note: 's7', s7: 's7', s8: 's8', u14: 's8', s9: 's9', crf: 'crf' };
  const RANGE = { u7: [0, 127], s7: [-64, 63], s8: [-127, 127], u14: [0, 255], s9: [-256, 255], note: [0, 127], crf: [-512, 511] };
  const OFS_RANGE = { s7: [-64, 63], s8: [-128, 127], s9: [-256, 255], crf: [-512, 511] };

  // A model parameter is a voice parameter (same shape as VL.P entries) with
  // only a custom voice offset (cst): internal voices have no model.
  const defs = [];
  const mk = (key, o) => {
    const d = Object.assign({ key, int: null, def: 0, live: null, model: true, center: null }, o);
    defs.push(d);
    return d;
  };
  const valueDef = (p, key, off, label) => {
    const [lo, hi] = p.enc === 'enum' ? [0, p.opts.length - 1] : RANGE[p.enc];
    const min = p.min != null ? p.min : lo, max = p.max != null ? p.max : hi;
    return mk(key, {
      label, cst: COMMON_SIZE + off, enc: ENC[p.enc], min, max, opts: p.opts || null,
      fmt: p.enc === 'note' ? 'note' : min < 0 ? 'sgn' : 'num', title: p.title, refreshAll: !!p.refresh,
    });
  };

  const params = [];
  for (const page of PAGES) {
    for (const g of page.groups) {
      for (const p of g.params) {
        const nb = NB[p.enc], nv = p.dual ? 2 : 1;
        p.key = 'm' + p.o;
        p.short = SHORT[p.label] || p.label;
        p.values = p.dual
          ? [valueDef(p, p.key, p.o, `${p.label} ${p.dual[0]}`), valueDef(p, 'm' + (p.o + nb), p.o + nb, `${p.label} ${p.dual[1]}`)]
          : [valueDef(p, p.key, p.o, p.label)];
        if (p.bp) {
          const bp = { key: 'bp' + p.o, param: p, n: p.bp, start: p.o + nb * nv, es: 1 + nb * nv, entries: [] };
          const [olo, ohi] = OFS_RANGE[OFS_ENC[p.enc]];
          for (let i = 0; i < p.bp; i++) {
            const e = bp.start + i * bp.es;
            const note = mk(`m${p.o}n${i}`, { label: `${p.label} BP${i + 1} Note`, cst: COMMON_SIZE + e, enc: 'u7', min: 0, max: 127, fmt: 'note', bp, bpIndex: i, bpNote: true });
            const offs = range(nv, j => mk(`m${p.o}o${j}${i}`, {
              label: `${p.label}${p.dual ? ' ' + p.dual[j] : ''} BP${i + 1} Offset`,
              cst: COMMON_SIZE + e + 1 + j * nb, enc: OFS_ENC[p.enc], min: olo, max: ohi, fmt: 'sgn', bp, bpIndex: i,
            }));
            bp.entries.push({ note, offs });
          }
          p.bpInfo = bp;
        }
        params.push(p);
      }
    }
  }
  function range(n, f) { return Array.from({ length: n }, (_, i) => f(i)); }

  // ---------------------------------------------------------------- breakpoints
  const entryAt = (v, bp, i) => COMMON_SIZE + bp.start + i * bp.es;
  const entryBytes = (v, bp, i) => v.subarray(entryAt(v, bp, i), entryAt(v, bp, i) + bp.es);
  const same = (a, b) => a.every((x, i) => x === b[i]);
  // number of breakpoints in use: trailing copies of the last one are padding
  function used(v, bp) {
    let k = bp.n;
    while (k > 1 && same(entryBytes(v, bp, k - 1), entryBytes(v, bp, k - 2))) k--;
    return k;
  }
  // fills entries k.. with copies of entry k-1
  function pad(v, bp, k) {
    const last = entryBytes(v, bp, k - 1).slice();
    for (let i = k; i < bp.n; i++) v.set(last, entryAt(v, bp, i));
  }
  // Changes the number of breakpoints in use. Removing keeps the first k.
  // Adding copies the last one at higher notes, which doesn't change the sound
  // until the new breakpoints are edited. Returns false if no note is left above
  // the last breakpoint.
  function setUsed(v, bp, k) {
    const cur = used(v, bp);
    if (k < cur) { pad(v, bp, k); return true; }
    if (k === cur) return true;
    const last = entryBytes(v, bp, cur - 1).slice();
    const add = k - cur;
    if (127 - last[0] < add) return false;
    const step = Math.max(1, Math.floor((127 - last[0]) / (add + 1)));
    for (let i = 0; i < add; i++) {
      const e = last.slice();
      e[0] = Math.min(127, last[0] + step * (i + 1));
      v.set(e, entryAt(v, bp, cur + i));
    }
    pad(v, bp, k);
    return true;
  }
  // notes must stay in order: the allowed range of breakpoint i's note
  function noteRange(v, bp, i, k) {
    const note = j => v[entryAt(v, bp, j)];
    return [i > 0 ? note(i - 1) : 0, i < k - 1 ? note(i + 1) : 127];
  }

  window.VLModel = { PAGES, params, defs, used, pad, setUsed, noteRange };
})();
