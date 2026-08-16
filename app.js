/* Paci Resizer — resize an image to a real-world size and lay it out on A4.
   Everything is client side: nothing is uploaded anywhere. */

const $ = id => document.getElementById(id);

const MM_PER_IN = 25.4;
const A4 = { w: 210, h: 297 };          // millimetres

const state = {
  bitmap: null,      // ImageBitmap of the source
  name: 'image',
  wMM: 100,          // target printed width  (mm)
  hMM: 100,          // target printed height (mm)
  unit: 'mm',
  dpi: 300,
  lock: true,
  fit: 'contain',
  bg: '#ffffff',
  bgNone: false,
  orient: 'portrait',
  margin: 10,
  gap: 4,
  copies: 1,
  marks: true,
};

const sheet = document.createElement('canvas');   // full-resolution A4, offscreen
let tile = null;                                  // cached resized image canvas
let tileKey = '';

/* ─────────────────────────── units ─────────────────────────── */

const mm2px = mm => Math.round(mm / MM_PER_IN * state.dpi);

function toUnit(mm) {
  switch (state.unit) {
    case 'cm': return mm / 10;
    case 'in': return mm / MM_PER_IN;
    case 'px': return Math.round(mm / MM_PER_IN * state.dpi);
    default:   return mm;
  }
}

function fromUnit(v) {
  switch (state.unit) {
    case 'cm': return v * 10;
    case 'in': return v * MM_PER_IN;
    case 'px': return v / state.dpi * MM_PER_IN;
    default:   return v;
  }
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const decimals = () => (state.unit === 'px' ? 0 : state.unit === 'mm' ? 1 : 2);

function syncDimInputs() {
  const d = decimals();
  $('w').value = round(toUnit(state.wMM), d);
  $('h').value = round(toUnit(state.hMM), d);
  const step = state.unit === 'px' ? 1 : state.unit === 'mm' ? 0.1 : 0.01;
  $('w').step = $('h').step = step;
}

/* ─────────────────────── loading an image ─────────────────────── */

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    // imageOrientation honours the EXIF rotation flag on phone photos
    state.bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    state.bitmap = await createImageBitmap(file);
  }
  state.name = file.name.replace(/\.[^.]+$/, '') || 'image';

  // first load: adopt the source aspect ratio at the current width
  state.hMM = state.wMM * state.bitmap.height / state.bitmap.width;
  syncDimInputs();

  $('srcInfo').textContent =
    `${file.name} — ${state.bitmap.width} × ${state.bitmap.height} px`;
  ['print', 'dlSheet', 'dlImg'].forEach(id => { $(id).disabled = false; });

  tileKey = '';
  render();
}

/* ───────────────────── resizing the image ───────────────────── */

// Downscaling in one drawImage step looks mushy; halving repeatedly keeps detail.
function stepDown(src, tw, th) {
  let c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);

  while (c.width / 2 > tw && c.height / 2 > th) {
    const n = document.createElement('canvas');
    n.width = Math.max(1, Math.floor(c.width / 2));
    n.height = Math.max(1, Math.floor(c.height / 2));
    const x = n.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, n.width, n.height);
    c = n;
  }
  return c;
}

/** Renders the source into a canvas of exactly the requested printed size. */
function buildTile() {
  const key = [state.wMM, state.hMM, state.dpi, state.fit, state.bg, state.bgNone].join('|');
  if (tile && key === tileKey) return tile;

  const tw = Math.max(1, mm2px(state.wMM));
  const th = Math.max(1, mm2px(state.hMM));
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  const ctx = c.getContext('2d');

  if (!state.bgNone) {
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, tw, th);
  }

  const src = state.bitmap;
  const sAsp = src.width / src.height;
  const tAsp = tw / th;
  let dw, dh;

  if (state.fit === 'stretch')            { dw = tw; dh = th; }
  else if (state.fit === 'cover')         { if (sAsp > tAsp) { dh = th; dw = th * sAsp; } else { dw = tw; dh = tw / sAsp; } }
  else /* contain */                      { if (sAsp > tAsp) { dw = tw; dh = tw / sAsp; } else { dh = th; dw = th * sAsp; } }

  const small = stepDown(src, dw, dh);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, (tw - dw) / 2, (th - dh) / 2, dw, dh);

  tile = c; tileKey = key;
  return c;
}

