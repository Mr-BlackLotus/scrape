/* core.js — util + IndexedDB storage. Global namespace: window.KS */
(function () {
  const KS = (window.KS = window.KS || {});

  KS.$ = (s, r = document) => r.querySelector(s);
  KS.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  KS.esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  KS.rp = (n) => (n == null || isNaN(n) ? '–' : 'Rp ' + Math.round(n).toLocaleString('id-ID'));
  KS.num = (n) => (n == null || isNaN(n) ? '–' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: 1 }));
  KS.slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  KS.uid = () => Math.random().toString(36).slice(2, 9);
  KS.dayMs = 86400000;
  KS.fmtDate = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '–' : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  KS.median = (arr) => {
    if (!arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  KS.tick = () => new Promise((r) => setTimeout(r, 0));

  // ---------- IndexedDB ----------
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const rq = indexedDB.open('kompetitor-scrape', 1);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        d.createObjectStore('kv');
        d.createObjectStore('snaps', { keyPath: 'id' }).createIndex('comp', 'compId');
        d.createObjectStore('catalogs', { keyPath: 'id' });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then(
      (d) =>
        new Promise((res, rej) => {
          const t = d.transaction(store, mode);
          const st = t.objectStore(store);
          const out = fn(st);
          t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
          t.onerror = () => rej(t.error);
          t.onabort = () => rej(t.error);
        })
    );
  }
  const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

  KS.db = {
    kvGet: (k, def) => open().then((d) => req(d.transaction('kv').objectStore('kv').get(k))).then((v) => (v === undefined ? def : v)),
    kvSet: (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k)),
    snapPut: (s) => tx('snaps', 'readwrite', (st) => st.put(s)),
    snapDel: (id) => tx('snaps', 'readwrite', (st) => st.delete(id)),
    snapAll: () => open().then((d) => req(d.transaction('snaps').objectStore('snaps').getAll())),
    catPut: (c) => tx('catalogs', 'readwrite', (st) => st.put(c)),
    catDel: (id) => tx('catalogs', 'readwrite', (st) => st.delete(id)),
    catAll: () => open().then((d) => req(d.transaction('catalogs').objectStore('catalogs').getAll())),
    clearAll: () =>
      open().then(
        (d) =>
          new Promise((res, rej) => {
            const t = d.transaction(['kv', 'snaps', 'catalogs'], 'readwrite');
            ['kv', 'snaps', 'catalogs'].forEach((s) => t.objectStore(s).clear());
            t.oncomplete = res;
            t.onerror = () => rej(t.error);
          })
      ),
  };

  // ---------- CSV ----------
  KS.parseCSV = function (text) {
    const rows = [];
    let row = [],
      cur = '',
      q = false;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') (cur += '"'), i++;
          else q = false;
        } else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === ';' || c === '\t') (row.push(cur), (cur = ''));
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur);
        cur = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cur += c;
    }
    if (cur !== '' || row.length) (row.push(cur), rows.push(row));
    return rows;
  };

  KS.download = (name, text, type = 'text/csv') => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  KS.toCSV = (rows) =>
    rows.map((r) => r.map((v) => (/[",\n;]/.test(String(v ?? '')) ? '"' + String(v).replace(/"/g, '""') + '"' : v ?? '')).join(',')).join('\n');
})();
