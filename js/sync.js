/* sync.js — simpan/tarik data ke Google Sheets lewat Google Apps Script (Web App) */
(function () {
  const KS = window.KS;
  const CHUNK = 1500;

  async function call(S, action, payload) {
    const { apiUrl, token } = S.settings;
    if (!apiUrl) throw new Error('URL Apps Script belum diisi (menu Pengaturan).');
    const r = await fetch(apiUrl, {
      method: 'POST',
      // text/plain → tanpa preflight CORS (Apps Script tidak mendukung OPTIONS)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, ...payload }),
    });
    const t = await r.text();
    let j;
    try {
      j = JSON.parse(t);
    } catch (e) {
      throw new Error('Respons bukan JSON — cek deploy Web App (akses: Anyone). ' + t.slice(0, 120));
    }
    if (!j.ok) throw new Error(j.error || 'Gagal');
    return j;
  }

  KS.sync = {
    ping: (S) => call(S, 'ping', {}),

    /** kirim 1 snapshot (hasil analisis + raw) untuk 1 kompetitor */
    async pushSnapshot(S, comp, snaps, idx, a, onProgress) {
      const cur = snaps[idx];
      const header = ['SKU', 'Nama Produk', 'Harga', 'Stok', 'Terjual (total)', 'Terjual periode', 'Rate/hari', 'Status', 'Harga sebelumnya', 'Δ Harga', 'Δ %', 'Match ID', 'Match Nama', 'URL', 'Tanggal Scrape'];
      const rows = a.rows.map((r) => {
        const m = S.matchOf(comp.id, r.k, r.name);
        return [r.k, r.name, r.price, r.stock, r.sold, r.sales, r.rate == null ? '' : +r.rate.toFixed(2), (KS.STATUS[r.status] || {}).label || r.status, r.prevPrice, r.priceDelta, r.pricePct == null ? '' : +r.pricePct.toFixed(1), m ? m.id : '', m ? m.name : '', r.url, cur.date.slice(0, 10)];
      });
      const total = rows.length;
      for (let o = 0; o < total || o === 0; o += CHUNK) {
        await call(S, 'saveCompetitor', { comp, header, first: o === 0, rows: rows.slice(o, o + CHUNK), total });
        onProgress && onProgress(Math.min(1, (o + CHUNK) / Math.max(total, 1)) * 0.6);
        if (total === 0) break;
      }
      // log perubahan (hanya yang berubah)
      const ch = [];
      const L = (r, jenis) => [cur.date.slice(0, 10), comp.name, comp.tier, r.k, r.name, jenis, r.prevPrice ?? '', r.price ?? '', r.priceDelta ?? '', r.pricePct == null ? '' : +r.pricePct.toFixed(1), r.rate == null ? '' : +r.rate.toFixed(2)];
      for (const r of a.rows) {
        if (a.hasPrev && r.status === 'baru') ch.push(L(r, 'SKU baru'));
        else if (r.status === 'naik') ch.push(L(r, 'Penjualan naik'));
        else if (r.status === 'turun') ch.push(L(r, 'Penjualan turun'));
        if (r.priceDelta > 0) ch.push(L(r, 'Harga naik'));
        else if (r.priceDelta < 0) ch.push(L(r, 'Harga turun'));
      }
      for (const r of a.gone) ch.push(L({ ...r, prevPrice: r.price, price: '' }, 'Hilang'));
      for (let o = 0; o < ch.length; o += CHUNK) await call(S, 'saveChanges', { rows: ch.slice(o, o + CHUNK) });
      onProgress && onProgress(0.8);
      // raw snapshot untuk restore
      await call(S, 'saveRaw', { comp, date: cur.date, items: cur.items.map((i) => [i.k, i.name, i.price, i.stock, i.sold, i.url]) });
      onProgress && onProgress(1);
    },

    async pull(S) {
      const { apiUrl, token } = S.settings;
      if (!apiUrl) throw new Error('URL Apps Script belum diisi.');
      const u = apiUrl + (apiUrl.includes('?') ? '&' : '?') + 'action=loadAll&token=' + encodeURIComponent(token || '');
      const r = await fetch(u);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Gagal');
      return j; // {competitors:[{id,name,tier}], snapshots:[{compId,date,items:[[..]]}]}
    },
  };
})();