/* ───────────────────── laying out the sheet ───────────────────── */

function layout() {
  const portrait = state.orient === 'portrait';
  const sheetW = portrait ? A4.w : A4.h;
  const sheetH = portrait ? A4.h : A4.w;
  const availW = sheetW - state.margin * 2;
  const availH = sheetH - state.margin * 2;

  const cols = Math.max(0, Math.floor((availW + state.gap) / (state.wMM + state.gap)));
  const rows = Math.max(0, Math.floor((availH + state.gap) / (state.hMM + state.gap)));

  return { sheetW, sheetH, availW, availH, cols, rows, capacity: cols * rows };
}

function renderSheet() {
  const L = layout();
  sheet.width = mm2px(L.sheetW);
  sheet.height = mm2px(L.sheetH);
  const ctx = sheet.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  if (!state.bitmap || L.capacity === 0) return L;

  const img = buildTile();
  const n = Math.min(state.copies, L.capacity);
  const cols = Math.min(L.cols, n);
  const rows = Math.ceil(n / cols);

  // centre the whole block inside the printable area
  const blockW = cols * state.wMM + (cols - 1) * state.gap;
  const blockH = rows * state.hMM + (rows - 1) * state.gap;
  const x0 = state.margin + (L.availW - blockW) / 2;
  const y0 = state.margin + (L.availH - blockH) / 2;

  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const x = mm2px(x0 + c * (state.wMM + state.gap));
    const y = mm2px(y0 + r * (state.hMM + state.gap));
    ctx.drawImage(img, x, y, img.width, img.height);
    if (state.marks) cutMarks(ctx, x, y, img.width, img.height);
  }
  return L;
}

// Short ticks just outside each corner — the usual "cut here" convention.
function cutMarks(ctx, x, y, w, h) {
  const len = mm2px(3), off = mm2px(1);
  ctx.save();
  ctx.strokeStyle = '#999';
  ctx.lineWidth = Math.max(1, Math.round(state.dpi / 300));
  ctx.beginPath();
  for (const [cx, sx] of [[x, -1], [x + w, 1]]) {
    for (const [cy, sy] of [[y, -1], [y + h, 1]]) {
      ctx.moveTo(cx + sx * off, cy);           ctx.lineTo(cx + sx * (off + len), cy);
      ctx.moveTo(cx, cy + sy * off);           ctx.lineTo(cx, cy + sy * (off + len));
    }
  }
  ctx.stroke();
  ctx.restore();
}

/* ─────────────────────────── preview ─────────────────────────── */

function render() {
  const L = renderSheet();

  // scale the full-res sheet down into the on-screen canvas
  const view = $('preview');
  const maxH = Math.max(320, window.innerHeight - 170);
  const scale = Math.min(maxH / sheet.height, 720 / sheet.width);
  view.width = Math.round(sheet.width * scale);
  view.height = Math.round(sheet.height * scale);
  const vx = view.getContext('2d');
  vx.imageSmoothingQuality = 'high';
  vx.drawImage(sheet, 0, 0, view.width, view.height);

  // read-outs
  const px = `${mm2px(state.wMM)} × ${mm2px(state.hMM)} px @ ${state.dpi} DPI`;
  const mm = `${round(state.wMM, 1)} × ${round(state.hMM, 1)} mm`;
  $('outInfo').textContent = `${mm}  →  ${px}`;

  const fitted = Math.min(state.copies, L.capacity);
  $('sheetInfo').textContent = L.capacity
    ? `${fitted} of ${state.copies} placed · sheet holds ${L.capacity} (${L.cols} × ${L.rows})`
    : 'Does not fit on the sheet.';

  // warnings
  const msgs = [];
  if (state.bitmap) {
    if (L.capacity === 0) msgs.push('Too big for A4 with these margins — reduce the size, margin, or switch orientation.');
    else if (state.copies > L.capacity) msgs.push(`Only ${L.capacity} copies fit; the rest were dropped.`);
    const srcDpi = state.bitmap.width / (state.wMM / MM_PER_IN);
    if (srcDpi < state.dpi * 0.66) msgs.push(`Source is only ~${Math.round(srcDpi)} DPI at this size — it will look soft in print.`);
  }
  $('warn').hidden = !msgs.length;
  $('warn').textContent = msgs.join(' ');
}

