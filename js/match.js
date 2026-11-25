/* match.js — SKU matcher: cocokkan nama produk kompetitor ke katalog kita (beberapa sumber katalog).
 * Algoritma skor = "SKU Catalog Matcher" (tokenize / prep / score): cakupan nama & katalog berbobot IDF,
 * penalti merek/kode model/varian/ukuran. Skor 0–1 di aplikasi (0–100 di algoritma aslinya). */
(function () {
  const KS = window.KS;
  const VSEP = ' ▸ '; // "nama produk ▸ varian" (varian dari kolom Varian file scrape)

  // ================= inti algoritma (dari SKU Catalog Matcher) =================
// Tambahkan sinonim/alias sendiri di sini bila perlu (kiri: tulisan di data, kanan: bentuk baku).
const SYN = { hitam: 'black', putih: 'white', merah: 'red', biru: 'blue', kuning: 'yellow', hijau: 'green', abu: 'gray', grey: 'gray', ungu: 'purple', coklat: 'brown', cokelat: 'brown', emas: 'gold', perak: 'silver', tinta: 'ink', wdc: 'wd', western: 'wd' };
const STOP = new Set('original ori garansi resmi bergaransi murah termurah promo ready stok stock new baru free gratis ongkir grosir cod diskon sale hot all color colors colour warna ukuran varian variasi size type tipe dan dengan untuk for and with the yang tahun up to upto'.split(' '));
const COLORS = new Set(['black', 'white', 'red', 'blue', 'green', 'yellow', 'gray', 'silver', 'gold', 'pink', 'purple', 'orange', 'brown', 'cyan', 'magenta', 'clear', 'transparent']);
// kata kategori produk: bukan merek
const GENERIC = new Set('tdp radeon vega graphics cooler ssd hdd nvme sata flash flashdisk flashdrive fd drive disk usb ink mouse keyboard headset headphone earphone speaker kabel cable charger adaptor adapter memory memori ram sdcard card micro printer laptop notebook monitor thermal paste pasta pad fan casing case power supply psu vga gpu cpu processor motherboard mainboard router wifi lan hub cartridge toner refill bottle botol set pack paket combo gaming wireless wired bluetooth portable external internal official tv pc led lcd dc ac gen pcie'.split(' '));
const NOMERGE = new Set('box tray pcs set gen new top pro max mini'.split(' '));   // jangan digabung dengan angka sesudahnya
const SIBL = new Set(['tray', 'box', 'bulk']);
const UMAP = { ghz: 'ghz', mhz: 'mhz', gram: 'g', gr: 'g', g: 'g', kilo: 'kg', kg: 'kg', ml: 'ml', liter: 'l', ltr: 'l', l: 'l', gb: 'gb', giga: 'gb', tb: 'tb', mb: 'mb', mm: 'mm', cm: 'cm', watt: 'w', w: 'w', mah: 'mah' };
const UNIT_RE = /(\d+(?:\.\d+)?)\s*(ghz|mhz|gram|gr|g|kilo|kg|ml|liter|ltr|l|gb|giga|tb|mb|mm|cm|watt|w|mah)\b/g;
const isQty = t => /^\d+(\.\d+)?(g|kg|ml|l|gb|tb|mb|mm|cm|w|mah|mbps|gbps|ghz|mhz)$/.test(t);
const isSpeed = t => /(mbps|gbps)$/.test(t);
const SPEC = /^(m2|gen\d|ddr\d+|usb\d|sata\d?|pcie\d?|22\d{2,3}|\d+\.\d+)$/;   // spesifikasi umum, bukan identitas produk
const soft = t => SPEC.test(t) || GENERIC.has(t);                                  // bobot dikecilkan saat dibandingkan
const isModel = t => /\d/.test(t) && !isQty(t) && !SPEC.test(t) && t.length >= 2;   // kode model: 003, MX7, UV250   // kode model: 003, MX7, UV250, 2280
const union = (a, b) => { const s = new Set(a); for (const w of b) s.add(w); return s; };

// "MX-7"="MX7", "4 GRAM"="4Gr"="4G" -> "4g", "hitam"="black", "Gen4x4"="Gen4", "7000MB/s"="7000mbps"
function tokenize(v) {
  let s = String(v ?? '').toLowerCase().replace(/\(habis\)/g, ' ');
  s = s.replace(/(\d),(\d)/g, '$1.$2').replace(/([a-z])-(\d)/g, '$1$2');
  s = s.replace(/\bgen\s?(\d)x\d\b/g, 'gen$1');
  s = s.replace(/\b\d+\s*c\s*\/\s*\d+\s*t\b/g, ' ').replace(/\b\d+\s*(?:cores?|threads?)\b/g, ' ');                       // "6C/12T", "6 Core"
  s = s.replace(/\b\d+\s*(?:tahun|thn|th(?!\s*gen)|years?|yrs?|bulan|bln|months?)\b/g, ' ');                                           // garansi "3 TAHUN"
  s = s.replace(/(\d+\.\d+)\s*-\s*(\d+\.\d+)\s*ghz/g, '$1ghz $2ghz');                                                               // "3.6-4.6GHZ"
  s = s.replace(/\b[rw]\s*(\d+(?:\.\d+)?)\s*(mb|gb)\s*\/\s*s\b/g, '$1$2ps');
  s = s.replace(/(\d+(?:\.\d+)?)\s*(mb|gb)\s*(?:\/\s*s|ps|s)\b/g, '$1$2ps');
  s = s.replace(/(\d+(?:\.\d+)?)\s*cm\b/g, (m, n) => Math.round(parseFloat(n) * 10) + 'mm'); // tambahan: 12CM = 120mm
  s = s.replace(UNIT_RE, (m, n, u) => n + UMAP[u]);
  s = s.replace(/[^a-z0-9.]+/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' ');
  const t = s.split(/\s+/).filter(Boolean).map(x => SYN[x] || x).filter(x => !STOP.has(x) && !/^\d+(y|yr|yrs|thn)$/.test(x));
  const out = [];
  for (let i = 0; i < t.length; i++) {
    const a = t[i], b = t[i + 1];
    if (b && /^[a-z]{1,3}$/.test(a) && /^\d{1,2}$/.test(b) && !COLORS.has(a) && !NOMERGE.has(a)) { out.push(a + b); i++; } // "mx 7" -> "mx7"
    else out.push(a);
  }
  return out;
}
const clean = v => tokenize(v).join(' ');
const hdr = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); // untuk nama kolom (tanpa filter kata)

function prep(name, variant) {
  const order = tokenize(name);
  const n = new Set(order), v = new Set(tokenize(variant));
  const brand = order.find(t => /^[a-z]{2,}$/.test(t) && !GENERIC.has(t) && !COLORS.has(t)) || '';   // kata pertama yang bukan kategori = merek
  let vv = v;                                            // token varian yang wajib cocok
  if (!vv.size) { const q = [...n].filter(t => isQty(t) && !isSpeed(t)); if (q.length === 1) vv = new Set(q); }
  let nn = n;                                            // token nama (tanpa daftar varian saudara)
  if (vv.size) nn = new Set([...n].filter(t => !isQty(t) && !((COLORS.has(t) || SIBL.has(t)) && !vv.has(t))));
  const all = union(n, v);
  return { n, v, vv, nn, all, brand, cover: union(nn, vv), model: new Set([...all].filter(isModel)) };
}
function remap(c, alias) {
  const f = s => new Set([...s].map(x => alias[x] || x));
  const o = { ...c, n: f(c.n), v: f(c.v), vv: f(c.vv), nn: f(c.nn), all: f(c.all), model: f(c.model) };
  o.cover = union(o.nn, o.vv); return o;
}

// skor 0-100 antara satu baris kompetitor (c) dan satu produk katalog (k)
function score(c, k, w, wm) {
  if (!c.cover.size) return 0;
  let a = 0, b = 0;
  for (const t of c.nn) { const x = soft(t) ? 0.3 * w(t) : w(t); b += x; if (k.all.has(t)) a += x; }
  const nameCover = b ? a / b : 0;                       // seberapa banyak nama kompetitor terjelaskan katalog
  a = 0; b = 0;
  for (const t of k.all) { if (isQty(t)) continue; const x = soft(t) ? 0.3 * w(t) : w(t); b += x; if (c.cover.has(t)) a += x; }
  const catCover = b ? a / b : 0;                        // seberapa banyak nama katalog terjelaskan kompetitor
  let s = 0.65 * nameCover + 0.35 * catCover;
  if (c.brand && !k.all.has(c.brand)) s *= 0.3;          // merek berbeda / tidak ada
  { const cc = [...c.all].filter((t) => COLORS.has(t)); if (cc.length && !cc.some((t) => k.all.has(t)) && [...k.all].some((t) => COLORS.has(t))) s *= 0.5; } // tambahan: warna beda (White ≠ Black)
  if (c.model.size) {
    let tot = 0, miss = 0, top = 0; for (const t of c.model) top = Math.max(top, wm(t));
    for (const t of c.model) { const x = wm(t); if (x < 0.6 * top) continue; tot += x; if (!k.all.has(t)) miss += x; }   // hanya kode yang paling khas
    if (miss) { s *= 1 - 0.65 * miss / tot; for (const t of k.model) if (!c.all.has(t)) { s *= 0.75; break; } } // kode model hilang / katalog punya kode lain
    else if (tot) s += (1 - s) * 0.4;                                                                          // semua kode model khas cocok: identitas produk terkonfirmasi
  } else if (k.model.size) s *= 0.9;
  if (c.vv.size) {                                       // varian harus cocok
    let hit = 0, q = 0, qhit = 0;
    for (const t of c.vv) { const h = k.all.has(t); if (h) hit++; if (isQty(t)) { q++; if (h) qhit++; } }
    s *= 0.4 + 0.6 * hit / c.vv.size;
    if (q && !qhit && [...k.all].some(isQty)) s *= 0.6;  // ukuran berbeda (2g vs 4g)
  }
  return Math.round(100 * s);
}

  // ================= adaptasi ke aplikasi =================
  /** bangun index untuk sumber katalog: rows = [[id,name,cost,price],...] */
  KS.buildIndex = async function (cat, onProgress) {
    const rows = cat.rows,
      N = rows.length;
    const preps = new Array(N),
      index = new Map(),
      byPre = new Map();
    for (let i = 0; i < N; i++) {
      const k = (preps[i] = prep(rows[i][1], ''));
      for (const t of k.all) {
        let p = index.get(t);
        if (!p) index.set(t, (p = []));
        p.push(i);
      }
      if (i % 6000 === 0) {
        onProgress && onProgress(i / N);
        await KS.tick();
      }
    }
    for (const t of index.keys()) if (isModel(t) && t.length >= 3) { const key = t.slice(0, 3); (byPre.get(key) || byPre.set(key, []).get(key)).push(t); }
    const memo = new Map(), memoM = new Map();
    const w = (t) => { let x = memo.get(t); if (x === undefined) { const p = index.get(t); x = p ? Math.log(1 + N / p.length) : 1; memo.set(t, x); } return x; };
    const wm = (t) => { let x = memoM.get(t); if (x === undefined) { const p = index.get(t); x = Math.log(1 + N / (p ? p.length : 0.5)); memoM.set(t, x); } return x; };
    return { id: cat.id, name: cat.name, rows, N, preps, index, byPre, w, wm, maxPost: Math.max(300, N * 0.2), acc: new Float64Array(N) };
  };

  const splitV = (name) => {
    name = String(name ?? '');
    const i = name.indexOf(VSEP);
    return i < 0 ? [name, ''] : [name.slice(0, i), name.slice(i + VSEP.length)];
  };

  /** chip penjelasan: merek, tipe, warna, varian/ukuran */
  function whyOf(c, k) {
    const why = [];
    if (c.brand) why.push(k.all.has(c.brand) ? { l: 'Merek', s: 'ok', t: c.brand } : { l: 'Merek', s: 'bad', t: c.brand + ' tidak ada di katalog' });
    if (c.model.size) {
      const ms = [...c.model],
        hit = ms.filter((t) => k.all.has(t));
      why.push({ l: 'Tipe', s: hit.length === ms.length ? 'ok' : hit.length * 2 >= ms.length ? 'part' : 'bad', t: ms.join(' ').toUpperCase() });
    }
    const cc = [...c.all].filter((t) => COLORS.has(t)),
      kc = [...k.all].filter((t) => COLORS.has(t));
    if (cc.length) why.push(!kc.length ? { l: 'Warna', s: 'na', t: cc.join('/') + ' (katalog tidak menyebut)' } : cc.some((t) => kc.includes(t)) ? { l: 'Warna', s: 'ok', t: cc.join('/') } : { l: 'Warna', s: 'bad', t: cc[0] + ' ≠ ' + kc[0] });
    const q = [...c.vv].filter(isQty).filter((t) => !isSpeed(t));
    if (q.length) {
      const kq = [...k.all].filter((t) => isQty(t) && !isSpeed(t));
      why.push(!kq.length ? { l: 'Ukuran', s: 'na', t: q.join('/') + ' (katalog tidak menyebut)' } : q.some((t) => kq.includes(t)) ? { l: 'Ukuran', s: 'ok', t: q.join('/') } : { l: 'Ukuran', s: 'bad', t: q.join('/') + ' ≠ ' + kq.join('/') });
    }
    return why;
  }

  /** cari kandidat terbaik di 1 index → [{i,score(0-1),why}] */
  KS.matchOne = function (idx, name, topN = 3) {
    const [nm, vr] = splitV(name);
    let c = prep(nm, vr);
    if (!c.cover.size) return [];
    const { index, byPre, w, wm, acc } = idx;
    const alias = {};
    for (const t of c.model) if (!index.has(t) && t.length >= 3) { const u = (byPre.get(t.slice(0, 3)) || []).find((u) => u !== t && Math.abs(u.length - t.length) <= 1 && (t.startsWith(u) || u.startsWith(t))); if (u) alias[t] = u; }
    if (Object.keys(alias).length) c = remap(c, alias);
    const touched = [];
    const collect = (skipCommon) => { for (const t of c.all) { const p = index.get(t); if (!p || (skipCommon && p.length > idx.maxPost)) continue; const x = w(t); for (let q = 0; q < p.length; q++) { const i = p[q]; if (acc[i] === 0) touched.push(i); acc[i] += x; } } };
    collect(true);
    if (!touched.length) collect(false);
    if (!touched.length) return [];
    let max = 0;
    for (const i of touched) if (acc[i] > max) max = acc[i];
    let cand = touched.filter((i) => acc[i] >= max * 0.35);
    if (cand.length > 80) cand = cand.sort((x, y) => acc[y] - acc[x]).slice(0, 80);
    for (const i of touched) acc[i] = 0;
    const sc = cand.map((i) => ({ i, s: score(c, idx.preps[i], w, wm) })).sort((x, y) => y.s - x.s || x.i - y.i);
    return sc.slice(0, topN).map((x) => ({ i: x.i, score: x.s / 100, why: whyOf(c, idx.preps[x.i]) }));
  };

  /** cari di semua index → kandidat gabungan [{src,id,name,cost,price,score,why}] */
  KS.matchAll = function (indexes, name, topN = 3) {
    const out = [];
    for (const idx of indexes) {
      for (const c of KS.matchOne(idx, name, topN)) {
        const r = idx.rows[c.i];
        out.push({ src: idx.id, srcName: idx.name, id: r[0], name: r[1], cost: r[2] || null, price: r[3] || null, score: c.score, why: c.why });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, topN);
  };

  /** langsung tembak 1 match: urut cek merek → tipe → warna (+ukuran varian). Kandidat yang gagal salah satunya dilewati.
   *  null = tidak ada produk katalog yang merek, tipe, dan warnanya sesuai. */
  KS.matchBest = function (indexes, name) {
    for (const m of KS.matchAll(indexes, name, 10)) {
      if (m.score < KS.THRESH.review) break;
      if (m.why.some((x) => x.s === 'bad')) continue;
      return m;
    }
    return null;
  };

  /** atribut terbaca dari nama produk (untuk ditampilkan): {brand, type, colors[], specs[]} */
  KS.parseProduct = function (name) {
    const [nm, vr] = splitV(name);
    const c = prep(nm, vr);
    const q = [...(c.vv.size ? c.vv : c.n)].filter((t) => isQty(t) && !isSpeed(t));
    return {
      brand: c.brand,
      type: [...c.model].join(' ').toUpperCase(),
      colors: [...c.all].filter((t) => COLORS.has(t)),
      specs: q.length ? [{ l: 'Ukuran/kapasitas', v: q.join(' / ') }] : [],
    };
  };

  KS.THRESH = { auto: 0.72, review: 0.45 };

  /** parse CSV katalog → rows [[id,name,cost,price]] ; deteksi kolom id/name/hpp/harga */
  KS.parseCatalog = function (text) {
    const t = KS.parseCSV(text);
    if (!t.length) return [];
    const head = t[0].map((h) => String(h).toLowerCase().trim());
    const find = (arr) => head.findIndex((h) => arr.includes(h));
    let ci = find(['id', 'sku', 'kode', 'code', 'product_id']);
    let cn = find(['name', 'nama', 'nama_produk', 'product', 'produk', 'title']);
    const hasHead = ci >= 0 || cn >= 0;
    if (ci < 0) ci = 0;
    if (cn < 0) cn = 1;
    const cc = find(['hpp', 'modal', 'cost', 'harga_beli', 'harga_modal']);
    const cp = find(['harga', 'price', 'harga_jual']);
    const rows = [];
    for (let i = hasHead ? 1 : 0; i < t.length; i++) {
      const r = t[i];
      const name = (r[cn] || '').trim();
      if (!name) continue;
      rows.push([String(r[ci] || '').trim(), name, cc >= 0 ? KS.parsePrice(r[cc]) : null, cp >= 0 ? KS.parsePrice(r[cp]) : null]);
    }
    return rows;
  };
})();
