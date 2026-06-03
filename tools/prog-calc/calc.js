// Programmer calculator — uses BigInt throughout to handle 64-bit cleanly.

const inputs = {
  hex: document.getElementById('inp-hex'),
  dec: document.getElementById('inp-dec'),
  oct: document.getElementById('inp-oct'),
  bin: document.getElementById('inp-bin'),
};
const bitGrid   = document.getElementById('bit-grid');
const widthGroup = document.getElementById('width-group');
const signedChk  = document.getElementById('signed-chk');
const statusEl   = document.getElementById('status');

let bits   = 32;
let signed = true;
let value  = 0n; // always stored as unsigned BigInt within the current width

// ---- masks ----

function mask() {
  return (1n << BigInt(bits)) - 1n;
}

function signedValue(v) {
  const msb = 1n << BigInt(bits - 1);
  return (v & msb) ? v - (1n << BigInt(bits)) : v;
}

// ---- rendering ----

function updateDisplays(skip) {
  const v = value & mask();
  const sv = signedValue(v);
  const displayVal = signed ? sv : v;

  if (skip !== 'hex') inputs.hex.value = v.toString(16).toUpperCase();
  if (skip !== 'dec') inputs.dec.value = displayVal.toString(10);
  if (skip !== 'oct') inputs.oct.value = v.toString(8);
  if (skip !== 'bin') {
    const raw = v.toString(2);
    inputs.bin.value = raw.padStart(bits, '0');
  }

  renderBits(v);
  updateStatus(v, sv);
}

function renderBits(v) {
  bitGrid.innerHTML = '';
  for (let i = bits - 1; i >= 0; i--) {
    const cell = document.createElement('div');
    cell.className = 'bit-cell';
    if (i !== bits - 1 && (i + 1) % 8 === 0) cell.classList.add('byte-start');
    const on = (v >> BigInt(i)) & 1n;
    if (on) cell.classList.add('on');
    cell.textContent = on ? '1' : '0';
    cell.title = `bit ${i}`;
    cell.dataset.bit = i;
    cell.addEventListener('click', () => {
      value ^= (1n << BigInt(i));
      updateDisplays();
    });
    bitGrid.appendChild(cell);
  }
}

function updateStatus(v, sv) {
  const pop = popcount(v);
  statusEl.textContent = `popcount: ${pop}  |  0x${v.toString(16).toUpperCase().padStart(bits / 4, '0')}  |  ${signed ? sv : v}`;
}

// ---- input handlers ----

function parseInput(raw, base) {
  const s = raw.trim().replace(/[\s_]/g, '');
  if (s === '' || s === '-') return null;
  try {
    const sign = s.startsWith('-') ? -1n : 1n;
    const abs = s.startsWith('-') ? s.slice(1) : s;
    if (abs === '') return null;
    return sign * BigInt(base === 10 ? abs : `0x${base === 16 ? abs : base === 8 ? toHexFromBase(abs, 8) : toHexFromBase(abs, 2)}`);
  } catch {
    return null;
  }
}

function toHexFromBase(s, base) {
  return parseInt(s, base).toString(16);
}

function parseHex(s) {
  const clean = s.trim().replace(/[\s_]/g, '').replace(/^0x/i, '');
  if (!clean || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  return BigInt('0x' + clean);
}

function parseOct(s) {
  const clean = s.trim().replace(/[\s_]/g, '').replace(/^0o/i, '');
  if (!clean || !/^[0-7]+$/.test(clean)) return null;
  return BigInt('0o' + clean);
}

function parseBin(s) {
  const clean = s.trim().replace(/[\s_]/g, '').replace(/^0b/i, '');
  if (!clean || !/^[01]+$/.test(clean)) return null;
  return BigInt('0b' + clean);
}

function parseDec(s) {
  const clean = s.trim().replace(/[\s_]/g, '');
  if (!clean || !/^-?[0-9]+$/.test(clean)) return null;
  return BigInt(clean);
}

function applyUnsigned(v) {
  if (v === null) return;
  value = v & mask();
  updateDisplays();
}

function applySigned(v) {
  if (v === null) return;
  // re-interpret as unsigned within width
  const m = mask();
  value = ((v % (m + 1n)) + m + 1n) % (m + 1n);
  updateDisplays();
}

inputs.hex.addEventListener('input', () => applyUnsigned(parseHex(inputs.hex.value)));
inputs.oct.addEventListener('input', () => applyUnsigned(parseOct(inputs.oct.value)));
inputs.bin.addEventListener('input', () => applyUnsigned(parseBin(inputs.bin.value)));
inputs.dec.addEventListener('input', () => {
  const v = parseDec(inputs.dec.value);
  if (v === null) return;
  applySigned(v);
  updateDisplays('dec');
});

Object.values(inputs).forEach(inp => {
  const id = inp.id.replace('inp-', '');
  inp.addEventListener('focus', () => document.getElementById('row-' + id).classList.add('editing'));
  inp.addEventListener('blur',  () => document.getElementById('row-' + id).classList.remove('editing'));
});

// ---- width buttons ----

widthGroup.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    widthGroup.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    bits = parseInt(btn.dataset.bits);
    value = value & mask();
    updateDisplays();
  });
});

signedChk.addEventListener('change', () => {
  signed = signedChk.checked;
  updateDisplays();
});

// ---- operations ----

function popcount(v) {
  let n = 0n, x = v & mask();
  while (x) { n += x & 1n; x >>= 1n; }
  return Number(n);
}

document.querySelectorAll('.op-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const m = mask();
    const b = BigInt(bits);
    switch (btn.dataset.op) {
      case 'NOT':      value = (~value) & m; break;
      case 'NEG':      value = ((-value) & m + m + 1n) % (m + 1n); break;
      case 'SHL1':     value = (value << 1n) & m; break;
      case 'SHR1':     value = (value >> 1n) & m; break;
      case 'ROL1':     value = ((value << 1n) | (value >> (b - 1n))) & m; break;
      case 'ROR1':     value = ((value >> 1n) | ((value & 1n) << (b - 1n))) & m; break;
      case 'BYTESWAP': value = byteSwap(value); break;
      case 'CLZ':      value = BigInt(clz(value)); break;
      case 'POPCOUNT': value = BigInt(popcount(value)); break;
    }
    updateDisplays();
  });
});

function byteSwap(v) {
  const bytes = bits / 8;
  let result = 0n;
  for (let i = 0; i < bytes; i++) {
    result |= ((v >> BigInt(i * 8)) & 0xffn) << BigInt((bytes - 1 - i) * 8);
  }
  return result & mask();
}

function clz(v) {
  const m = mask();
  let x = v & m;
  if (x === 0n) return bits;
  let count = 0;
  const msb = 1n << BigInt(bits - 1);
  while (!(x & msb)) { x <<= 1n; count++; }
  return count;
}

// ---- init ----

updateDisplays();