let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; render(); });
}

/* ───────────────────── DPI metadata in exports ───────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Inserts a pHYs chunk so the PNG reports the right physical resolution. */
function pngWithDpi(buf, dpi) {
  const src = new Uint8Array(buf);
  const ppm = Math.round(dpi / 0.0254);              // pixels per metre
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);                                // data length
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);            // "pHYs"
  dv.setUint32(8, ppm); dv.setUint32(12, ppm);
  chunk[16] = 1;                                     // unit = metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));

  const at = 8 + 25;                                 // signature + IHDR
  const out = new Uint8Array(src.length + chunk.length);
  out.set(src.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(src.subarray(at), at + chunk.length);
  return out;
}

/** Sets the JFIF density fields of a JPEG, adding the JFIF header if the
    browser's encoder left it out (Chrome often does). */
function jpegWithDpi(buf, dpi) {
  const b = new Uint8Array(buf);
  if (b[0] !== 0xFF || b[1] !== 0xD8) return b;

  let o = 2;
  while (o < b.length - 4 && b[o] === 0xFF) {
    const marker = b[o + 1];
    const len = (b[o + 2] << 8) | b[o + 3];
    const isJfif = marker === 0xE0 &&
      b[o + 4] === 0x4A && b[o + 5] === 0x46 && b[o + 6] === 0x49 && b[o + 7] === 0x46;
    if (isJfif) {
      b[o + 11] = 1;                                 // units = pixels per inch
      b[o + 12] = dpi >> 8; b[o + 13] = dpi & 0xFF;
      b[o + 14] = dpi >> 8; b[o + 15] = dpi & 0xFF;
      return b;
    }
    if (marker === 0xDA || marker === 0xD9) break;   // start of scan / end
    o += 2 + len;
  }

  // no JFIF segment — splice one in straight after SOI
  const app0 = new Uint8Array([
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
    0x01, dpi >> 8, dpi & 0xFF, dpi >> 8, dpi & 0xFF, 0x00, 0x00,
  ]);
  const out = new Uint8Array(b.length + app0.length);
  out.set(b.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(b.subarray(2), 2 + app0.length);
  return out;
}

const toBlob = (canvas, type, q) =>
  new Promise(res => canvas.toBlob(res, type, q));

async function download(canvas, format, filename) {
  const blob = await toBlob(canvas, `image/${format}`, format === 'jpeg' ? 0.94 : undefined);
  const buf = await blob.arrayBuffer();
  const bytes = format === 'png' ? pngWithDpi(buf, state.dpi) : jpegWithDpi(buf, state.dpi);
  const url = URL.createObjectURL(new Blob([bytes], { type: `image/${format}` }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─────────────────────────── printing ─────────────────────────── */

async function printSheet() {
  renderSheet();
  const L = layout();
  $('pageStyle').textContent = `@page { size: A4 ${state.orient}; margin: 0; }`;

  const img = $('printImg');
  img.style.width = L.sheetW + 'mm';
  img.style.height = L.sheetH + 'mm';

  const blob = await toBlob(sheet, 'image/png');
  const url = URL.createObjectURL(blob);
  img.src = url;
  await img.decode();
  window.print();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ─────────────────────────── wiring ─────────────────────────── */

// dropzone
$('drop').addEventListener('click', () => $('file').click());
$('drop').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $('file').click(); });
$('file').addEventListener('change', e => loadFile(e.target.files[0]));

['dragenter', 'dragover'].forEach(t => $('drop').addEventListener(t, e => {
  e.preventDefault(); $('drop').classList.add('over');
}));
['dragleave', 'drop'].forEach(t => $('drop').addEventListener(t, e => {
  e.preventDefault(); $('drop').classList.remove('over');
}));
$('drop').addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));

document.addEventListener('paste', e => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});

