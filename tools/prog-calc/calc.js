'use strict';

// ---- state ----
let mode       = 'dec';   // 'dec' | 'hex' | 'oct' | 'bin'
let bits       = 32;
let accumulator = 0n;
let pendingOp  = null;    // '+' | '−' | '×' | '÷' | 'AND' | 'OR' | 'XOR' | 'LSH' | 'RSH'
let entry      = '0';
let justEvaled = false;
let parenDepth = 0;       // simple paren tracking (display only for now)

// ---- DOM refs ----
const displayMain = document.getElementById('display-main');
const displayExpr = document.getElementById('display-expr');
const displaySec  = document.getElementById('display-secondary');
const bitGrid     = document.getElementById('bit-grid');
const bitLabels   = document.getElementById('bit-labels');
const modeGroup   = document.getElementById('mode-group');
const widthGroup  = document.getElementById('width-group');

// ---- masks & helpers ----
function mask()     { return (1n << BigInt(bits)) - 1n; }
function signedVal(v) {
  const msb = 1n << BigInt(bits - 1);
  return (v & msb) ? v - (1n << BigInt(bits)) : v;
}

function clampToWidth(v) {
  // keep unsigned representation within width
  const m = mask();
  return ((v % (m + 1n)) + m + 1n) % (m + 1n);
}

function parseEntry() {
  const s = entry.trim();
  if (!s || s === '-') return 0n;
  try {
    switch (mode) {
      case 'hex': {
        const neg = s.startsWith('-');
        const hex = neg ? s.slice(1) : s;
        const v = BigInt('0x' + hex);
        return clampToWidth(neg ? -v : v);
      }
      case 'oct': return clampToWidth(BigInt('0o' + s));
      case 'bin': return clampToWidth(BigInt('0b' + s));
      default: { // dec
        const v = BigInt(s);
        return clampToWidth(v);
      }
    }
  } catch { return 0n; }
}

function formatValue(v, m) {
  switch (m) {
    case 'hex': return v.toString(16).toUpperCase();
    case 'oct': return v.toString(8);
    case 'bin': {
      const raw = v.toString(2).padStart(bits, '0');
      // group into nibbles
      const groups = [];
      for (let i = 0; i < raw.length; i += 4) groups.push(raw.slice(i, i + 4));
      return groups.join(' ');
    }
    default: return signedVal(v).toString(10);
  }
}

function currentValue() {
  return parseEntry();
}

// ---- rendering ----
function render() {
  const v = currentValue();

  // main display: show entry as-is while typing, formatted on eval
  displayMain.textContent = entry === '0' ? '0' : entry;

  // secondary: hex when not in hex mode; dec otherwise
  if (mode !== 'hex') {
    displaySec.textContent = '0x' + v.toString(16).toUpperCase().padStart(bits / 4, '0');
  } else {
    displaySec.textContent = signedVal(v).toString(10);
  }

  // expr line
  if (pendingOp) {
    displayExpr.textContent = formatValue(accumulator, mode) + ' ' + pendingOp;
  } else {
    displayExpr.textContent = '';
  }

  renderBitGrid(v);
  updateKeypadState();
  updateOpHighlight();
}

function renderBitGrid(v) {
  bitGrid.innerHTML = '';
  bitLabels.innerHTML = '';

  for (let i = bits - 1; i >= 0; i--) {
    const cell = document.createElement('div');
    cell.className = 'bit-cell';
    const on = (v >> BigInt(i)) & 1n;
    if (on) cell.classList.add('on');
    cell.textContent = on ? '1' : '0';
    cell.title = `bit ${i}`;

    const posFromLeft = bits - 1 - i;
    if (posFromLeft > 0 && posFromLeft % 8 === 0) cell.classList.add('byte-start');
    else if (posFromLeft > 0 && posFromLeft % 4 === 0) cell.classList.add('nibble-start');

    cell.addEventListener('click', () => {
      const cur = currentValue();
      const toggled = cur ^ (1n << BigInt(i));
      setEntryFromValue(toggled);
      render();
    });

    bitGrid.appendChild(cell);
  }

  // labels: one per nibble group showing the high bit index of that nibble
  const labelWrap = document.createElement('div');
  labelWrap.style.cssText = 'display:flex;justify-content:flex-end;gap:2px;width:100%;';
  for (let i = bits - 1; i >= 0; i -= 4) {
    const span = document.createElement('span');
    span.style.cssText = `width:${i === bits-1 ? 20 : 20}px;text-align:center;font-size:10px;color:var(--muted);`;
    if (i === bits - 1) span.style.marginLeft = '0';
    // add byte-gap margin mirrors
    const posFromLeft = bits - 1 - i;
    if (posFromLeft > 0 && posFromLeft % 8 === 0) span.style.marginLeft = '10px';
    else if (posFromLeft > 0) span.style.marginLeft = '5px';
    span.textContent = i;
    labelWrap.appendChild(span);
  }
  bitLabels.appendChild(labelWrap);
}

function setEntryFromValue(v) {
  const clamped = clampToWidth(v);
  switch (mode) {
    case 'hex': entry = clamped.toString(16).toUpperCase() || '0'; break;
    case 'oct': entry = clamped.toString(8) || '0'; break;
    case 'bin': entry = clamped.toString(2) || '0'; break;
    default:    entry = signedVal(clamped).toString(10) || '0'; break;
  }
}

