'use strict';

// ---- state ----
let mode          = 'dec';   // 'dec' | 'hex' | 'oct' | 'bin' | 'sci'
let bits          = 32;
let signed        = true;
let history       = []; // [{exprStr, value: BigInt|number}], newest first
let accumulator   = 0n;
let sciAccumulator = 0;  // float accumulator for SCI mode
let pendingOp     = null;
let entry         = '0';
let justEvaled    = false;

// ---- DOM refs ----
const displayMain = document.getElementById('display-main');
const displayExpr = document.getElementById('display-expr');
const displaySec  = document.getElementById('display-secondary');
const bitGrid     = document.getElementById('bit-grid');
const modeGroup   = document.getElementById('mode-group');
const widthGroup  = document.getElementById('width-group');
const signGroup    = document.getElementById('sign-group');
const historyList  = document.getElementById('history-list');
const historyClear = document.getElementById('history-clear');
const historyCount = document.getElementById('history-count');
const calcWrap     = document.querySelector('.calc-wrap');

// ---- masks & helpers ----
function mask()     { return (1n << BigInt(bits)) - 1n; }
function signedVal(v) {
  const msb = 1n << BigInt(bits - 1);
  return (v & msb) ? v - (1n << BigInt(bits)) : v;
}

function clampToWidth(v) {
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
      const groups = [];
      for (let i = 0; i < raw.length; i += 4) groups.push(raw.slice(i, i + 4));
      return groups.join(' ');
    }
    default: return (signed ? signedVal(v) : v).toString(10);
  }
}

function currentValue() {
  return parseEntry();
}

// ---- SI / engineering notation ----
const SI_BTN_MAP = {
  'AND': { label: 'G', factor: 1e9  },
  'OR':  { label: 'M', factor: 1e6  },
  'XOR': { label: 'k', factor: 1e3  },
  'NOT': { label: 'm', factor: 1e-3 },
  'LSH': { label: 'μ', factor: 1e-6 },
  'RSH': { label: 'n', factor: 1e-9 },
};

const SI_PREFIXES = [
  [1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'],
  [1, ''], [1e-3, 'm'], [1e-6, 'μ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']
];

function formatSci(v) {
  if (!isFinite(v)) return isNaN(v) ? 'Error' : (v > 0 ? '∞' : '-∞');
  if (v === 0) return '0';
  const abs = Math.abs(v);
  for (const [scale, sym] of SI_PREFIXES) {
    if (abs >= scale * 0.9999999) {
      const mantissa = v / scale;
      const s = parseFloat(mantissa.toFixed(3)).toString();
      return sym ? s + ' ' + sym : s;
    }
  }
  // below femto range
  const mantissa = v / 1e-15;
  return parseFloat(mantissa.toFixed(3)).toString() + ' f';
}

function parseSciEntry() {
  const s = entry.trim();
  if (!s || s === '-' || s === '.' || s === '-.') return 0;
  return parseFloat(s) || 0;
}

function applySciOp(op, a, b) {
  switch (op) {
    case '+': return a + b;
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? Infinity : a / b;
    default: return b;
  }
}

function pressDot() {
  if (mode !== 'sci') return;
  if (justEvaled) { entry = '0.'; justEvaled = false; }
  else if (!entry.includes('.')) entry += '.';
  render();
}

// ---- history ----
function addToHistory(exprStr, value) {
  history.unshift({ exprStr, value });
  if (history.length > 12) history.pop();
}

function renderHistory() {
  historyCount.textContent = history.length > 0 ? `(${history.length})` : '';

  const scrollTop = historyList.scrollTop;
  historyList.innerHTML = '';

  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'No history yet';
    historyList.appendChild(empty);
  } else {
    history.forEach(item => {
      const row = document.createElement('div');
      row.className = 'history-entry';
      row.title = 'Tap to recall';

      const expr = document.createElement('div');
      expr.className = 'history-expr';
      expr.textContent = item.exprStr;

      const res = document.createElement('div');
      res.className = 'history-result';
      if (typeof item.value === 'bigint') {
        const displayMode = mode === 'sci' ? 'dec' : mode;
        res.textContent = formatValue(item.value & mask(), displayMode);
      } else {
        res.textContent = formatSci(item.value);
      }

      row.appendChild(expr);
      row.appendChild(res);
      row.addEventListener('click', () => {
        setEntryFromValue(item.value);
        justEvaled = true;
        render();
      });
      historyList.appendChild(row);
    });
  }

  historyList.scrollTop = scrollTop;
}