// size
$('unit').addEventListener('change', e => { state.unit = e.target.value; syncDimInputs(); });

function dimChanged(which) {
  const v = parseFloat($(which).value);
  if (!(v > 0)) return;
  const mm = fromUnit(v);
  if (which === 'w') {
    state.wMM = mm;
    if (state.lock && state.bitmap) state.hMM = mm * state.bitmap.height / state.bitmap.width;
  } else {
    state.hMM = mm;
    if (state.lock && state.bitmap) state.wMM = mm * state.bitmap.width / state.bitmap.height;
  }
  $('preset').value = '';
  syncDimInputs();
  schedule();
}
$('w').addEventListener('input', () => dimChanged('w'));
$('h').addEventListener('input', () => dimChanged('h'));

$('lock').addEventListener('click', () => {
  state.lock = !state.lock;
  $('lock').classList.toggle('is-on', state.lock);
  $('lock').setAttribute('aria-pressed', String(state.lock));
  if (state.lock && state.bitmap) {
    state.hMM = state.wMM * state.bitmap.height / state.bitmap.width;
    syncDimInputs();
    schedule();
  }
});

$('preset').addEventListener('change', e => {
  if (!e.target.value) return;
  const [w, h] = e.target.value.split(',').map(Number);
  state.wMM = w; state.hMM = h;
  state.lock = false;
  $('lock').classList.remove('is-on');
  $('lock').setAttribute('aria-pressed', 'false');
  syncDimInputs();
  schedule();
});

$('dpi').addEventListener('change', e => { state.dpi = +e.target.value; syncDimInputs(); schedule(); });
$('fit').addEventListener('change', e => { state.fit = e.target.value; schedule(); });
$('bg').addEventListener('input', e => { state.bg = e.target.value; schedule(); });
$('bgNone').addEventListener('change', e => {
  state.bgNone = e.target.checked;
  $('bg').disabled = e.target.checked;
  schedule();
});

// sheet
$('orient').addEventListener('change', e => { state.orient = e.target.value; schedule(); });
$('margin').addEventListener('input', e => { state.margin = Math.max(0, +e.target.value || 0); schedule(); });
$('gap').addEventListener('input', e => { state.gap = Math.max(0, +e.target.value || 0); schedule(); });
$('copies').addEventListener('input', e => { state.copies = Math.max(1, +e.target.value || 1); schedule(); });
$('marks').addEventListener('change', e => { state.marks = e.target.checked; schedule(); });
$('fill').addEventListener('click', () => {
  state.copies = Math.max(1, layout().capacity);
  $('copies').value = state.copies;
  schedule();
});

// output
$('print').addEventListener('click', printSheet);
$('dlSheet').addEventListener('click', () =>
  download(sheet, 'png', `${state.name}-A4-${state.dpi}dpi.png`));
$('dlImg').addEventListener('click', () => {
  const fmt = $('format').value;
  download(buildTile(), fmt, `${state.name}-${round(state.wMM, 1)}x${round(state.hMM, 1)}mm-${state.dpi}dpi.${fmt}`);
});

window.addEventListener('resize', schedule);

syncDimInputs();
render();