// ---- digit enable/disable ----
const digitMap = {
  dec: new Set(['0','1','2','3','4','5','6','7','8','9']),
  hex: new Set(['0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F']),
  oct: new Set(['0','1','2','3','4','5','6','7']),
  bin: new Set(['0','1']),
};

function updateKeypadState() {
  const allowed = digitMap[mode];
  document.querySelectorAll('.key.digit, .key.hex-only').forEach(btn => {
    const k = btn.dataset.key;
    btn.disabled = !allowed.has(k);
  });
}

function updateOpHighlight() {
  document.querySelectorAll('.key.op, .op-btn').forEach(btn => {
    const op = btn.dataset.key || btn.dataset.op;
    btn.classList.toggle('active-op', op === pendingOp);
    btn.classList.toggle('pending',   op === pendingOp);
  });
}

// ---- operations ----
function applyBinary(op, a, b) {
  const m = mask();
  switch (op) {
    case '+':   return clampToWidth(a + b);
    case '−':   return clampToWidth(a - b);
    case '×':   return clampToWidth(a * b);
    case '÷':   return b === 0n ? a : clampToWidth(a / b);
    case 'AND': return (a & b) & m;
    case 'OR':  return (a | b) & m;
    case 'XOR': return (a ^ b) & m;
    case 'LSH': return (a << (b & BigInt(bits - 1))) & m;
    case 'RSH': return (a >> (b & BigInt(bits - 1))) & m;
    default: return b;
  }
}

function applyUnary(op) {
  const v = currentValue();
  const m = mask();
  const b = BigInt(bits);
  let result;
  switch (op) {
    case 'NOT': result = (~v) & m; break;
    case 'NEG': result = clampToWidth(-signedVal(v)); break;
    default: return;
  }
  setEntryFromValue(result);
  justEvaled = true;
  render();
}

function pressOp(op) {
  const v = currentValue();
  if (pendingOp && !justEvaled) {
    const result = applyBinary(pendingOp, accumulator, v);
    accumulator = result;
  } else {
    accumulator = v;
  }
  pendingOp  = op;
  justEvaled = true;
  render();
}

function pressEquals() {
  if (!pendingOp) return;
  const v = currentValue();
  const result = applyBinary(pendingOp, accumulator, v);
  accumulator = result;
  pendingOp   = null;
  justEvaled  = true;
  setEntryFromValue(result);
  render();
}

function pressDigit(d) {
  if (!digitMap[mode].has(d)) return;
  if (justEvaled) { entry = d; justEvaled = false; }
  else if (entry === '0') { entry = d; }
  else { entry += d; }
  render();
}

function pressBack() {
  if (entry.length <= 1) { entry = '0'; }
  else { entry = entry.slice(0, -1); }
  render();
}

function pressCE() {
  if (entry !== '0') { entry = '0'; }
  else { accumulator = 0n; pendingOp = null; justEvaled = false; }
  render();
}

function pressNeg() {
  if (mode === 'dec') {
    if (entry.startsWith('-')) entry = entry.slice(1);
    else if (entry !== '0')    entry = '-' + entry;
  } else {
    const v = currentValue();
    setEntryFromValue(clampToWidth(-signedVal(v)));
    justEvaled = true;
  }
  render();
}

// ---- mode & width ----
function setMode(m) {
  const v = currentValue();
  mode = m;
  setEntryFromValue(v);
  modeGroup.querySelectorAll('button').forEach(b => b.classList.toggle('selected', b.dataset.mode === m));
  render();
}

function setWidth(w) {
  bits = w;
  const v = clampToWidth(currentValue());
  setEntryFromValue(v);
  accumulator = clampToWidth(accumulator);
  widthGroup.querySelectorAll('button').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.bits) === w));
  render();
}

// ---- event wiring ----
modeGroup.querySelectorAll('button').forEach(btn =>
  btn.addEventListener('click', () => setMode(btn.dataset.mode))
);

widthGroup.querySelectorAll('button').forEach(btn =>
  btn.addEventListener('click', () => setWidth(parseInt(btn.dataset.bits)))
);

document.querySelectorAll('.op-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    const op = btn.dataset.op;
    if (op === 'NOT') applyUnary('NOT');
    else pressOp(op);
  })
);

document.querySelectorAll('.key').forEach(btn => {
  btn.addEventListener('click', () => {
    const k = btn.dataset.key;
    if (!k) return;
    if ('0123456789ABCDEF'.includes(k)) { pressDigit(k); return; }
    switch (k) {
      case '+': case '−': case '×': case '÷':
      case 'AND': case 'OR': case 'XOR': case 'LSH': case 'RSH':
        pressOp(k); break;
      case '=':    pressEquals(); break;
      case 'CE':   pressCE(); break;
      case 'BACK': pressBack(); break;
      case 'NEG':  pressNeg(); break;
    }
  });
});

// ---- keyboard ----
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key;

  if (key === 'Enter' || key === '=') { e.preventDefault(); pressEquals(); return; }
  if (key === 'Backspace') { e.preventDefault(); pressBack(); return; }
  if (key === 'Escape' || key === 'Delete') { e.preventDefault(); pressCE(); return; }

  const upper = key.toUpperCase();
  if (digitMap[mode].has(upper)) { pressDigit(upper); return; }

  if (key === '+') { pressOp('+'); return; }
  if (key === '-') { pressOp('−'); return; }
  if (key === '*') { pressOp('×'); return; }
  if (key === '/') { e.preventDefault(); pressOp('÷'); return; }
});

// ---- init ----
render();
