# PLG150-VL Web Editor

Browser editor/librarian for the Yamaha PLG150-VL (Virtual Acoustic, physical modelling)
plug-in board in a Modular Synthesis Plug-in host synth. It talks to the board with the
**PLG150-VL Native** SysEx messages (the VL70-m format).

You can use it directly at this link: https://urtzurd.github.io/plg150-vl-web-editor/

## Running

The editor needs Web MIDI with SysEx access:

- **Chrome or Edge**: open `index.html` directly, or serve the folder (below).
- **Firefox** (113 or later) should also work, but only from a served page (not
  `file://`), and it asks you to install a site permission add-on to grant MIDI access.
  Not tested.
- **Safari** has no Web MIDI and is not supported.

To serve the folder: `python3 -m http.server 8150`, then open http://localhost:8150

Click **Enable MIDI** and allow SysEx access. Then pick the MIDI Out port connected to the host
synth, the Device ID (must match the Device Number set on the host synth), the keyboard
channel (the host synth's receive channel for the PLG150-VL part) and the PLG Part (used by
the native part messages).

## What can be edited

A VL voice is a physical model (driver, pipe or string, modifiers) plus a set of
controls that say how the player drives it. Yamaha documents the controls but not the model
data, which was made with the VL Visual Editor. This editor edits the controls and the voice
settings, and the model of custom voices on the **Model** tab, using a map of the model data
taken from the VL70m Expert Editor (see [Model data](#model-data)). The board has two kinds of
writable voices:

- **Internal voices** (bank 33/3, 64 slots, the VL70-m compatible voices). Each one points to a
  **board voice** (one of the 256 presets or one of the 6 custom voices), whose model it
  plays, and has its own controls, level, assign mode and key scaling. This is the way to make
  your own versions of the preset voices.
- **Custom voices** (bank 33/2, 6 slots). A complete voice that carries its own model, plus a
  common part with portamento, bend range, controller routings (MW, bend, aftertouch, AC1),
  scale tuning and effect sends.

The twelve **VL controls** are the heart of a voice: Pressure, Embouchure, Tonguing, Breath
Noise, Scream, Growl, Throat Formant, Harmonic Enhancer, Damping, Absorption, Filter and
Amplitude. Each has a source (off, CC 1–95, aftertouch, velocity or pitch bend), a depth
(−127 to +127) and a curve (−16 to +16); Embouchure has an upper and a lower depth and a
Center Base / Minimum Base mode.

## Using it

- **Voices**: pick a bank and click a voice button. The colour shows the model the voice uses:
  amber = a Preset 1 voice (made for keyboard playing), blue = Preset 2 (made for breath
  control), green = a custom voice, light grey = a custom voice with its own model. The grid
  shows two rows (scroll for the rest); **▼ All voices** shows the whole bank.
  **Store…** then a voice button stores the edit buffer in the bank (internal voices go to
  internal banks, custom voices to custom banks); **Compare** switches between the edited and
  the stored voice (changed controls blink).
- **Knobs**: drag up/down (Shift for fine steps), use the arrow keys / Page Up / Page Down after
  clicking one, or click the value under it and type a new one (e.g. `-12`, `C3`). Double-click
  resets a knob to its default.
- **Lamp lists** (assign mode, expression mode, board voice bank): the button steps through the
  options, or click an option.
- Each VL control has a small graph of its response: x is the controller, y the change of the
  parameter. Yamaha documents the ranges but not the curve shapes, so the graph is a sketch:
  a curve value bends the line (minus = a small controller movement does a lot), pitch bend
  and Center Base work around the controller centre.
- The footer has pitch, modulation, **breath** (CC 2) and **aftertouch** wheels. Breath and
  aftertouch stay where you leave them (double-click for 0), so you can "blow" a voice with
  the mouse while playing the keys. With no breath controller, set **Breath Mode** to Velocity
  or Touch EG on the Native tab.
- While a voice or bank is being sent, the page shows a wait cursor and ignores clicks and keys
  (Send Bank's Stop button and Esc still work).

## Tabs

- **Voice**: the main panel. The top row shows the voice (name, level, assign mode,
  expression mode, portamento mode), then for internal voices the board voice it plays and
  the key scaling, or for custom voices the element name, a fingerprint of its model
  and the portamento / bend range. Below, the twelve VL controls.
- **Detail**: every voice parameter as a list, including the custom voice common
  (controller routings, scale tuning, effect sends).
- **Model** (custom voices): the physical model, on five pages: Pipe & Driver, Reed &
  Excitation, Noise & Throat, Modifiers & EQ, Envelopes. Parameters with **Breakpoints** change
  across the keyboard: each breakpoint is a note and an offset added to the value from that
  note up. **▼ n of N** opens the breakpoint table; *Breakpoints in use* adds breakpoints (copies
  of the last one at higher notes, so the sound doesn't change until you edit them) or removes
  the last ones. Breakpoint notes stay in order. Internal voices have no model of their own.
- **PLG150-VL Native**: the board's system settings (breath mode, breath controller number and
  curve, WX lip, velocity and Touch EG response) and the part key scaling. Not stored in the
  voice; sent as soon as you change them.
- **MIDI Monitor**: log of every message sent.

## Messages sent

| Action | Message |
|---|---|
| Edit a control (Live edit on) | `F0 43 1n 57 20 00 pp vv F7` (Current Voice element, pp = 0A–3C). Depths send two bytes: −127 = `01 01`, +127 = `00 7F`. |
| Edit the model (Model tab, Live edit on) | Current Voice element bulk dump (`20 00 00`, 1387 bytes), 400 ms after the last change, once you release a dragged value or leave a typed one. Like a voice change, the page shows the wait cursor while it is sent. No model parameter changes are sent: they aren't documented. |
| Edit level, assign mode, portamento mode | `F0 43 1n 57 10 00 pp vv F7` (Current Voice common, pp = 09, 0A, 0D) |
| Edit the key scaling of an internal voice | `F0 43 1n 57 09 0p 17–1A vv F7` (part p) |
| Send Voice / select a voice (Auto send), custom voice | Current Voice bulk dumps: common (`10 00 00`, 15 bytes) and element (`20 00 00`, 1387 bytes, with the model) |
| Send Voice / select a voice (Auto send), internal voice | The parameter changes above, for all its controls and settings |
| Send Bank, Internal bank | 64 Internal Voice bulk dumps (`40 00 nn`, 163 bytes each) to the Internal bank (Bank MSB 33, LSB 3, programs 1–64). Click again to stop. |
| Send Bank, Custom bank | 6 × Custom Voice common (`30 00 0n`, 163 bytes) + element (`31 00 0n`, 1387 bytes) to the Custom bank (Bank MSB 33, LSB 2, programs 1–6). Click again to stop. |
| Store with **Store → PLG** checked | the same dumps for that one voice number of the Internal or Custom bank |
| Native tab | `F0 43 1n 57 00 00 xx vv F7` (system, 0B–17), `09 0p 17–1A` (part p) |
| Keyboard / wheels | Note on/off, pitch bend, CC 1, CC 2, channel aftertouch, CC 64 on the keyboard channel |
| Panic | CC 120 (All Sound Off), CC 123 (All Notes Off), CC 121 (Reset Controllers) |

## On the host synth

- An internal voice has no model of its own, so **Send Voice** for an internal voice changes
  the controls of the voice the board is playing now. To hear it as intended, select the
  internal voice, or its board voice (shown on the LCD, e.g. `Pr2 010 Air Sax`), on the host.
- A custom voice is sent whole to the board's current voice. Its custom common settings
  (controller routings, scale tuning, sends, mono/poly…) have no current voice message: they
  go to the board with **Send Bank** or **Store → PLG**.
- **Send Bank** writes into the board's own RAM banks: an Internal bank goes to the **Internal
  bank (Bank MSB 33, LSB 3)**, voices 1–64, and a Custom bank to the **Custom bank (Bank MSB 33,
  LSB 2)**, voices 1–6. To hear them, select that bank and program on the PLG150-VL part of the
  host synth. The Preset banks (33/0 and 33/1) are in ROM and can't be written.
- Custom and internal voices on the board are lost when the host synth is switched off (Owner's
  Manual). Keep them as `.syx` files, or with the host's own storage.
- The board can't send its data back, so the editor works from its own copy: the built-in
  banks and the files you open. No MIDI input is used.

## Banks

- **Internal**: the 64 internal voices stored in the same file.
- **VL1 Power User**: the six custom voices of the Yamaha *Power User Plus Pack 1: VL User Voices*
  (SuprJazz, Jazz Sax, Viol Out, Moby, Haze, Solitude), with their models.
- **VLEditor 1-6 … VLEditor 85-89**: the library distributed with the VL70m Expert Editor by David Rice and
  Aaron Michael (`VLED/zip/VLEDITOR.LIB`): 89 custom voices (saxes, clarinets, oboes, brass,
  flutes, bowed and plucked strings, and many morphs such as `Sax>Oboe`), in banks of 6 so each
  can be sent to the board's 6 custom voice slots. The library's empty slots 90–128 are left out.

Internal and VL1 Power User come from `PowerUserVL1/VLTUTOR.W2B`, a Motif ES "Plugin All Bulk" file. Its format is
not documented; this is what it holds:

- A **YSFC** container (as all Motif ES files): a 64-byte header (`A0636 PLUGIN`, `YSFC`), a
  catalog at 0x80 of 8-byte entries (4-character chunk tag, 32-bit big-endian offset), then
  the chunks, each with its tag and a 32-bit length. `E…` chunks list the entries (name,
  size), `D…` chunks hold the data.
- The `DPBK` (plug-in bulk) data is a plain stream of SysEx messages, the same ones the
  Motif sends to the board: part parameters, then the PLG150-VL native dumps
  (system, part scaling, current voice, the 6 custom voices and the 64 internal voices).

**Open file…** reads `.syx` files and these Plugin All Bulk files (`.w2b`/`.w3b`), taking
every PLG150-VL native voice dump it finds. A file with one voice loads into the edit buffer.
It also reads VL70m Expert Editor libraries (`.lib`): a 0xC00-byte header (`LM  0268`,
`VED1.0 Beta`, `P_VER_3.30R`, the 128 voice names at 0x400), then 128 custom voices of
1550 bytes (common 163 + element 1387, the same layout as the Custom Voice dumps).

A custom bank with more than 6 voices (a library) can't be sent as a bank, as the board has 6
custom voice slots: click a voice to play it (it goes to the current voice), or store it in a
6-voice Custom bank and send that one. **Save .lib** saves a library bank as a `.lib` file.

The `.w7e` "Voice Editor" files of the pack hold the 64 Motif ES **plug-in voices**
(`EPVC`/`DPVC` chunks, 349 bytes per voice). Those are host voices: Motif effects,
arpeggio and part settings wrapped around a board voice (its bank and number are at
offset 0xF7–0xF8, e.g. SuperJazz = Custom 1, LyricOff = Preset 1 #106). The board never sees
that data, so they are not banks of this editor.

Banks you change, open or create are kept in the browser's localStorage. Use **Save .syx** to
keep them as files (Internal or Custom Voice bulk dumps). **Export** saves the current voice
as a single-voice file.

## Model data

Yamaha's manual lists the model part of the element (bytes 3D–56A) as "not used". The map in
`js/model.js` was reverse engineered from the VL70m Expert Editor (`VLED/zip/VLEDITOR.EXE`):

- Its data segment has a table of 208 parameters (18 bytes each: id, format, min, max, option
  list, address). The id is block × 1000 + byte offset (e.g. 20290 = element byte 290, SysEx
  address `20 02 22`).
- Another table links each parameter to a control of its dialogs, whose labels give the names.
  Breakpoint counts come from Manny Fernandez's VL Programming Guide (`VLGUIDE.TXT`), and the
  breakpoint editor dialogs show that a breakpoint is a note and an offset.
- The map was checked against the 89 library voices and the 6 Power User voices: every value
  is in range, every breakpoint list is in note order, and reading and writing every parameter
  leaves the voices unchanged.

Not mapped (kept as is): element bytes 3D–45 (nearly constant), the second byte of the
resonator delays, and 3EB–56A, two per-note tables (most likely the tube length per note that
the Expert Editor's tuning function writes, and a second byte per note). Some names and value
meanings are approximate, as the Expert Editor's own labels are short and Yamaha never
documented the model. Child Reed Res. Freq. is read as −128..127, or −512..511 when Extended
Res. Freq. is on (as in SuprJazz).

## Files

- `index.html`, `css/style.css`: the UI
- `favicon.ico`, `icons/`: the page icons (16–512 px PNG renders)
- `js/vl.js`: voice model, parameter map, formatting and file parsing (`.syx`, `.w2b`, `.lib`)
- `js/model.js`: the model parameter map and breakpoint helpers (Model tab)
- `js/midi.js`: Web MIDI and SysEx builders
- `js/graphics.js`: knobs, control response graphs and the 7-segment LED
- `js/app.js`: the app
- `js/presets.js`: the embedded banks (generated from `VLTUTOR.W2B` and `VLEDITOR.LIB`)

## Changelog

- 2/Nov/2026: First version of the editor.
