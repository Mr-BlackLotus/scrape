/* match.js — SKU matcher: cocokkan nama produk kompetitor ke katalog kita (beberapa sumber katalog) */
(function () {
  const KS = window.KS;

  const STOP = new Set(['the', 'and', 'with', 'for', 'dan', 'untuk', 'garansi', 'resmi', 'new', 'baru', 'original', 'ori', 'distributor', 'gb', 'tb', 'mb']);

  function tokens(name) {
    const s = String(name).toLowerCase().replace(/[\[\]()]/g, ' ');
    const set = new Set();
    // token gabungan: z170-a → z170a ; ga-z270x-gaming → gaz270x
    (s.match(/[a-z0-9]+(?:[-\/][a-z0-9]+)+/g) || []).forEach((m) => set.add(m.replace(/[-\/]/g, '')));
    s.split(/[^a-z0-9]+/).forEach((t) => {
      if (t && !STOP.has(t)) set.add(t);
    });
    return Array.from(set);
  }
  const isModel = (t) => t.length >= 4 && /\d/.test(t) && /[a-z]/.test(t);

  /** bangun index untuk sumber katalog: rows = [[id,name,cost,price],...] */
  KS.buildIndex = async function (cat, onProgress) {
    const rows = cat.rows;
    const inv = new Map();
    const toks = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const t = tokens(rows[i][1]);
      toks[i] = t;
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
    return { id: cat.id, name: cat.name, rows, inv, toks, idf, N };
  };

  const w = (idx, t) => idx.idf.get(t) ?? Math.log(1 + idx.N); // token tidak dikenal = langka

  /** cari kandidat terbaik di 1 index → [{i,score}] */
  KS.matchOne = function (idx, name, topN = 3) {
    const qt = tokens(name);
    if (!qt.length) return [];
    const cand = new Map();
    for (const t of qt) {
      const a = idx.inv.get(t);
      if (!a || a.length > 4000) continue;
      const wt = w(idx, t);
      for (const i of a) cand.set(i, (cand.get(i) || 0) + wt);
    }
    if (!cand.size) return [];
    const top = Array.from(cand.entries())
      .sort((x, y) => y[1] - x[1])
      .slice(0, 60);
    const qSet = new Set(qt);
    const qSum = qt.reduce((s, t) => s + w(idx, t), 0);
    const qModels = qt.filter(isModel);
    const res = [];
    for (const [i] of top) {
      const ct = idx.toks[i];
      let shared = 0,
        cSum = 0;
      for (const t of ct) {
        const wt = w(idx, t);
        cSum += wt;
        if (qSet.has(t)) shared += wt;
      }
      let sc = 0.6 * ((2 * shared) / (qSum + cSum)) + 0.4 * (shared / Math.min(qSum, cSum));
      // kode model di nama kompetitor tapi tidak ada di katalog → turunkan
      if (qModels.length) {
        const cs = new Set(ct);
        const hit = qModels.filter((m) => cs.has(m)).length;
        if (!hit) sc = Math.min(sc, 0.55);
      }
      res.push({ i, score: sc });
    }
    res.sort((a, b) => b.score - a.score);
    return res.slice(0, topN);
  };

  /** cari di semua index → kandidat gabungan [{src,id,name,cost,price,score}] */
  KS.matchAll = function (indexes, name, topN = 3) {
    const out = [];
    for (const idx of indexes) {
      for (const c of KS.matchOne(idx, name, topN)) {
        const r = idx.rows[c.i];
        out.push({ src: idx.id, srcName: idx.name, id: r[0], name: r[1], cost: r[2] || null, price: r[3] || null, score: c.score });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, topN);
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
