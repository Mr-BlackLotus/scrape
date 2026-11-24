/* parse.js — baca JSON hasil scraper dengan deteksi field otomatis */
(function () {
  const KS = window.KS;

  const ALIAS = {
    name: ['name', 'namaproduk', 'nama', 'title', 'product_name', 'productname', 'nama_produk', 'produk', 'product', 'item', 'item_name'],
    price: ['price', 'hargajual', 'harga', 'price_value', 'sale_price', 'current_price', 'harga_jual', 'price_min', 'final_price', 'amount'],
    stock: ['stock', 'stok', 'qty', 'quantity', 'inventory', 'available', 'stok_tersedia', 'stock_qty'],
    sold: ['sold', 'terjualbln', 'terjualbulan', 'terjual_bln', 'sold_month', 'terjual', 'sold_count', 'historical_sold', 'total_sold', 'sales', 'jumlah_terjual', 'sold_total', 'item_sold'],
    sku: ['sku', 'id', 'product_id', 'productid', 'item_id', 'itemid', 'kode', 'code', 'part_number', 'mpn'],
    variant: ['varian', 'variant', 'variasi', 'variation', 'model_name'],
    url: ['url', 'link', 'product_url', 'href', 'permalink'],
    shop: ['competitor', 'kompetitor', 'shop', 'toko', 'store', 'seller', 'shop_name', 'store_name'],
    date: ['scraped_at', 'scrapedat', 'date', 'tanggal', 'timestamp', 'crawled_at', 'updated_at'],
  };
  KS.FIELDS = ['name', 'variant', 'price', 'stock', 'sold', 'sku', 'url'];
  KS.FIELD_LABEL = { name: 'Nama', variant: 'Varian', price: 'Harga', stock: 'Stok', sold: 'Terjual', sku: 'SKU/ID', url: 'URL' };

  const nk = (k) => String(k).toLowerCase().replace(/[^a-z0-9_]/g, '');

  function findItems(root) {
    // cari array of object terbesar
    let best = null;
    (function walk(o, depth) {
      if (depth > 4 || o == null || typeof o !== 'object') return;
      if (Array.isArray(o)) {
        if (o.length && typeof o[0] === 'object' && o[0] !== null && !Array.isArray(o[0])) {
          if (!best || o.length > best.length) best = o;
        }
        return;
      }
      const vals = Object.values(o);
      // object-of-objects (key = sku)
      if (vals.length > 3 && vals.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
        const arr = Object.entries(o).map(([k, v]) => ({ __key: k, ...v }));
        if (!best || arr.length > best.length) best = arr;
      }
      vals.forEach((v) => walk(v, depth + 1));
    })(root, 0);
    return best || [];
  }

  KS.detectMapping = function (items) {
    const keys = new Map();
    items.slice(0, 50).forEach((it) => Object.keys(it).forEach((k) => keys.set(nk(k), k)));
    const map = {};
    for (const f of Object.keys(ALIAS)) {
      for (const a of ALIAS[f]) {
        if (keys.has(a)) {
          map[f] = keys.get(a);
          break;
        }
      }
    }
    // "id" sebagai SKU hanya jika tidak ada sku lain
    return { map, keys: Array.from(keys.values()) };
  };

  KS.parsePrice = function (v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'object') return KS.parsePrice(v.min ?? v.value ?? v.price ?? v.amount);
    let s = String(v).toLowerCase().replace(/rp|idr|\s/g, '');
    if (s.includes('-')) s = s.split('-')[0]; // rentang → ambil terendah
    if (/,\d{1,2}$/.test(s)) s = s.replace(/,\d{1,2}$/, '');
    else if (/^\d+\.\d{1,2}$/.test(s)) s = s.replace(/\.\d{1,2}$/, '');
    const d = s.replace(/[^0-9]/g, '');
    return d ? Number(d) : null;
  };

  KS.parseCount = function (v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'object') return KS.parseCount(v.qty ?? v.value ?? v.count);
    const s = String(v).toLowerCase().trim();
    if (/habis|sold ?out|kosong|out of stock/.test(s)) return 0;
    if (/^(in ?stock|tersedia|ready)/.test(s)) return null;
    const m = s.match(/([\d.,]+)\s*(rb|ribu|k|jt|juta|m)?/);
    if (!m) return null;
    let n = parseFloat(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    if (isNaN(n)) return null;
    const u = m[2];
    if (u === 'rb' || u === 'ribu' || u === 'k') n *= 1000;
    else if (u === 'jt' || u === 'juta' || u === 'm') n *= 1e6;
    return Math.round(n);
  };

  KS.normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** Ubah item mentah → item standar. opts.merge: gabung baris varian jadi 1 produk (per URL tanpa #varian) */
  KS.normalizeItems = function (rawItems, map, opts = {}) {
    if (opts.merge && map.variant) return mergeVariants(rawItems, map);
    const out = new Map();
    for (const it of rawItems) {
      const name = String(it[map.name] ?? '').trim();
      if (!name) continue;
      const url = map.url ? String(it[map.url] ?? '') : '';
      const skuRaw = map.sku ? it[map.sku] : it.__key;
      const vr = map.variant ? String(it[map.variant] ?? '').trim() : '';
      const hasV = vr && !/^[-–—]$/.test(vr);
      let key = String(skuRaw ?? '').trim() || url || KS.normName(name);
      if (hasV && !key.includes(vr)) key += '#' + vr; // tiap varian = 1 baris sendiri
      const o = {
        k: key,
        name: hasV ? name + ' ▸ ' + vr : name, // "▸ varian" dibaca matcher: gram/kapasitas/warna varian dipakai untuk mencocokkan
        price: KS.parsePrice(it[map.price]),
        stock: map.stock ? KS.parseCount(it[map.stock]) : null,
        sold: map.sold ? KS.parseCount(it[map.sold]) : null,
        url,
      };
      if (!out.has(key)) out.set(key, o);
    }
    return Array.from(out.values());
  };

  function mergeVariants(rawItems, map) {
    const groups = new Map();
    for (const it of rawItems) {
      const name = String(it[map.name] ?? '').trim();
      if (!name) continue;
      const url = map.url ? String(it[map.url] ?? '').trim() : '';
      const base = url ? url.split('#')[0] : KS.normName(name);
      let g = groups.get(base);
      if (!g) groups.set(base, (g = { base, name, url: url ? base : '', rows: [] }));
      g.rows.push({
        v: String(it[map.variant] ?? '').trim(),
        price: KS.parsePrice(it[map.price]),
        stock: map.stock ? KS.parseCount(it[map.stock]) : null,
        sold: map.sold ? KS.parseCount(it[map.sold]) : null,
      });
    }
    return Array.from(groups.values()).map((g) => {
      const avail = g.rows.filter((r) => r.price != null && (r.stock == null || r.stock > 0));
      const prices = avail.map((r) => r.price);
      const stocks = g.rows.map((r) => r.stock).filter((x) => x != null);
      const solds = g.rows.map((r) => r.sold).filter((x) => x != null);
      return {
        k: g.base,
        name: g.name,
        price: prices.length ? Math.min(...prices) : null, // harga mulai dari (varian tersedia termurah)
        pmax: prices.length ? Math.max(...prices) : null,
        stock: stocks.length ? stocks.reduce((a, b) => a + b, 0) : null,
        sold: solds.length ? Math.max(...solds) : null, // terjual level produk (sama di semua varian)
        nv: g.rows.length,
        url: g.url,
      };
    });
  }

  /** deteksi arti kolom terjual: 'monthly' (per bulan) atau 'cumulative' */
  KS.detectSoldMode = function (map, keys, raw) {
    const k = String(map.sold || '').toLowerCase();
    if (/bln|bulan|month|30/.test(k)) return 'monthly';
    for (const col of keys) if (/keterangan.*terjual|sold.*(period|unit)/i.test(col)) {
      const v = String((raw[0] || {})[col] || '').toLowerCase();
      if (/bulan|month/.test(v)) return 'monthly';
    }
    return 'cumulative';
  };

  /** Baca File (.json/.jsonl/.xlsx/.csv) → {fileName, raw, mapping, keys, competitorHint, date, soldMode, hasVariant} */
  KS.readJSONFile = KS.readScrapeFile = async function (file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let raw,
      root = null;
    if (ext === 'xlsx' || ext === 'xlsm') raw = await KS.readXLSX(await file.arrayBuffer());
    else if (ext === 'csv' || ext === 'tsv') raw = KS.rowsToObjects(KS.parseCSV(await file.text()));
    else if (ext === 'xls') throw new Error('Format .xls lama tidak didukung — simpan ulang sebagai .xlsx atau .csv');
    else {
      const text = await file.text();
      try {
        root = JSON.parse(text);
      } catch (e) {
        root = text.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); // JSON Lines
      }
      raw = findItems(root);
    }
    const { map, keys } = KS.detectMapping(raw);
    let competitorHint = '',
      dateHint = '';
    if (root && !Array.isArray(root) && typeof root === 'object') {
      const rk = new Map(Object.keys(root).map((k) => [nk(k), k]));
      for (const a of ALIAS.shop) if (rk.has(a) && typeof root[rk.get(a)] !== 'object') competitorHint = String(root[rk.get(a)]);
      for (const a of ALIAS.date) if (rk.has(a)) dateHint = String(root[rk.get(a)]);
    }
    if (!competitorHint && map.shop && raw[0]) competitorHint = String(raw[0][map.shop] || '');
    if (!dateHint && map.date && raw[0]) dateHint = String(raw[0][map.date] || '');
    // nama file ala "shopee_namatoko_terlaris_p1-1_4.xlsx" → namatoko
    if (!competitorHint) {
      const m = file.name.match(/^(?:shopee|tokopedia|tokped|lazada|blibli|bukalapak)[_\- ]+([^_\- .]+)/i);
      if (m) competitorHint = m[1];
    }
    let d = dateHint ? new Date(dateHint) : null;
    if (d && isNaN(d) && /^\d{9,13}$/.test(dateHint)) d = new Date(dateHint.length <= 10 ? dateHint * 1000 : +dateHint);
    if (!d || isNaN(d)) d = new Date(file.lastModified || Date.now());
    return {
      fileName: file.name,
      raw,
      mapping: map,
      keys,
      competitorHint,
      date: d.toISOString(),
      soldMode: KS.detectSoldMode(map, keys, raw),
      hasVariant: !!(map.variant && map.url),
    };
  };
})();
