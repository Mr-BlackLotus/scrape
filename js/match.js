/* match.js — SKU matcher: cocokkan nama produk kompetitor ke katalog kita (beberapa sumber katalog) */
(function () {
  const KS = window.KS;

  // ---------------------------------------------------------------------
  // Normalisasi & pembacaan atribut (merek, warna, tipe, spesifikasi)
  // ---------------------------------------------------------------------
  const STOP = new Set(['the', 'and', 'with', 'for', 'dan', 'untuk', 'garansi', 'resmi', 'new', 'baru', 'original', 'ori', 'distributor', 'gb', 'tb', 'mb', 'x', 'by', 'ready', 'stock', 'promo', 'murah', 'free', 'bonus', 'official', 'store']);

  // merek bernama lebih dari satu kata → jadikan satu token
  const ALIASES = [
    [/\btp[\s-]?link\b/g, 'tplink'], [/\bd[\s-]?link\b/g, 'dlink'], [/\bcooler\s?master\b/g, 'coolermaster'], [/\blian[\s-]?li\b/g, 'lianli'],
    [/\bbe\s?quiet!?/g, 'bequiet'], [/\bteam\s?group\b/g, 'teamgroup'], [/\bteam\b/g, 'teamgroup'], [/\bsilicon\s?power\b/g, 'siliconpower'],
    [/\bwestern\s?digital\b/g, 'wd'], [/\bg[.\s-]?skill\b/g, 'gskill'], [/\bid[\s-]?cooling\b/g, 'idcooling'], [/\bsuper\s?flower\b/g, 'superflower'],
    [/\bthermal\s?take\b/g, 'thermaltake'], [/\bsteel\s?series\b/g, 'steelseries'], [/\bpower\s?color\b/g, 'powercolor'], [/\bpower\s?logic\b/g, 'powerlogic'],
    [/\brose\s?gold\b/g, 'rosegold'], [/\babu[\s-]?abu\b/g, 'abu'], [/\bspace\s?(gr[ae]y)\b/g, '$1'],
  ];
  const KNOWN_BRANDS = new Set(('asus msi gigabyte asrock biostar intel amd nvidia zotac palit galax inno3d colorful sapphire powercolor xfx pny gainward leadtek manli afox ' +
    'corsair kingston adata xpg gskill teamgroup crucial samsung wd seagate toshiba sandisk lexar hikvision transcend patriot klevv siliconpower apacer ' +
    'deepcool coolermaster thermaltake nzxt lianli bequiet noctua arctic idcooling ocypus jonsbo antec aerocool cougar xigmatek phanteks fractal cube montech tecware ' +
    'fantech rexus logitech razer steelseries redragon rapoo ducky leopold keychron havit armaggeddon alliance ' +
    'tplink dlink tenda mercusys ubiquiti mikrotik linksys netgear zyxel ruijie hp dell lenovo acer apple xiaomi huawei oppo vivo realme ' +
    'ugreen baseus anker orico seasonic fsp evga silverstone enermax superflower cwt powerlogic epson canon brother benq viewsonic lg aoc philips sennheiser jbl sony ' +
    'qnap synology wacom ').split(/\s+/).filter(Boolean));
  // kata umum yang bukan merek walau sering muncul di awal nama
  const GENERIC = new Set(['battery', 'kabel', 'cooler', 'digital', 'notebook', 'laptop', 'powerbank', 'toner', 'casing', 'fan', 'kipas', 'mouse', 'keyboard', 'ssd', 'hdd', 'ram', 'vga', 'psu', 'monitor', 'headset', 'speaker', 'printer', 'memory', 'flashdisk', 'flash', 'adaptor', 'charger', 'tinta', 'ink', 'paper', 'cartridge', 'lcd', 'led', 'usb', 'hdmi', 'router', 'switch', 'cable', 'processor', 'motherboard', 'mainboard', 'external', 'internal', 'wireless', 'gaming', 'paket', 'set', 'pc', 'ups', 'stabilizer', 'tas', 'bag', 'case', 'cover', 'screen', 'mousepad', 'webcam', 'microphone', 'mic', 'lampu']);
  // istilah teknis: bukan merek, tetapi tetap bagian dari tipe produk
  const TECH = new Set(['argb', 'rgb', 'typec', 'type', 'nvme', 'sata', 'm2', 'pcie', 'ddr3', 'ddr4', 'ddr5', 'usb3', 'wifi', 'bluetooth', 'gen4', 'gen3', 'series', 'pro', 'plus', 'mini', 'max', 'ultra', 'lite']);
  TECH.forEach((t) => GENERIC.add(t));

  // warna (Indonesia & Inggris) → nama kanonik
  const COLOR_MAP = {};
  Object.entries({
    white: ['white', 'putih'], black: ['black', 'hitam'], red: ['red', 'merah'], blue: ['blue', 'biru'], green: ['green', 'hijau'],
    grey: ['grey', 'gray', 'abu'], silver: ['silver', 'perak'], gold: ['gold', 'emas'], rosegold: ['rosegold'], pink: ['pink'], yellow: ['yellow', 'kuning'],
    purple: ['purple', 'ungu'], orange: ['orange', 'oranye', 'jingga'], brown: ['brown', 'coklat', 'cokelat'], beige: ['beige', 'cream', 'krem'],
  }).forEach(([k, a]) => a.forEach((w) => (COLOR_MAP[w] = k)));
  const COLOR_ID = { white: 'putih', black: 'hitam', red: 'merah', blue: 'biru', green: 'hijau', grey: 'abu-abu', silver: 'silver', gold: 'gold', rosegold: 'rose gold', pink: 'pink', yellow: 'kuning', purple: 'ungu', orange: 'oranye', brown: 'coklat', beige: 'krem' };

  const num1 = (n) => parseFloat(String(n).replace(',', '.'));
  /** samakan penulisan satuan: 12cm = 120mm, 1000GB = 1TB, 16 GB = 16gb, 3200 MHz = 3200mhz */
  function normText(name) {
    let s = String(name).toLowerCase().replace(/[\[\]()|,;]/g, ' ');
    for (const [re, to] of ALIASES) s = s.replace(re, to);
    s = s.replace(/(\d)\s*x\s*(?=\d)/g, '$1 x ');
    s = s.replace(/(\d+(?:[.,]\d+)?)\s*cm\b/g, (_, n) => Math.round(num1(n) * 10) + 'mm');
    s = s.replace(/(\d+)\s*mm\b/g, '$1mm');
    s = s.replace(/(\d+(?:[.,]\d+)?)\s*(gb|tb|mb|mhz|ghz)\b/g, (_, n, u) => {
      n = num1(n);
      if (u === 'gb' && [1000, 1024, 2000, 2048, 4000, 4096, 8000, 8192].includes(n)) return n / (n % 1000 === 0 ? 1000 : 1024) + 'tb';
      return n + u;
    });
    s = s.replace(/(\d+)\s*(?:watt|w)\b/g, '$1w');
    s = s.replace(/(\d+(?:[.,]\d+)?)\s*(?:gram|gr|g)\b/g, (_, n) => num1(n) + 'g'); // 4 gram / 4gr / 4G → 4g
    s = s.replace(/(\d+(?:[.,]\d+)?)\s*(?:ml|mL)\b/g, (_, n) => num1(n) + 'ml');
    s = s.replace(/(\d+(?:[.,]\d+)?)\s*(?:inch|inci|in\b|"|''|″)/g, (_, n) => num1(n) + 'inch');
    s = s.replace(/\bddr\s*([2-5])\b/g, 'ddr$1');
    return s;
  }
  function tokenList(s) {
    const list = [];
    s.split(/[^a-z0-9.]+/).forEach((t) => {
      t = t.replace(/^\.+|\.+$/g, '');
      if (t && !STOP.has(t)) list.push(t); // menurut urutan kata (merek biasanya di depan)
    });
    (s.match(/[a-z0-9]+(?:[-\/][a-z0-9]+)+/g) || []).forEach((m) => list.push(m.replace(/[-\/]/g, ''))); // z170-a → z170a (di belakang)
    return list;
  }
  function tokens(name) {
    return Array.from(new Set(tokenList(normText(name))));
  }

  const SPEC_TOKEN = /^(\d+(?:\.\d+)?)(mm|gb|tb|mb|mhz|ghz|w|inch|g|ml)$|^ddr\d$|^usb\d?$|^sata\d?$|^pcie\d?$|^\d+$|^\d+x\d+$/;
  const isSpecTok = (t) => SPEC_TOKEN.test(t);
  const isModel = (t) => t.length >= 3 && /\d/.test(t) && /[a-z]/.test(t) && !isSpecTok(t);
  const SPEC_KINDS = [
    ['mm', /\b(\d{2,4})mm\b/g, 'Ukuran', (v) => v + 'mm'],
    ['cap', /\b(\d+(?:\.\d+)?)(gb|tb)\b/g, 'Kapasitas', (v, u) => v + u.toUpperCase()],
    ['mhz', /\b(\d{3,5})mhz\b/g, 'Kecepatan', (v) => v + 'MHz'],
    ['ddr', /\bddr([2-5])\b/g, 'Tipe RAM', (v) => 'DDR' + v],
    ['w', /\b(\d{2,4})w\b/g, 'Daya', (v) => v + 'W'],
    ['inch', /\b(\d{1,2}(?:\.\d)?)inch\b/g, 'Layar', (v) => v + '"'],
    ['g', /\b(\d+(?:\.\d+)?)g\b/g, 'Berat', (v) => v + 'g'],
    ['ml', /\b(\d+(?:\.\d+)?)ml\b/g, 'Volume', (v) => v + 'ml'],
  ];

  /** baca atribut sebuah nama produk. brands = Set merek yang dikenal */
  function analyzeRaw(name, brands) {
    const s = normText(name);
    const list = tokenList(s);
    const toks = Array.from(new Set(list));
    let brand = null;
    for (const t of list) {
      if (brands.has(t)) {
        brand = t;
        break;
      }
    }
    const colors = [];
    for (const t of list) if (COLOR_MAP[t] && !colors.includes(COLOR_MAP[t])) colors.push(COLOR_MAP[t]);
    const specs = {};
    for (const [k, re] of SPEC_KINDS) {
      const vals = [];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) vals.push(k === 'cap' ? m[1] + m[2] : m[1]);
      if (vals.length) specs[k] = Array.from(new Set(vals));
    }
    const colorToks = new Set(Object.keys(COLOR_MAP));
    const core = toks.filter((t) => t !== brand && !colorToks.has(t));
    const type = [];
    for (const t of list) if (t !== brand && !colorToks.has(t) && !isSpecTok(t) && (!GENERIC.has(t) || TECH.has(t)) && !type.includes(t)) type.push(t);
    return { brand, colors, specs, toks, core, models: core.filter(isModel), type };
  }

  const VSEP = ' ▸ ';
  /** nama item scrape bisa berbentuk "nama produk ▸ varian": spesifikasi & warna dari varian menggantikan yang ada di nama
   *  (mis. "MX-7 2G 4G 8G ▸ 4G" → berat 4g saja) */
  function analyze(name, brands) {
    name = String(name);
    const i = name.indexOf(VSEP);
    if (i < 0) return analyzeRaw(name, brands);
    const a = analyzeRaw(name.slice(0, i), brands);
    const v = analyzeRaw(name.slice(i + VSEP.length), brands);
    for (const [k, , , fmt] of SPEC_KINDS) {
      if (!v.specs[k]) continue;
      const tk = (x) => (k === 'cap' ? x : fmt(x).toLowerCase());
      const stale = new RegExp('^' + (SPEC_KINDS.find((z) => z[0] === k)[1].source.replace(/\\b/g, '')) + '$');
      const drop = (t) => stale.test(t);
      a.core = a.core.filter((t) => !drop(t));
      a.toks = a.toks.filter((t) => !drop(t));
      a.type = a.type.filter((t) => !drop(t));
      for (const x of v.specs[k]) {
        const t = tk(x);
        if (!a.toks.includes(t)) a.toks.push(t);
        if (!a.core.includes(t)) a.core.push(t);
      }
      a.specs[k] = v.specs[k];
    }
    if (v.colors.length) a.colors = v.colors;
    return a;
  }

  /** bangun index untuk sumber katalog: rows = [[id,name,cost,price],...] */
  KS.buildIndex = async function (cat, onProgress) {
    const rows = cat.rows;
    const inv = new Map();
    const toks = new Array(rows.length);
    const firstCount = new Map();
    for (let i = 0; i < rows.length; i++) {
      const t = tokens(rows[i][1]);
      toks[i] = t;
      if (t.length) firstCount.set(t[0], (firstCount.get(t[0]) || 0) + 1);
      for (const x of t) {
        let a = inv.get(x);
        if (!a) inv.set(x, (a = []));
        a.push(i);
      }
      if (i % 8000 === 0) {
        onProgress && onProgress(i / rows.length);
        await KS.tick();
      }
    }
    const N = rows.length;
    const idf = new Map();
    for (const [t, a] of inv) idf.set(t, Math.log(1 + N / a.length));
    // merek = merek yang dikenal + kata pertama nama katalog yang muncul ≥3 kali dan bukan kata umum
    const brands = new Set(KNOWN_BRANDS);
    for (const [t, n] of firstCount) if (n >= 3 && t.length >= 2 && !/^\d/.test(t) && !GENERIC.has(t) && n / (inv.get(t) || [0]).length >= 0.3) brands.add(t);
    GENERIC.forEach((g) => KNOWN_BRANDS.has(g) || brands.delete(g));
    return { id: cat.id, name: cat.name, rows, inv, toks, idf, N, brands, attrs: new Array(N) };
  };

  const w = (idx, t) => idx.idf.get(t) ?? Math.log(1 + idx.N); // token tidak dikenal = langka
  const attrOf = (idx, i) => idx.attrs[i] || (idx.attrs[i] = analyze(idx.rows[i][1], idx.brands));
  const sumW = (idx, arr) => arr.reduce((s, t) => s + w(idx, t) * (GENERIC.has(t) && !TECH.has(t) ? 0.35 : 1), 0);

  /** bandingkan dua atribut → { sc, caps, why } */
  function compareAttrs(idx, q, c) {
    const why = [];
    const cap = { v: 1 };
    const lim = (x) => (cap.v = Math.min(cap.v, x));

    // tipe / model: kemiripan token inti berbobot IDF
    const qs = new Set(q.core);
    let shared = 0;
    for (const t of c.core) if (qs.has(t)) shared += w(idx, t);
    const qSum = sumW(idx, q.core),
      cSum = sumW(idx, c.core);
    let core = qSum && cSum ? 0.35 * ((2 * shared) / (qSum + cSum)) + 0.65 * (shared / Math.min(qSum, cSum)) : 0;
    core = Math.pow(core, 1.35); // overlap lemah = skor jauh lebih rendah
    const cs = new Set(c.core);
    let modelMul = 1;
    if (q.models.length) {
      const hit = q.models.filter((m) => cs.has(m));
      if (!hit.length) lim(0.45), (modelMul = 0.8);
      else if (hit.length < q.models.length) modelMul = 0.95;
      if (hit.length) core = Math.max(core, 0.62 * Math.min(1, hit.length / Math.min(q.models.length, 2)));
      why.push({ l: 'Tipe', s: hit.length === q.models.length ? 'ok' : hit.length ? 'part' : 'bad', t: q.models.join(' ').toUpperCase() });
    } else why.push({ l: 'Tipe', s: core >= 0.8 ? 'ok' : core >= 0.5 ? 'part' : 'bad', t: q.type.slice(0, 4).join(' ') });
    // katalog punya kode tipe yang tidak ada di query (mis. E1404TA vs E1404FA) = kemungkinan varian lain
    const pre = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
    const extra = c.models.filter((m) => !qs.has(m) && q.models.some((x) => !cs.has(x) && pre(x, m) >= 4));
    if (extra.length && q.models.length) modelMul *= extra.length > 1 ? 0.82 : 0.9;

    // merek
    let brandB = q.brand || c.brand ? 0.97 : 1;
    if (q.brand && c.brand) {
      if (q.brand === c.brand) (brandB = 1), why.unshift({ l: 'Merek', s: 'ok', t: q.brand });
      else (brandB = 0.5), lim(0.4), why.unshift({ l: 'Merek', s: 'bad', t: `${q.brand} ≠ ${c.brand}` });
    } else if (q.brand) why.unshift({ l: 'Merek', s: 'na', t: `${q.brand} (katalog tidak menyebut)` });

    // warna
    let colorB = q.colors.length || c.colors.length ? 0.97 : 1;
    if (q.colors.length && c.colors.length) {
      if (q.colors.some((x) => c.colors.includes(x))) (colorB = 1), why.push({ l: 'Warna', s: 'ok', t: q.colors.map((x) => COLOR_ID[x]).join('/') });
      else (colorB = 0.7), lim(0.62), why.push({ l: 'Warna', s: 'bad', t: `${COLOR_ID[q.colors[0]]} ≠ ${COLOR_ID[c.colors[0]]}` });
    } else if (q.colors.length) why.push({ l: 'Warna', s: 'na', t: `${COLOR_ID[q.colors[0]]} (katalog tidak menyebut)` });

    // spesifikasi: sama jika ada nilai yang sama; beda jika sama-sama menyebut tapi tidak ada yang sama
    for (const [k, , label, fmt] of SPEC_KINDS) {
      const a = q.specs[k],
        b = c.specs[k];
      if (!a) continue;
      const f = (x) => (k === 'cap' ? fmt(x.replace(/[a-z]+$/, ''), x.replace(/[\d.]+/, '')) : fmt(x));
      if (b && a.some((x) => b.includes(x))) why.push({ l: label, s: 'ok', t: a.map(f).join(' / ') });
      else if (b) (lim(0.6), why.push({ l: label, s: 'bad', t: `${a.map(f).join('/')} ≠ ${b.map(f).join('/')}` }));
      else why.push({ l: label, s: 'na', t: `${a.map(f).join('/')} (katalog tidak menyebut)` });
    }
    const score = Math.min(cap.v, core * modelMul * brandB * colorB);
    return { score, why };
  }

  /** cari kandidat terbaik di 1 index → [{i,score,why}] */
  KS.matchOne = function (idx, name, topN = 3) {
    const q = analyze(name, idx.brands);
    if (!q.toks.length) return [];
    const cand = new Map();
    for (const t of q.toks) {
      const a = idx.inv.get(t);
      if (!a || a.length > 4000) continue;
      const wt = w(idx, t);
      for (const i of a) cand.set(i, (cand.get(i) || 0) + wt);
    }
    if (!cand.size) return [];
    const top = Array.from(cand.entries())
      .sort((x, y) => y[1] - x[1])
      .slice(0, 80);
    const res = [];
    for (const [i] of top) {
      const r = compareAttrs(idx, q, attrOf(idx, i));
      res.push({ i, score: r.score, why: r.why });
    }
    res.sort((a, b) => b.score - a.score);
    return res.slice(0, topN);
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

  /** atribut terbaca dari nama produk (untuk ditampilkan): {brand, type, colors[], specs[]} */
  KS.parseProduct = function (name, indexes) {
    const brands = new Set(KNOWN_BRANDS);
    (indexes || []).forEach((x) => x.brands.forEach((b) => brands.add(b)));
    const a = analyze(name, brands);
    const specs = [];
    for (const [k, , label, fmt] of SPEC_KINDS) if (a.specs[k]) specs.push({ l: label, v: a.specs[k].map((x) => (k === 'cap' ? fmt(x.replace(/[a-z]+$/, ''), x.replace(/[\d.]+/, '')) : fmt(x))).join(' / ') });
    return { brand: a.brand, type: a.type.map((t) => (/\d/.test(t) || t.length <= 4 ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1))).join(' '), colors: a.colors.map((c) => COLOR_ID[c]), specs };
  };

  KS.THRESH = { auto: 0.75, review: 0.5 };

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