// ---- rendering ----
function render() {
  if (mode === 'sci') {
    const v = parseSciEntry();
    displayMain.textContent = formatSci(v);
    displaySec.textContent  = entry === '0' ? '' : entry;
    displayExpr.textContent = pendingOp ? formatSci(sciAccumulator) + ' ' + pendingOp : '';
  } else {
    const v = currentValue();
    displayMain.textContent = entry === '0' ? '0' : entry;
    if (mode !== 'hex') {
      displaySec.textContent = '0x' + v.toString(16).toUpperCase().padStart(bits / 4, '0');
    } else {
      displaySec.textContent = (signed ? signedVal(v) : v).toString(10);
    }
    displayExpr.textContent = pendingOp ? formatValue(accumulator, mode) + ' ' + pendingOp : '';
    renderBitGrid(v);
  }

  renderHistory();
  updateKeypadState();
  updateOpHighlight();
}

function createNibbleGroup(nibbleIndex, v, active) {
  const high = nibbleIndex * 4 + 3;
  const low  = nibbleIndex * 4;

  const group = document.createElement('div');
  group.className = 'nibble-group';
  if (!active) group.classList.add('inactive');

  const bitsDiv   = document.createElement('div');
  bitsDiv.className = 'nibble-bits';
  const labelsDiv = document.createElement('div');
  labelsDiv.className = 'nibble-labels';

  for (let i = high; i >= low; i--) {
    const on   = active && ((v >> BigInt(i)) & 1n);
    const cell = document.createElement('div');
    cell.className = 'bit-cell';
    if (on) cell.classList.add('on');
    cell.textContent = on ? '1' : '0';
    cell.title = `bit ${i}`;
    if (active) {
      cell.addEventListener('click', () => {
        setEntryFromValue(currentValue() ^ (1n << BigInt(i)));
        render();
      });
    }
    bitsDiv.appendChild(cell);

    const lbl = document.createElement('div');
    lbl.className = 'bit-label';
    if (i === high || i === low) lbl.textContent = i;
    labelsDiv.appendChild(lbl);
  }

  group.appendChild(bitsDiv);
  group.appendChild(labelsDiv);
  return group;
}

function renderBitGrid(v) {
  bitGrid.innerHTML = '';

  // Always render 2 rows × 4 nibbles = 32 bits; inactive nibbles are grayed
  for (let rowHigh = 7; rowHigh >= 0; rowHigh -= 4) {
    const row = document.createElement('div');
    row.className = 'nibble-row';
    for (let n = rowHigh; n >= rowHigh - 3; n--) {
      const active = (n + 1) * 4 <= bits;
      row.appendChild(createNibbleGroup(n, v, active));
    }
    bitGrid.appendChild(row);
  }
}

function setEntryFromValue(v) {
  if (mode === 'sci') {
    const n = typeof v === 'bigint' ? Number(v) : (isFinite(v) ? v : 0);
    entry = n.toString();
    return;
  }
  const clamped = typeof v === 'bigint'
    ? clampToWidth(v)
    : clampToWidth(BigInt(Math.trunc(isFinite(v) ? v : 0)));
  switch (mode) {
    case 'hex': entry = clamped.toString(16).toUpperCase() || '0'; break;
    case 'oct': entry = clamped.toString(8) || '0'; break;
    case 'bin': entry = clamped.toString(2) || '0'; break;
    default:    entry = (signed ? signedVal(clamped) : clamped).toString(10) || '0'; break;
  }
}

// ---- digit enable/disable ----
const digitMap = {
  dec: new Set(['0','1','2','3','4','5','6','7','8','9']),
  hex: new Set(['0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F']),
  oct: new Set(['0','1','2','3','4','5','6','7']),
  bin: new Set(['0','1']),
  sci: new Set(['0','1','2','3','4','5','6','7','8','9']),
};

