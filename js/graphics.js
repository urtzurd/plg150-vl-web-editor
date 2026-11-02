// SVG rendering: rotary knobs, controller response graphs and the seven-segment LED.
(function () {
  'use strict';

  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(svgNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  };

  // ---------------------------------------------------------------- knob
  // A knob turns through 270 degrees, from -135 (min) to +135 (max).
  const A0 = -135, A1 = 135, R = 15, C = 20;
  const polar = (deg, r = R) => {
    const a = (deg - 90) * Math.PI / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };
  function arc(d0, d1, r = R) {
    if (Math.abs(d1 - d0) < 0.01) return '';
    const [x0, y0] = polar(Math.min(d0, d1), r), [x1, y1] = polar(Math.max(d0, d1), r);
    const large = Math.abs(d1 - d0) > 180 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  function createKnob(svg) {
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.appendChild(el('path', { class: 'k-track', d: arc(A0, A1) }));
    const value = el('path', { class: 'k-value' });
    svg.appendChild(value);
    svg.appendChild(el('circle', { class: 'k-cap', cx: C, cy: C, r: 11 }));
    const ptr = el('line', { class: 'k-ptr', x1: C, y1: C - 4, x2: C, y2: C - 10.5 });
    svg.appendChild(ptr);
    return { value, ptr };
  }
  // frac: 0..1 position; from: 0..1 origin of the value arc (0.5-ish for bipolar)
  function updateKnob(k, frac, from = 0) {
    const deg = A0 + (A1 - A0) * frac;
    const deg0 = A0 + (A1 - A0) * from;
    k.value.setAttribute('d', arc(deg0, deg));
    k.ptr.setAttribute('transform', `rotate(${deg.toFixed(1)} ${C} ${C})`);
  }

  // ---------------------------------------------------------------- controller response
  // A sketch of what a control does: x = controller position, y = change of the
  // VL parameter (-127..+127 of the depth range). Yamaha documents the ranges
  // but not the curve shapes; here a curve value c bends the line into x^(2^(c/8)),
  // so -16 rises early (a small controller movement does a lot) and +16 late.
  // Pitch bend and the embouchure's Center Base work around the controller centre.
  const RESPONSE_NOTE = 'Sketch of the control response: x = controller, y = change of the parameter. Yamaha does not document the exact curve shapes.';
  function createResponse(parent) {
    const box = document.createElement('div');
    box.className = 'eg-box resp-box';
    const svg = el('svg', { class: 'resp' });
    const info = document.createElement('div');
    info.className = 'eg-times';
    box.append(svg, info);
    box.title = RESPONSE_NOTE;
    parent.appendChild(box);
    return { box, svg, info };
  }
  const shape = (x, curve) => Math.pow(Math.max(0, Math.min(1, x)), Math.pow(2, curve / 8));
  // o: { off, srcLabel, bipolar, depth, curve } or { off, srcLabel, emb: true, upper, lower, minBase }
  function drawResponse(g, o) {
    const W = 200, H = 60, pad = 4;
    const svg = g.svg;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML = '';
    const X = x => x * W;
    const Y = y => H / 2 - (y / 127) * (H / 2 - pad);
    svg.appendChild(el('line', { class: 'eg-axis', x1: 0, y1: Y(0), x2: W, y2: Y(0) }));
    const centred = o.bipolar || (o.emb && !o.minBase);
    if (centred) svg.appendChild(el('line', { class: 'eg-div', x1: W / 2, y1: 0, x2: W / 2, y2: H }));
    let f;
    if (o.off) f = () => 0;
    else if (o.emb) {
      f = o.minBase ? x => o.upper * x
        : x => (x >= 0.5 ? o.upper * (x - 0.5) * 2 : o.lower * (0.5 - x) * 2);
    } else if (o.bipolar) {
      f = x => { const t = x * 2 - 1; return o.depth * Math.sign(t) * shape(Math.abs(t), o.curve); };
    } else {
      f = x => o.depth * shape(x, o.curve);
    }
    const pts = [];
    for (let i = 0; i <= 100; i++) pts.push([X(i / 100), Y(f(i / 100))]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
    svg.appendChild(el('path', { class: 'eg-fill', d: `${line} L${W} ${Y(0)} L0 ${Y(0)} Z` }));
    svg.appendChild(el('path', { class: 'eg-line' + (o.off ? ' off' : ''), d: line }));
    g.box.classList.toggle('off', !!o.off);
    g.info.innerHTML = '';
    const sp = t => { const s = document.createElement('span'); s.textContent = t; g.info.appendChild(s); };
    sp(o.srcLabel);
    if (o.off) sp('—');
    else if (o.emb) sp(o.minBase ? `MIN ${o.upper > 0 ? '+' : ''}${o.upper}` : `▲${o.upper > 0 ? '+' : ''}${o.upper} ▼${o.lower > 0 ? '+' : ''}${o.lower}`);
    else sp(`${o.depth > 0 ? '+' : ''}${o.depth}${o.curve ? ` c${o.curve > 0 ? '+' : ''}${o.curve}` : ''}`);
  }

  // ---------------------------------------------------------------- seven-segment LED
  const SEGMENTS = {
    0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
    5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '',
  };
  const DW = 20, DH = 36, T = 3.6, PITCH = 27;

  function segmentPoints(seg) {
    const hx = (y, x1 = 2, x2 = DW - 2) =>
      [[x1 + T / 2 + 0.6, y], [x1 + T + 0.6, y - T / 2], [x2 - T - 0.6, y - T / 2],
        [x2 - T / 2 - 0.6, y], [x2 - T - 0.6, y + T / 2], [x1 + T + 0.6, y + T / 2]];
    const vx = (x, y1, y2) =>
      [[x, y1 + T / 2 + 0.6], [x + T / 2, y1 + T + 0.6], [x + T / 2, y2 - T - 0.6],
        [x, y2 - T / 2 - 0.6], [x - T / 2, y2 - T - 0.6], [x - T / 2, y1 + T + 0.6]];
    const mid = DH / 2;
    const pts = {
      a: hx(2), g: hx(mid), d: hx(DH - 2),
      f: vx(2, 2, mid), b: vx(DW - 2, 2, mid),
      e: vx(2, mid, DH - 2), c: vx(DW - 2, mid, DH - 2),
    }[seg];
    return pts.map(p => p.map(n => n.toFixed(2)).join(',')).join(' ');
  }

  // dot lights the decimal point after the last digit ("edited").
  function drawSevenSegment(svg, text, dot) {
    const n = text.length;
    svg.innerHTML = '';
    const vbW = (n - 1) * PITCH + DW + 10;
    svg.setAttribute('viewBox', `-3 -1 ${vbW} ${DH + 2}`);
    svg.style.aspectRatio = `${vbW} / ${DH + 2}`;
    const g = el('g', { transform: 'skewX(-6)', 'transform-origin': `0 ${DH}` });
    [...text].forEach((ch, i) => {
      const lit = SEGMENTS[ch] ?? '';
      const digit = el('g', { transform: `translate(${i * PITCH} 0)` });
      for (const seg of 'abcdefg') {
        digit.appendChild(el('polygon', { points: segmentPoints(seg), class: lit.includes(seg) ? 'seg on' : 'seg' }));
      }
      g.appendChild(digit);
    });
    g.appendChild(el('circle', { cx: (n - 1) * PITCH + DW + 3, cy: DH - 2, r: 2.2, class: dot ? 'seg on' : 'seg' }));
    svg.appendChild(g);
  }

  window.Graphics = { el, createKnob, updateKnob, createResponse, drawResponse, drawSevenSegment };
})();
