// Web MIDI access and PLG150-VL native system exclusive message builders.
//
// Message formats (PLG150-VL Owner's Manual, "MIDI Data Format", VL70-m native format):
//   Parameter change  F0 43 1n 57 ah am al dd.. F7
//   Bulk dump         F0 43 0n 57 bh bl ah am al data.. cs F7
//     bh bl: byte count; cs: count + address + data + cs == 0 (mod 128)
//   Addresses:
//     00 00 0B-17  VL System (parameter change)       09 0p 17-1A  VL Part scaling (part p)
//     10 00 00     Current Voice Common Misc          20 00 00     Current Voice Element
//     30 00 0n     Custom Voice n common (bulk)       31 00 0n     Custom Voice n element (bulk)
//     40 00 nn     Internal Voice nn (bulk)
(function () {
  'use strict';

  const MODEL = 0x57;

  const Sysex = {
    param(dev, ah, am, al, data) {
      return [0xF0, 0x43, 0x10 | (dev & 0x0F), MODEL, ah, am, al, ...data.map(b => b & 0x7F), 0xF7];
    },
    system(dev, addr, data) { return this.param(dev, 0x00, 0x00, addr, data); },
    part(dev, part, addr, data) { return this.param(dev, 0x09, part & 0x0F, addr, data); },

    bulk(dev, ah, am, al, data) {
      const n = data.length;
      const head = [(n >> 7) & 0x7F, n & 0x7F, ah, am, al];
      let sum = 0;
      for (const b of head) sum += b;
      for (const b of data) sum += b;
      const cs = (128 - (sum & 0x7F)) & 0x7F;
      return [0xF0, 0x43, dev & 0x0F, MODEL, ...head, ...Array.from(data, b => b & 0x7F), cs, 0xF7];
    },
    // Current voice (what the board plays now): a custom voice only
    currentMisc(dev, v) { return this.bulk(dev, 0x10, 0x00, 0x00, VL.commonMisc(v)); },
    currentElement(dev, v) { return this.bulk(dev, 0x20, 0x00, 0x00, VL.elementData(v)); },
    customCommon(dev, slot, v) { return this.bulk(dev, 0x30, 0x00, slot, VL.commonData(v)); },
    customElement(dev, slot, v) { return this.bulk(dev, 0x31, 0x00, slot, VL.elementData(v)); },
    internal(dev, slot, v) { return this.bulk(dev, 0x40, 0x00, slot & 0x3F, v); },
  };

  class Midi {
    constructor() {
      this.access = null;
      this.output = null;
      this.onStateChange = () => {};
      this.onSend = () => {};
    }

    get supported() { return typeof navigator.requestMIDIAccess === 'function'; }

    async init() {
      this.access = await navigator.requestMIDIAccess({ sysex: true });
      this.access.onstatechange = () => this.onStateChange();
    }

    outputs() { return this.access ? [...this.access.outputs.values()] : []; }

    selectOutput(id) {
      this.output = this.outputs().find(p => p.id === id) || null;
    }

    send(bytes, label) {
      if (!this.output) return false;
      this.output.send(bytes);
      this.onSend(bytes, label);
      return true;
    }

    // Sends messages in sequence with a gap between them, so the host and the
    // board have time to digest each bulk before the next one arrives. The gap
    // also covers the wire time of a 5-pin DIN link (~0.32 ms per byte).
    // shouldStop() is checked before each message; onProgress(i, n) after it.
    async sendSequence(list, gapMs = 120, { shouldStop, onProgress } = {}) {
      for (let i = 0; i < list.length; i++) {
        if (shouldStop && shouldStop()) return false;
        const [bytes, label] = list[i];
        if (!this.send(bytes, label)) return false;
        if (onProgress) onProgress(i + 1, list.length);
        await new Promise(r => setTimeout(r, gapMs + bytes.length * 0.35));
      }
      return true;
    }
  }

  window.Sysex = Sysex;
  window.Midi = Midi;
})();