function updateKeypadState() {
  const allowed = digitMap[mode] || digitMap.dec;
  document.querySelectorAll('.key.digit, .key.hex-only').forEach(btn => {
    btn.disabled = !allowed.has(btn.dataset.key);
  });

  // Repurpose ( as decimal point in SCI mode; disable ) in SCI mode
  const parenOpen  = document.querySelector('.key[data-key="("]');
  const parenClose = document.querySelector('.key[data-key=")"]');
  if (parenOpen)  parenOpen.textContent = mode === 'sci' ? '.' : '(';
  if (parenClose) parenClose.disabled   = mode === 'sci';

  // In SCI mode relabel bitwise buttons as SI prefix multipliers
  document.querySelectorAll('.op-btn').forEach(btn => {
    const si = SI_BTN_MAP[btn.dataset.op];
    if (mode === 'sci') {
      btn.textContent = si ? si.label : btn.dataset.op;
      btn.disabled = !si;
      btn.style.opacity = si ? '' : '0.25';
    } else {
      btn.textContent = btn.dataset.op;
      btn.disabled = false;
      btn.style.opacity = '';
    }
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
  if (mode === 'sci') {
    const v = parseSciEntry();
    sciAccumulator = (pendingOp && !justEvaled) ? applySciOp(pendingOp, sciAccumulator, v) : v;
    pendingOp  = op;
    justEvaled = true;
    render();
    return;
  }
  const v = currentValue();
  accumulator = (pendingOp && !justEvaled) ? applyBinary(pendingOp, accumulator, v) : v;
  pendingOp  = op;
  justEvaled = true;
  render();
}

function pressEquals() {
  if (!pendingOp) return;
  if (mode === 'sci') {
    const v = parseSciEntry();
    const result  = applySciOp(pendingOp, sciAccumulator, v);
    const exprStr = formatSci(sciAccumulator) + ' ' + pendingOp + ' ' + formatSci(v);
    sciAccumulator = result;
    pendingOp  = null;
    justEvaled = true;
    entry = result.toString();
    addToHistory(exprStr, result);
    render();
    return;
  }
  const v = currentValue();
  const result  = applyBinary(pendingOp, accumulator, v);
  const exprStr = formatValue(accumulator, mode) + ' ' + pendingOp + ' ' + formatValue(v, mode);
  accumulator = result;
  pendingOp   = null;
  justEvaled  = true;
  setEntryFromValue(result);
  addToHistory(exprStr, result);
  render();
}

function pressDigit(d) {
  if (!(digitMap[mode] || digitMap.dec).has(d)) return;
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
  if (mode === 'sci') {
    if (entry !== '0') { entry = '0'; }
    else { sciAccumulator = 0; pendingOp = null; justEvaled = false; }
    render();
    return;
  }
  if (entry !== '0') { entry = '0'; }
  else { accumulator = 0n; pendingOp = null; justEvaled = false; }
  render();
}

function pressNeg() {
  if (mode === 'sci') {
    if (entry.startsWith('-')) entry = entry.slice(1);
    else if (entry !== '0') entry = '-' + entry;
    render();
    return;
  }
  if (!signed) return;
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
  const prevMode = mode;
  if (m === 'sci' && prevMode !== 'sci') {
    const bigVal = currentValue();
    mode = 'sci';
    sciAccumulator = 0;
    pendingOp = null;
    justEvaled = false;
    entry = Number(bigVal).toString();
  } else if (prevMode === 'sci' && m !== 'sci') {
    const floatVal = parseSciEntry();
    mode = m;
    sciAccumulator = 0;
    pendingOp = null;
    const safe = isFinite(floatVal) ? floatVal : 0;
    setEntryFromValue(clampToWidth(BigInt(Math.trunc(safe))));
  } else if (m !== 'sci') {
    const v = currentValue();
    mode = m;
    setEntryFromValue(v);
  }
  calcWrap.classList.toggle('sci-mode', m === 'sci');
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

function setSign(s) {
  const v = currentValue();
  signed = s;
  if (mode === 'dec') setEntryFromValue(v);
  signGroup.querySelectorAll('button').forEach(b => b.classList.toggle('selected', b.dataset.sign === (s ? 'signed' : 'unsigned')));
  render();
}

// ---- event wiring ----
modeGroup.querySelectorAll('button').forEach(btn =>
  btn.addEventListener('click', () => setMode(btn.dataset.mode))
);

widthGroup.querySelectorAll('button').forEach(btn =>
  btn.addEventListener('click', () => setWidth(parseInt(btn.dataset.bits)))
);

signGroup.querySelectorAll('button').forEach(btn =>
  btn.addEventListener('click', () => setSign(btn.dataset.sign === 'signed'))
);

historyClear.addEventListener('click', () => {
  history = [];
  renderHistory();
});

document.querySelectorAll('.op-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    if (mode === 'sci') {
      const si = SI_BTN_MAP[btn.dataset.op];
      if (!si) return;
      const v = parseSciEntry();
      entry = (v * si.factor).toString();
      justEvaled = true;
      render();
      return;
    }
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
      case '(':    pressDot(); break; // becomes '.' in SCI mode
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
  if (key === '.') { e.preventDefault(); pressDot(); return; }

  const upper = key.toUpperCase();
  if ((digitMap[mode] || digitMap.dec).has(upper)) { pressDigit(upper); return; }

  if (key === '+') { pressOp('+'); return; }
  if (key === '-') { pressOp('−'); return; }
  if (key === '*') { pressOp('×'); return; }
  if (key === '/') { e.preventDefault(); pressOp('÷'); return; }
});

// ---- fullscreen ----
const fsBtn = document.getElementById('fs-btn');

function isFsActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement
            || document.body.classList.contains('calc-expanded'));
}

function updateFsBtn() {
  if (!fsBtn) return;
  const active = isFsActive();
  fsBtn.textContent = active ? '⊡' : '⛶';
  fsBtn.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
  fsBtn.classList.toggle('active', active);
}

async function toggleFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else if (document.body.classList.contains('calc-expanded')) {
    document.body.classList.remove('calc-expanded');
    updateFsBtn();
  } else {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    try {
      await req.call(el);
    } catch {
      document.body.classList.add('calc-expanded');
      updateFsBtn();
    }
  }
}

function onFsChange() {
  const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
  document.body.classList.toggle('calc-expanded', active);
  updateFsBtn();
}

if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

// ---- init ----
render();
