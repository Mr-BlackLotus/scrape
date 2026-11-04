/* analyze.js — bandingkan snapshot: SKU baru, penjualan naik/turun, perubahan harga */
(function () {
  const KS = window.KS;

  const gapDays = (a, b) => Math.max(1 / 24, (new Date(b) - new Date(a)) / KS.dayMs);

  /** penjualan antar dua snapshot untuk 1 item (null = tidak diketahui) */
  function soldBetween(p, c) {
    if (p && c && p.sold != null && c.sold != null) return { n: Math.max(0, c.sold - p.sold), via: 'terjual' };
    if (p && c && p.stock != null && c.stock != null) {
      return { n: Math.max(0, p.stock - c.stock), via: 'stok', restock: c.stock > p.stock };
    }
    return null;
  }

  /**
   * snaps: snapshot untuk 1 kompetitor, urut tanggal naik. idx = snapshot yang dianalisis (default terakhir).
   * return { rows:[...], gone:[...], hasPrev, prevDate, cfg }
   */
  KS.analyzeComp = function (snaps, idx, cfg = {}) {
    const UP = cfg.upRatio ?? 1.25,
      DOWN = cfg.downRatio ?? 0.75;
    idx = idx == null ? snaps.length - 1 : idx;
    const cur = snaps[idx],
      prev = snaps[idx - 1],
      prev2 = snaps[idx - 2];
    if (!cur) return { rows: [], gone: [], hasPrev: false };
    const pm = prev ? new Map(prev.items.map((i) => [i.k, i])) : null;
    const p2m = prev2 ? new Map(prev2.items.map((i) => [i.k, i])) : null;
    const monthly = cur.soldMode === 'monthly';
    const bothMonthly = monthly && prev && prev.soldMode === 'monthly';
    const dt = prev ? gapDays(prev.date, cur.date) : null;
    const dt2 = prev2 ? gapDays(prev2.date, prev.date) : null;

    const rows = cur.items.map((it) => {
      const p = pm ? pm.get(it.k) : null;
      const r = {
        ...it,
        prevPrice: p ? p.price : null,
        priceDelta: null,
        pricePct: null,
        sales: null,
        rate: null,
        prevRate: null,
        via: null,
        restock: false,
        status: 'baseline',
      };
      if (monthly && it.sold != null) {
        // kolom terjual = penjualan per bulan (30 hari) → laju per hari langsung diketahui
        r.sales = it.sold;
        r.rate = it.sold / 30;
        r.via = 'bulan';
      }
      if (!prev) return r; // upload pertama: belum ada pembanding
      if (!p) {
        r.status = 'baru';
        return r;
      }
      if (it.price != null && p.price != null && it.price !== p.price) {
        r.priceDelta = it.price - p.price;
        r.pricePct = p.price ? (r.priceDelta / p.price) * 100 : null;
      }
      if (monthly) {
        if (bothMonthly && p.sold != null) r.prevRate = p.sold / 30; // cukup 2 scrape untuk tren
      } else {
        const s = soldBetween(p, it);
        if (s) {
          r.sales = s.n;
          r.rate = s.n / dt;
          r.via = s.via;
          r.restock = !!s.restock;
        }
        if (p2m) {
          const s2 = soldBetween(p2m.get(it.k), p);
          if (s2) r.prevRate = s2.n / dt2;
        }
      }
      // status penjualan
      if (r.rate == null) r.status = 'tanpa-data';
      else if (r.prevRate != null) {
        if (r.rate > 0 && (r.prevRate === 0 || r.rate >= r.prevRate * UP)) r.status = 'naik';
        else if (r.prevRate > 0 && r.rate <= r.prevRate * DOWN) r.status = 'turun';
        else r.status = r.rate > 0 ? 'laku' : 'stagnan';
      } else r.status = r.rate > 0 ? 'laku' : 'stagnan';
      return r;
    });

    let gone = [];
    if (prev) {
      const cm = new Set(cur.items.map((i) => i.k));
      gone = prev.items.filter((i) => !cm.has(i.k)).map((i) => ({ ...i, status: 'hilang' }));
    }
    return { rows, gone, hasPrev: !!prev, prevDate: prev ? prev.date : null, date: cur.date };
  };

  /** ringkasan angka */
  KS.summarize = function (a) {
    const s = { total: a.rows.length, baru: 0, naik: 0, turun: 0, laku: 0, stagnan: 0, hargaNaik: 0, hargaTurun: 0, hilang: a.gone.length };
    for (const r of a.rows) {
      if (s[r.status] != null) s[r.status]++;
      if (r.priceDelta > 0) s.hargaNaik++;
      else if (r.priceDelta < 0) s.hargaTurun++;
    }
    return s;
  };

  KS.STATUS = {
    baru: { label: 'SKU Baru', cls: 'new' },
    naik: { label: 'Penjualan Naik', cls: 'up' },
    turun: { label: 'Penjualan Turun', cls: 'down' },
    laku: { label: 'Laku', cls: 'ok' },
    stagnan: { label: 'Stagnan', cls: 'flat' },
    hilang: { label: 'Hilang', cls: 'gone' },
    baseline: { label: 'Baseline', cls: 'flat' },
    'tanpa-data': { label: 'Tanpa data jual', cls: 'flat' },
  };

  // ---------- Rekomendasi lintas kompetitor ----------
  const roundTo = (v, step) => (step > 1 ? Math.round(v / step) * step : Math.round(v));

  /**
   * comps: [{comp, snaps}] ; matchOf(compId,key,name) → {src,id,name,cost,price}|null
   * return groups[] terurut skor.
   */
  KS.buildGroups = function (comps, matchOf, cfg) {
    const groups = new Map();
    for (const { comp, snaps } of comps) {
      if (!snaps.length) continue;
      const a = KS.analyzeComp(snaps, null, cfg);
      for (const r of a.rows) {
        const m = matchOf(comp.id, r.k, r.name);
        const gk = m ? `m:${m.src}:${m.id}` : `u:${KS.normName(r.name)}`;
        let g = groups.get(gk);
        if (!g) groups.set(gk, (g = { key: gk, name: m ? m.name : r.name, match: m || null, offers: [] }));
        g.offers.push({ comp, ...r });
      }
    }
    const strategy = cfg.strategy || 'median';
    const step = cfg.round ?? 100;
    const out = [];
    for (const g of groups.values()) {
      const offers = g.offers;
      const avail = offers.filter((o) => o.stock == null || o.stock > 0);
      const sellers = avail.filter((o) => (o.rate != null ? o.rate > 0 : o.sold > 0));
      const basis = (sellers.length ? sellers : avail).filter((o) => o.price != null);
      const prices = basis.map((o) => o.price);
      const allPrices = avail.filter((o) => o.price != null).map((o) => o.price);
      g.nCarriers = offers.length;
      g.nSellers = sellers.length;
      g.rate = offers.reduce((s, o) => s + (o.rate || 0), 0);
      g.hasRate = offers.some((o) => o.rate != null);
      g.soldTotal = offers.reduce((s, o) => s + (o.via === 'bulan' ? 0 : o.sold || 0), 0);
      g.monthly = offers.some((o) => o.via === 'bulan');
      g.stock = offers.reduce((s, o) => s + (o.stock || 0), 0);
      g.min = allPrices.length ? Math.min(...allPrices) : null;
      g.max = allPrices.length ? Math.max(...allPrices) : null;
      g.med = KS.median(allPrices);
      g.hasNaik = offers.some((o) => o.status === 'naik');
      g.hasBaru = offers.some((o) => o.status === 'baru');
      g.allTurun = offers.length && offers.every((o) => o.status === 'turun');
      if (prices.length) {
        let sug = strategy === 'min' ? Math.min(...prices) : strategy === 'min1' ? Math.min(...prices) * 0.99 : KS.median(prices);
        g.suggest = roundTo(sug, step);
      } else g.suggest = null;
      g.cost = g.match && g.match.cost ? g.match.cost : null;
      g.margin = g.cost && g.suggest ? ((g.suggest - g.cost) / g.suggest) * 100 : null;
      // skor: penjualan (delta) + total terjual, bonus jika banyak kompetitor menjual
      g.score = (g.rate * 10 + g.soldTotal * 0.05) * (1 + 0.25 * Math.max(0, g.nSellers - 1)) + (g.hasNaik ? 5 : 0);
      g.ok = avail.length > 0 && g.suggest != null && (g.nSellers > 0 || g.soldTotal > 0);
      g.tiers = [...new Set(offers.map((o) => o.comp.tier))];
      out.push(g);
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  };
})();
