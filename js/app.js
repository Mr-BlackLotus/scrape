/* app.js — state, view, event */
(function () {
  const KS = window.KS;
  const { $, $$, esc, rp, num, fmtDate } = KS;

  const S = (KS.S = {
    settings: { apiUrl: '', token: '', strategy: 'median', round: 100, upRatio: 1.25, downRatio: 0.75, autoSync: true, matchAuto: 0.75 },
    comps: [],
    tiers: ['Agresif', 'Expert', 'Reguler'],
    cats: [], // kategori buatan sendiri (mis. Komputer, Laptop, Aksesoris); comp.cat menunjuk salah satunya
    snaps: {}, // compId -> [snapshot] urut tanggal
    catalogs: [], // {id,name,rows,enabled}
    indexes: [],
    catMap: {},
    matches: {}, // "compId|key" -> {src,id,score,manual} | {none:true}
    sugg: {}, // cache saran (memori saja)
    view: 'dashboard',
    dirty: true,
    D: null,
    ui: { dash: { mov: 'baru', tier: 'all', cat: 'all', q: '', minSell: 1, onlyMatched: false, page: 0 }, k: { comp: 'all', group: null, status: 'all', q: '', sort: 'name', dir: 1, page: 0, snap: null }, m: { filter: 'review', q: '', page: 0, comp: 'all' } },
    pending: [],
    lastResult: null,
  });
  const cfg = () => ({ upRatio: S.settings.upRatio, downRatio: S.settings.downRatio, strategy: S.settings.strategy, round: S.settings.round });
  const PAGE = 50;

  // ---------- util UI ----------
  function toast(msg, err) {
    const d = document.createElement('div');
    d.className = 'toast' + (err ? ' err' : '');
    d.textContent = msg;
    $('#toasts').appendChild(d);
    setTimeout(() => d.remove(), err ? 7000 : 3800);
  }
  function setSync(state, text) {
    const el = $('#syncState');
    el.className = 'sync ' + (state || '');
    el.textContent = text;
  }
  function modal(html) {
    const m = $('#modal');
    if (!html) return (m.hidden = true);
    m.innerHTML = `<div class="box">${html}</div>`;
    m.hidden = false;
  }
  const compById = (id) => S.comps.find((c) => c.id === id);
  const lastSnap = (id) => (S.snaps[id] || []).slice(-1)[0];
  const catRow = (src, id) => (S.catMap[src] ? S.catMap[src].get(String(id)) : null);

  S.matchOf = (cid, k, name) => {
    const e = S.matches[cid + '|' + k];
    if (!e || e.none) return null;
    const r = catRow(e.src, e.id);
    if (!r) return null;
    return { src: e.src, id: r[0], name: r[1], cost: r[2], price: r[3], score: e.score, manual: !!e.manual };
  };

  let persistT;
  function persist() {
    clearTimeout(persistT);
    persistT = setTimeout(() => KS.db.kvSet('state', { settings: S.settings, comps: S.comps, tiers: S.tiers, cats: S.cats, matches: S.matches }), 250);
  }
  const dirty = () => ((S.dirty = true), persist());

  // ---------- load ----------
  async function load() {
    const st = await KS.db.kvGet('state', null);
    if (st) Object.assign(S, { comps: st.comps || [], tiers: st.tiers || S.tiers, cats: st.cats || [], matches: st.matches || {} }), Object.assign(S.settings, st.settings || {});
    const snaps = await KS.db.snapAll();
    snaps.sort((a, b) => a.date.localeCompare(b.date));
    for (const s of snaps) (S.snaps[s.compId] = S.snaps[s.compId] || []).push(s);
    S.catalogs = await KS.db.catAll();
    if (!S.catalogs.length) await loadBundledCatalog();
    await rebuildIndexes();
  }

  async function loadBundledCatalog() {
    try {
      const r = await fetch('data/katalog.csv');
      if (!r.ok) return;
      const rows = KS.parseCatalog(await r.text());
      if (rows.length) {
        const c = { id: 'cat-utama', name: 'Katalog Utama', rows, enabled: true };
        S.catalogs.push(c);
        await KS.db.catPut(c);
      }
    } catch (e) {}
  }

  async function rebuildIndexes(prog) {
    S.indexes = [];
    S.catMap = {};
    S.sugg = {};
    for (const c of S.catalogs) {
      const m = new Map();
      for (const r of c.rows) if (!m.has(String(r[0]))) m.set(String(r[0]), r);
      S.catMap[c.id] = m;
      if (c.enabled) S.indexes.push(await KS.buildIndex(c, prog));
    }
    S.dirty = true;
  }

  // ---------- auto match ----------
  async function ensureSugg(onProg, force) {
    if (!S.indexes.length) return;
    const items = [];
    for (const c of S.comps) {
      const l = lastSnap(c.id);
      if (!l) continue;
      for (const it of l.items) {
        const key = c.id + '|' + it.k;
        const e = S.matches[key];
        if (e && !e.none) continue;
        if (e && e.none) continue;
        if (S.sugg[key] && !force) continue;
        items.push([key, it.name]);
      }
    }
    let changed = false;
    for (let i = 0; i < items.length; i++) {
      const [key, name] = items[i];
      const c = KS.matchAll(S.indexes, name, 3);
      S.sugg[key] = c;
      if (c[0] && c[0].score >= S.settings.matchAuto) {
        S.matches[key] = { src: c[0].src, id: c[0].id, score: +c[0].score.toFixed(3), manual: false };
        changed = true;
      }
      if (i % 300 === 0) {
        onProg && onProg(i / items.length);
        await KS.tick();
      }
    }
    onProg && onProg(1);
    if (changed) dirty();
  }

  // ---------- dashboard compute ----------
  function compute() {
    if (S.D && !S.dirty) return S.D;
    const comps = S.comps.map((comp) => ({ comp, snaps: S.snaps[comp.id] || [] }));
    const A = {};
    for (const { comp, snaps } of comps) if (snaps.length) A[comp.id] = KS.analyzeComp(snaps, null, cfg());
    const groups = KS.buildGroups(comps, S.matchOf, cfg());
    const T = { skus: 0, baru: 0, naik: 0, turun: 0, hargaNaik: 0, hargaTurun: 0, hilang: 0, matched: 0, hasPrev: false };
    for (const comp of S.comps) {
      const a = A[comp.id];
      if (!a) continue;
      const s = KS.summarize(a);
      T.skus += s.total;
      ['baru', 'naik', 'turun', 'hargaNaik', 'hargaTurun', 'hilang'].forEach((k) => (T[k] += s[k]));
      T.hasPrev = T.hasPrev || a.hasPrev;
      for (const r of a.rows) if (S.matches[comp.id + '|' + r.k] && !S.matches[comp.id + '|' + r.k].none) T.matched++;
    }
    S.D = { A, groups, T };
    S.dirty = false;
    return S.D;
  }

  // ---------- helpers render ----------
  const chip = (st) => {
    const m = KS.STATUS[st] || { label: st, cls: '' };
    return `<span class="chip ${m.cls}">${m.label}</span>`;
  };
  const tierChip = (t) => `<span class="chip tier">${esc(t)}</span>`;
  /** chip penjelasan kenapa kandidat cocok / tidak (merek, tipe, warna, ukuran…) */
  const whyChips = (why) => (why && why.length ? `<span class="why">${why.map((x) => `<span class="w ${x.s}">${esc(x.l)}${x.s === 'ok' ? ' ✓' : x.s === 'bad' ? ' ✗' : ''} ${esc(x.t)}</span>`).join('')}</span>` : '');
  /** atribut yang terbaca dari nama produk kompetitor */
  const attrLine = (name) => {
    const a = KS.parseProduct(name, S.indexes);
    const parts = [];
    if (a.brand) parts.push(`Merek <b>${esc(a.brand)}</b>`);
    if (a.type) parts.push(`Tipe <b>${esc(a.type)}</b>`);
    if (a.colors.length) parts.push(`Warna <b>${esc(a.colors.join('/'))}</b>`);
    a.specs.forEach((x) => parts.push(`${esc(x.l)} <b>${esc(x.v)}</b>`));
    return parts.length ? `<div class="attrs">${parts.map((x) => `<span>${x}</span>`).join('')}</div>` : '';
  };
  const catChip = (c) => (c ? `<span class="chip cat">${esc(c)}</span>` : '');
  const allCats = () => [...new Set([...S.cats, ...S.comps.map((c) => c.cat).filter(Boolean)])];
  const catOpts = (sel, extra = '') => `<option value="">(tanpa kategori)</option>${allCats().map((t) => `<option ${sel === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}${extra}`;
  /** tanya nama kategori baru; kembalikan nama (sudah didaftarkan) atau null */
  function askNewCat() {
    const n = (prompt('Nama kategori baru (mis. Komputer, Laptop, Aksesoris):') || '').trim();
    if (!n) return null;
    const ex = allCats().find((c) => c.toLowerCase() === n.toLowerCase());
    if (ex) return ex;
    S.cats.push(n);
    persist();
    return n;
  }
  function pcell(r) {
    if (r.priceDelta == null) return '<span class="muted">–</span>';
    const up = r.priceDelta > 0;
    return `<span class="pc ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${rp(Math.abs(r.priceDelta))}<br><span class="small">${r.pricePct == null ? '' : (up ? '+' : '') + r.pricePct.toFixed(1) + '%'}</span></span>`;
  }
  function salesCell(r) {
    if (r.via === 'bulan') return `${num(r.sales)}<span class="muted small">/bln${r.prevRate != null ? ' (sebelumnya ' + num(r.prevRate * 30) + ')' : ''}</span>`;
    if (r.rate == null) return r.sold != null ? `<span class="muted" title="Total terjual">${num(r.sold)} total</span>` : '<span class="muted">–</span>';
    return `${num(r.sales)} <span class="muted small">(${num(r.rate)}/hari${r.via === 'stok' ? ', dari stok' : ''})</span>`;
  }
  function pager(total, page, act) {
    const pages = Math.max(1, Math.ceil(total / PAGE));
    return `<div class="pager"><span class="muted small">${num(total)} baris · hal ${page + 1}/${pages}</span><button class="btn sm" data-act="${act}" data-d="-1" ${page <= 0 ? 'disabled' : ''}>‹</button><button class="btn sm" data-act="${act}" data-d="1" ${page >= pages - 1 ? 'disabled' : ''}>›</button></div>`;
  }
  const empty = (msg) => `<div class="empty">${msg}</div>`;

  // =====================================================================
  // DASHBOARD
  // =====================================================================
  function viewDashboard() {
    const main = $('#main');
    if (!S.comps.length) {
      main.innerHTML = `<h1>Dashboard</h1>${empty('Belum ada data. <br><br><button class="btn pri" data-view="upload">Upload hasil scrape pertama</button>')}`;
      return;
    }
    const D = compute();
    const T = D.T;
    const u = S.ui.dash;
    const k = (key, v, l, cls) => `<button class="kpi ${cls || ''} ${u.mov === key ? 'on' : ''}" data-act="mov" data-k="${key}"><div class="v">${num(v)}</div><div class="l">${l}</div></button>`;
    const okCount = D.groups.filter((g) => g.ok).length;
    main.innerHTML = `
      <h1>Dashboard</h1>
      <p class="sub">${S.comps.length} kompetitor · ${num(T.skus)} SKU terpantau · ${T.skus ? Math.round((T.matched / T.skus) * 100) : 0}% sudah ter-match ke katalog</p>
      <div class="kpis">
        ${k('baru', T.baru, 'SKU baru naik', 'new')}${k('naik', T.naik, 'Penjualan naik', 'up')}${k('turun', T.turun, 'Penjualan turun', 'down')}
        ${k('hargaNaik', T.hargaNaik, 'Harga naik')}${k('hargaTurun', T.hargaTurun, 'Harga turun')}${k('hilang', T.hilang, 'SKU hilang')}
        <div class="kpi"><div class="v">${num(okCount)}</div><div class="l">SKU layak dijual</div></div>
      </div>
      <div class="card" id="mov"></div>
      <div class="card">
        <h2>SKU yang oke untuk kita jual</h2>
        <p class="sub" style="margin-bottom:12px">Digabung dari semua kompetitor: SKU yang laku (stok tersedia), diurutkan dari penjualan terbesar × jumlah kompetitor yang menjualnya. Saran harga = <b id="stratLbl"></b> dari harga kompetitor yang laku.</p>
        <div class="bar">
          <input type="search" id="rq" class="grow" placeholder="Cari produk…" value="${esc(u.q)}">
          <select id="rtier"><option value="all">Semua tier</option>${S.tiers.map((t) => `<option ${u.tier === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          ${allCats().length ? `<select id="rcat"><option value="all">Semua kategori</option>${allCats().map((t) => `<option ${u.cat === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
          <select id="rmin">${[1, 2, 3].map((n) => `<option value="${n}" ${u.minSell == n ? 'selected' : ''}>≥ ${n} kompetitor menjual</option>`).join('')}</select>
          <label class="small"><input type="checkbox" id="rmatch" ${u.onlyMatched ? 'checked' : ''}> hanya yang ada di katalog</label>
          <button class="btn" data-act="export-reco">Export CSV</button>
        </div>
        <div id="reco"></div>
      </div>`;
    $('#stratLbl').textContent = { median: 'median', min: 'harga terendah', min1: 'terendah − 1%' }[S.settings.strategy];
    fillMov();
    fillReco();
    $('#rq').oninput = (e) => ((u.q = e.target.value), (u.page = 0), fillReco());
    $('#rtier').onchange = (e) => ((u.tier = e.target.value), (u.page = 0), fillReco());
    if ($('#rcat')) $('#rcat').onchange = (e) => ((u.cat = e.target.value), (u.page = 0), fillReco());
    $('#rmin').onchange = (e) => ((u.minSell = +e.target.value), (u.page = 0), fillReco());
    $('#rmatch').onchange = (e) => ((u.onlyMatched = e.target.checked), (u.page = 0), fillReco());
  }

  function movRows(key) {
    const D = compute();
    const rows = [];
    for (const comp of S.comps) {
      const a = D.A[comp.id];
      if (!a || !a.hasPrev) continue;
      if (key === 'hilang') a.gone.forEach((r) => rows.push({ comp, ...r }));
      else
        for (const r of a.rows) {
          if (key === 'hargaNaik' ? r.priceDelta > 0 : key === 'hargaTurun' ? r.priceDelta < 0 : r.status === key) rows.push({ comp, ...r });
        }
    }
    if (key === 'hargaNaik' || key === 'hargaTurun') rows.sort((a, b) => Math.abs(b.pricePct || 0) - Math.abs(a.pricePct || 0));
    else if (key === 'turun') rows.sort((a, b) => (a.prevRate - a.rate) * -1 + (b.prevRate - b.rate));
    else rows.sort((a, b) => (b.rate || 0) - (a.rate || 0));
    return rows;
  }
  function fillMov() {
    const u = S.ui.dash;
    const D = compute();
    const titles = { baru: 'SKU baru naik', naik: 'Penjualan naik', turun: 'Penjualan turun', hargaNaik: 'Harga naik', hargaTurun: 'Harga turun', hilang: 'SKU hilang dari katalog kompetitor' };
    const box = $('#mov');
    if (!D.T.hasPrev) {
      box.innerHTML = `<h2>Perubahan terbaru</h2>${empty('Baru ada 1 hasil scrape per kompetitor. Upload scrape berikutnya untuk melihat SKU baru, tren penjualan, dan perubahan harga.')}`;
      return;
    }
    const rows = movRows(u.mov);
    box.innerHTML = `<h2>${titles[u.mov]} <span class="muted small">(${num(rows.length)})</span></h2>` +
      (rows.length
        ? `<div class="tbl"><table><thead><tr><th>Kompetitor</th><th>Produk</th><th class="n">Harga</th><th class="n">Δ Harga</th><th class="n">Terjual</th><th>Status</th></tr></thead><tbody>${rows
            .slice(0, 15)
            .map(
              (r) => `<tr><td>${esc(r.comp.name)}<br>${tierChip(r.comp.tier)} ${catChip(r.comp.cat)}</td><td><div class="nm">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</div></td><td class="n">${rp(r.price)}</td><td class="n">${pcell(r)}</td><td class="n">${salesCell(r)}</td><td>${chip(r.status)}</td></tr>`
            )
            .join('')}</tbody></table></div>${rows.length > 15 ? `<p class="small muted">Menampilkan 15 teratas. <a href="#" data-act="goto-k" data-s="${u.mov}">Lihat semua di halaman Kompetitor</a></p>` : ''}`
        : empty('Tidak ada.'));
  }

  function recoRows() {
    const u = S.ui.dash;
    const q = u.q.trim().toLowerCase();
    return compute().groups.filter((g) => {
      if (!g.ok) return false;
      if (g.nSellers < u.minSell && !(u.minSell === 1 && g.nSellers === 0)) return false;
      if (u.onlyMatched && !g.match) return false;
      if (u.tier !== 'all' && !g.offers.some((o) => o.comp.tier === u.tier)) return false;
      if (u.cat !== 'all' && !g.offers.some((o) => o.comp.cat === u.cat)) return false;
      if (q && !(g.name.toLowerCase().includes(q) || (g.match && String(g.match.id).includes(q)))) return false;
      return true;
    });
  }
  function fillReco() {
    const u = S.ui.dash;
    const rows = recoRows();
    S.recoView = rows;
    const slice = rows.slice(u.page * PAGE, u.page * PAGE + PAGE);
    $('#reco').innerHTML = rows.length
      ? `<div class="tbl"><table><thead><tr><th class="n">#</th><th>Produk</th><th>Kompetitor</th><th class="n">Penjualan</th><th class="n">Harga pasar<br><span style="text-transform:none">min · median · maks</span></th><th class="n">Saran harga</th><th class="n">Margin</th></tr></thead><tbody>${slice
          .map((g, i) => {
            const sellers = g.offers.filter((o) => o.rate != null ? o.rate > 0 : o.sold > 0);
            return `<tr data-act="grp" data-i="${u.page * PAGE + i}" style="cursor:pointer"><td class="n muted">${u.page * PAGE + i + 1}</td>
              <td><div class="nm"><b>${esc(g.name)}</b></div><div class="sm2">${g.match ? `ID ${esc(g.match.id)} · ${Math.round((g.match.score || 0) * 100)}% match` : '<span class="chip down">belum ada di katalog</span>'} ${g.hasNaik ? '<span class="chip up">naik</span>' : ''} ${g.hasBaru ? '<span class="chip new">baru</span>' : ''}</div></td>
              <td>${g.nSellers}/${g.nCarriers} menjual<br>${g.tiers.map(tierChip).join(' ')}</td>
              <td class="n">${g.monthly ? num(g.rate * 30) + '/bln' : g.hasRate ? num(g.rate) + '/hari' : '<span class="muted">' + num(g.soldTotal) + ' total</span>'}<div class="sm2">${!g.monthly && sellers.length ? num(g.soldTotal) + ' total' : ''}</div></td>
              <td class="n">${rp(g.min)}<div class="sm2">${rp(g.med)} · ${rp(g.max)}</div></td>
              <td class="n"><b style="font-size:1.05rem;color:var(--accent)">${rp(g.suggest)}</b></td>
              <td class="n">${g.margin == null ? '<span class="muted">–</span>' : `<span class="pc ${g.margin < 5 ? 'up' : 'dn'}">${g.margin.toFixed(1)}%</span>`}</td></tr>`;
          })
          .join('')}</tbody></table></div>${pager(rows.length, u.page, 'rpage')}`
      : empty('Belum ada SKU yang memenuhi filter. Pastikan data jual (terjual/stok) ada di scrape.');
  }

  function groupModal(g) {
    modal(`<h2>${esc(g.name)}</h2><p class="sub">${g.match ? `Katalog ID ${esc(g.match.id)}` : 'Belum ada di katalog kita'} · saran harga <b>${rp(g.suggest)}</b>${g.cost ? ` · HPP ${rp(g.cost)}` : ''}</p>
      <div class="tbl"><table><thead><tr><th>Kompetitor</th><th>Nama di toko</th><th class="n">Harga</th><th class="n">Stok</th><th class="n">Terjual</th><th>Status</th></tr></thead><tbody>${g.offers
        .slice()
        .sort((a, b) => (a.price ?? 1e15) - (b.price ?? 1e15))
        .map((o) => `<tr><td>${esc(o.comp.name)}<br>${tierChip(o.comp.tier)} ${catChip(o.comp.cat)}</td><td><div class="nm">${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.name)}</a>` : esc(o.name)}</div></td><td class="n">${rp(o.price)}<br>${pcell(o)}</td><td class="n">${num(o.stock)}</td><td class="n">${salesCell(o)}</td><td>${chip(o.status)}</td></tr>`)
        .join('')}</tbody></table></div><div class="bar" style="margin-top:14px"><span class="grow"></span><button class="btn" data-act="close">Tutup</button></div>`);
  }

  // =====================================================================
  // KOMPETITOR
  // =====================================================================
  const FILTERS = [['all', 'Semua'], ['baru', 'Baru'], ['naik', 'Penjualan naik'], ['turun', 'Penjualan turun'], ['laku', 'Laku'], ['stagnan', 'Stagnan'], ['hargaNaik', 'Harga naik'], ['hargaTurun', 'Harga turun'], ['hilang', 'Hilang']];

  function viewKomp() {
    const main = $('#main');
    const u = S.ui.k;
    if (!S.comps.length) return (main.innerHTML = `<h1>Kompetitor</h1>${empty('Belum ada kompetitor. <br><br><button class="btn pri" data-view="upload">Upload scrape</button>')}`);
    if (u.comp !== 'all' && !compById(u.comp)) u.comp = 'all';
    const grp = u.group || (S.comps.some((c) => c.cat) ? 'cat' : 'tier');
    const keyOf = grp === 'cat' ? (c) => c.cat || '' : (c) => c.tier;
    const order = grp === 'cat' ? [...allCats(), ''] : S.tiers.concat(S.comps.map((c) => c.tier).filter((t) => !S.tiers.includes(t)));
    const side = order
      .map((t) => {
        const cs = S.comps.filter((c) => keyOf(c) === t);
        if (!cs.length) return '';
        return `<h4>${esc(t || 'Tanpa kategori')}</h4>` + cs.map((c) => `<button class="${u.comp === c.id ? 'on' : ''}" data-act="pick-comp" data-id="${c.id}"><span>${esc(c.name)}</span><span class="muted small">${lastSnap(c.id) ? num(lastSnap(c.id).items.length) : 0}</span></button>`).join('');
      })
      .join('');
    const seg = `<div class="seg" role="group" aria-label="Kelompokkan menurut">${[['cat', 'Kategori'], ['tier', 'Tier']].map(([g, l]) => `<button class="${grp === g ? 'on' : ''}" data-act="kgroup" data-g="${g}">${l}</button>`).join('')}</div>`;
    main.innerHTML = `<h1>Kompetitor</h1><p class="sub">Buka satu kompetitor atau lihat semuanya sekaligus.</p>
      <div class="split"><aside class="side">${seg}<button class="${u.comp === 'all' ? 'on' : ''}" data-act="pick-comp" data-id="all"><span><b>Semua kompetitor</b></span><span class="muted small">${S.comps.length}</span></button>${side}</aside><section id="kmain"></section></div>`;
    fillKomp();
  }

  function kompData() {
    const u = S.ui.k;
    let rows = [],
      gone = [],
      meta = null;
    if (u.comp === 'all') {
      for (const c of S.comps) {
        const a = compute().A[c.id];
        if (!a) continue;
        rows.push(...a.rows.map((r) => ({ comp: c, ...r })));
        gone.push(...a.gone.map((r) => ({ comp: c, ...r })));
      }
    } else {
      const c = compById(u.comp);
      const sn = S.snaps[c.id] || [];
      let idx = sn.length - 1;
      if (u.snap != null && u.snap < sn.length && u.snapComp === c.id) idx = u.snap;
      const a = KS.analyzeComp(sn, idx, cfg());
      rows = a.rows.map((r) => ({ comp: c, ...r }));
      gone = a.gone.map((r) => ({ comp: c, ...r }));
      meta = { c, sn, idx, a };
    }
    return { rows, gone, meta };
  }

  function fillKomp() {
    const u = S.ui.k;
    const { rows, gone, meta } = kompData();
    const cnt = (f) => (f === 'all' ? rows.length : f === 'hilang' ? gone.length : f === 'hargaNaik' ? rows.filter((r) => r.priceDelta > 0).length : f === 'hargaTurun' ? rows.filter((r) => r.priceDelta < 0).length : rows.filter((r) => r.status === f).length);
    const head = meta
      ? `<div class="bar"><h2 style="margin:0">${esc(meta.c.name)}</h2>${tierChip(meta.c.tier)} ${catChip(meta.c.cat)}<span class="grow"></span>
          <label class="small muted">Kategori <select id="kcat">${catOpts(meta.c.cat, '<option value="__new">+ Kategori baru…</option>')}</select></label>
          <label class="small muted">Snapshot <select id="ksnap">${meta.sn.map((s, i) => `<option value="${i}" ${i === meta.idx ? 'selected' : ''}>${fmtDate(s.date)} · ${num(s.items.length)} SKU</option>`).join('')}</select></label>
          <button class="btn sm" data-act="backup-comp" data-id="${meta.c.id}" title="Simpan seluruh riwayat toko ini ke file JSON">Backup toko ini</button>
          <label class="btn sm" title="Pulihkan dari file backup JSON (digabung, tidak menimpa)">Restore<input type="file" id="rfile2" accept=".json" hidden></label>
          <button class="btn sm danger" data-act="del-snap">Hapus snapshot</button></div>`
      : `<div class="bar"><h2 style="margin:0">Semua kompetitor</h2><span class="muted small">snapshot terakhir tiap toko</span></div>`;
    $('#kmain').innerHTML = `${head}
      <div class="tabs">${FILTERS.map(([f, l]) => `<button class="${u.status === f ? 'on' : ''}" data-act="kfilter" data-f="${f}">${l} ${cnt(f)}</button>`).join('')}</div>
      <div class="bar"><input type="search" id="kq" class="grow" placeholder="Cari nama / SKU…" value="${esc(u.q)}"><button class="btn" data-act="export-k">Export CSV</button></div>
      <div id="ktbl"></div>`;
    $('#kq').oninput = (e) => ((u.q = e.target.value), (u.page = 0), fillKTable());
    const sel = $('#ksnap');
    const kc = $('#kcat');
    if (kc)
      kc.onchange = (e) => {
        let v = e.target.value;
        if (v === '__new') v = askNewCat() ?? meta.c.cat ?? '';
        compById(meta.c.id).cat = v;
        dirty();
        viewKomp();
      };
    if (sel) sel.onchange = (e) => ((u.snap = +e.target.value), (u.snapComp = meta.c.id), (u.page = 0), fillKomp());
    const rf2 = $('#rfile2');
    if (rf2) rf2.onchange = restoreBackup;
    fillKTable();
  }

  function kFiltered() {
    const u = S.ui.k;
    const { rows, gone } = kompData();
    let list = u.status === 'hilang' ? gone : rows;
    if (u.status === 'hargaNaik') list = rows.filter((r) => r.priceDelta > 0);
    else if (u.status === 'hargaTurun') list = rows.filter((r) => r.priceDelta < 0);
    else if (!['all', 'hilang'].includes(u.status)) list = rows.filter((r) => r.status === u.status);
    const q = u.q.trim().toLowerCase();
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q) || String(r.k).toLowerCase().includes(q));
    const key = { name: (r) => r.name.toLowerCase(), price: (r) => r.price ?? -1, delta: (r) => Math.abs(r.pricePct || 0), stock: (r) => r.stock ?? -1, sold: (r) => r.sold ?? -1, rate: (r) => r.rate ?? -1, comp: (r) => r.comp.name, status: (r) => r.status }[u.sort] || ((r) => r.name);
    return list.slice().sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * u.dir);
  }

  function fillKTable() {
    const u = S.ui.k;
    const list = kFiltered();
    S.kView = list;
    const all = u.comp === 'all';
    const th = (k, l, cls) => `<th class="${cls || ''}" data-act="ksort" data-k="${k}">${l}${u.sort === k ? (u.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    const slice = list.slice(u.page * PAGE, u.page * PAGE + PAGE);
    $('#ktbl').innerHTML = list.length
      ? `<div class="tbl"><table><thead><tr>${all ? th('comp', 'Kompetitor') : ''}${th('name', 'Produk')}${th('status', 'Status')}${th('price', 'Harga', 'n')}${th('delta', 'Δ Harga', 'n')}${th('stock', 'Stok', 'n')}${th('sold', 'Terjual (kolom scrape)', 'n')}${th('rate', 'Penjualan / tren', 'n')}<th class="nosort">Match katalog</th></tr></thead><tbody>${slice
          .map((r) => {
            const m = S.matchOf(r.comp.id, r.k, r.name);
            return `<tr>${all ? `<td>${esc(r.comp.name)}<br>${tierChip(r.comp.tier)} ${catChip(r.comp.cat)}</td>` : ''}<td><div class="nm">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</div><div class="sm2">${r.nv ? r.nv + ' varian' + (r.pmax && r.pmax !== r.price ? ' · harga ' + rp(r.price) + '–' + rp(r.pmax) : '') + ' · ' : ''}${esc(String(r.k).slice(0, 60))}</div></td><td>${chip(r.status)}</td><td class="n">${rp(r.price)}</td><td class="n">${pcell(r)}</td><td class="n">${num(r.stock)}</td><td class="n">${num(r.sold)}</td><td class="n">${salesCell(r)}</td><td class="small">${m ? `<span class="score ${m.score >= 0.75 ? 'hi' : 'md'}">${Math.round(m.score * 100)}%</span>${esc(m.name)}` : '<span class="muted">–</span>'}</td></tr>`;
          })
          .join('')}</tbody></table></div>${pager(list.length, u.page, 'kpage')}`
      : empty('Tidak ada data untuk filter ini.');
  }

  // =====================================================================
  // UPLOAD
  // =====================================================================
  function viewUpload() {
    const main = $('#main');
    main.innerHTML = `<h1>Upload Scrape</h1><p class="sub">Upload hasil scraper (.xlsx / .csv / .json). Setiap file = satu kompetitor. Data tersimpan di browser, dibandingkan dengan scrape sebelumnya, lalu dikirim ke Google Sheets.</p>
      <label class="drop" id="drop">Tarik file hasil scrape ke sini, atau klik untuk memilih<br><span class="small">.xlsx, .csv, atau .json — bisa pilih beberapa file sekaligus</span><input type="file" id="fin" accept=".json,.jsonl,.xlsx,.csv,application/json" multiple hidden></label>
      <div id="pend"></div><div id="res"></div>`;
    const drop = $('#drop');
    const fin = $('#fin');
    fin.onchange = () => addFiles(fin.files);
    ['dragover', 'dragenter'].forEach((e) => drop.addEventListener(e, (ev) => (ev.preventDefault(), drop.classList.add('over'))));
    ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => (ev.preventDefault(), drop.classList.remove('over'))));
    drop.addEventListener('drop', (ev) => addFiles(ev.dataTransfer.files));
    fillPending();
    fillResult();
  }

  const toLocalInput = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  function guessTier(txt) {
    const n = KS.normName(txt).replace(/ /g, '');
    return S.tiers.find((t) => n.includes(KS.normName(t).replace(/ /g, '').slice(0, 5))) || S.tiers[0];
  }

  async function addFiles(files) {
    for (const f of Array.from(files)) {
      try {
        const info = await KS.readJSONFile(f);
        const base = KS.normName(f.name.replace(/\.[^.]+$/, '').replace(/[_-]?\d{4}[-_]?\d{2}[-_]?\d{2}.*$/, ''));
        const hint = KS.normName(info.competitorHint || '');
        let comp = S.comps.find((c) => KS.normName(c.name) === hint) || S.comps.find((c) => base && (base.includes(KS.normName(c.name)) || KS.normName(c.name).includes(base)));
        S.pending.push({ id: KS.uid(), info, compId: comp ? comp.id : '__new', newName: info.competitorHint || f.name.replace(/\.[^.]+$/, '').replace(/[_-]?\d{4}[-_]?\d{2}[-_]?\d{2}.*$/, '').replace(/[_-]+/g, ' ').trim(), newTier: guessTier(info.competitorHint || f.name), merge: info.hasVariant, soldMode: info.soldMode, date: info.date });
      } catch (e) {
        toast(`${f.name}: tidak bisa dibaca (${e.message})`, true);
      }
    }
    fillPending();
  }

  function fillPending() {
    const box = $('#pend');
    if (!box) return;
    if (!S.pending.length) return (box.innerHTML = '');
    box.innerHTML =
      S.pending
        .map((p) => {
          const n = KS.normalizeItems(p.info.raw, p.info.mapping, { merge: p.merge }).length;
          const opts = S.comps.map((c) => `<option value="${c.id}" ${p.compId === c.id ? 'selected' : ''}>${esc(c.name)} — ${esc(c.tier)}</option>`).join('');
          const mapSel = KS.FIELDS.map(
            (f) => `<label class="fld">${KS.FIELD_LABEL[f]}<select data-pmap="${p.id}" data-f="${f}"><option value="">— tidak ada —</option>${p.info.keys.map((k) => `<option ${p.info.mapping[f] === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>`
          ).join('');
          return `<div class="file" data-pid="${p.id}"><div class="bar"><b>${esc(p.info.fileName)}</b><span class="muted small" data-cnt>${num(n)} produk terbaca dari ${num(p.info.raw.length)} baris</span><span class="grow"></span><button class="btn sm" data-act="pend-del" data-id="${p.id}">Buang</button></div>
            <div class="row"><label class="fld">Kompetitor<select data-pcomp="${p.id}">${opts}<option value="__new" ${p.compId === '__new' ? 'selected' : ''}>+ Kompetitor baru…</option></select></label>
            ${p.compId === '__new' ? `<label class="fld">Nama baru<input type="text" data-pname="${p.id}" value="${esc(p.newName)}"></label><label class="fld">Kategori<select data-pcat="${p.id}">${catOpts(p.newCat, '<option value="__new">+ Kategori baru…</option>')}</select></label><label class="fld">Tier<select data-ptier="${p.id}">${S.tiers.map((t) => `<option ${p.newTier === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : ''}
            <label class="fld">Tanggal scrape<input type="datetime-local" data-pdate="${p.id}" value="${toLocalInput(p.date)}"></label></div>
            <div class="row"><label class="fld">Kolom terjual berarti<select data-psold="${p.id}"><option value="monthly" ${p.soldMode === 'monthly' ? 'selected' : ''}>Penjualan per bulan (30 hari terakhir)</option><option value="cumulative" ${p.soldMode === 'cumulative' ? 'selected' : ''}>Total kumulatif sejak awal</option></select></label>
            ${p.info.mapping.variant ? `<label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-pmerge="${p.id}" ${p.merge ? 'checked' : ''}> Gabung varian jadi 1 produk (harga = varian tersedia termurah)</label>` : ''}</div>
            <details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Pemetaan kolom (terdeteksi otomatis)</summary><div class="row">${mapSel}</div></details></div>`;
        })
        .join('') + `<div class="bar" style="margin-top:14px"><button class="btn pri" id="goProc" data-act="process">Proses &amp; simpan ${S.pending.length} file</button><label class="small"><input type="checkbox" id="autosync" ${S.settings.autoSync ? 'checked' : ''}> kirim otomatis ke Google Sheets</label></div><div id="procProg"></div>`;
  }

  async function processPending() {
    const btn = $('#goProc');
    if (btn) btn.disabled = true;
    const results = [];
    S.settings.autoSync = $('#autosync') ? $('#autosync').checked : S.settings.autoSync;
    const prog = (t, p) => ($('#procProg').innerHTML = `<div class="small muted">${esc(t)}</div><div class="prog"><i style="width:${Math.round(p * 100)}%"></i></div>`);
    try {
      for (const p of S.pending.slice()) {
        let comp = compById(p.compId);
        if (!comp) {
          const name = (p.newName || '').trim();
          if (!name) throw new Error('Nama kompetitor baru belum diisi.');
          comp = S.comps.find((c) => c.name.toLowerCase() === name.toLowerCase());
          if (!comp) {
            comp = { id: KS.slug(name) + '-' + KS.uid().slice(0, 3), name, tier: p.newTier, cat: p.newCat || '' };
            S.comps.push(comp);
          }
        }
        const items = KS.normalizeItems(p.info.raw, p.info.mapping, { merge: p.merge });
        if (!items.length) throw new Error(`${p.info.fileName}: tidak ada produk terbaca — cek pemetaan kolom Nama.`);
        const date = new Date(p.date).toISOString();
        const snap = { id: comp.id + '|' + date, compId: comp.id, date, file: p.info.fileName, soldMode: p.soldMode, items };
        const arr = (S.snaps[comp.id] = (S.snaps[comp.id] || []).filter((s) => s.id !== snap.id));
        arr.push(snap);
        arr.sort((a, b) => a.date.localeCompare(b.date));
        await KS.db.snapPut(snap);
        S.dirty = true;
        results.push({ comp, snap, idx: arr.indexOf(snap) });
        S.pending = S.pending.filter((x) => x.id !== p.id);
      }
      persist();
      prog('Mencocokkan SKU ke katalog…', 0.3);
      await ensureSugg((x) => prog('Mencocokkan SKU ke katalog…', 0.3 + x * 0.4));
      S.dirty = true;
      const out = [];
      for (const r of results) {
        const a = KS.analyzeComp(S.snaps[r.comp.id], r.idx, cfg());
        const o = { comp: r.comp, snaps: S.snaps[r.comp.id], idx: r.idx, a, s: KS.summarize(a), sync: null };
        if (S.settings.autoSync && S.settings.apiUrl) {
          try {
            setSync('busy', 'Mengirim…');
            await KS.sync.pushSnapshot(S, r.comp, S.snaps[r.comp.id], r.idx, a, (x) => prog(`Mengirim ${r.comp.name} ke Google Sheets…`, 0.7 + x * 0.3));
            o.sync = 'ok';
            setSync('ok', 'Tersinkron ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
          } catch (e) {
            o.sync = e.message;
            setSync('err', 'Gagal sinkron');
          }
        }
        out.push(o);
      }
      S.lastResult = out;
      $('#procProg').innerHTML = '';
      fillPending();
      fillResult();
      toast(`${out.length} file diproses`);
    } catch (e) {
      toast(e.message, true);
      if (btn) btn.disabled = false;
      $('#procProg').innerHTML = '';
      fillPending();
    }
  }

  function fillResult() {
    const box = $('#res');
    if (!box || !S.lastResult) return;
    box.innerHTML = `<h2 style="margin-top:24px">Hasil upload</h2>` + S.lastResult.map((o) => {
      const s = o.s;
      const a = o.a;
      const top = (st, n = 5) => a.rows.filter((r) => r.status === st).sort((x, y) => (y.rate || 0) - (x.rate || 0)).slice(0, n);
      const pr = a.rows.filter((r) => r.priceDelta != null).sort((x, y) => Math.abs(y.pricePct || 0) - Math.abs(x.pricePct || 0)).slice(0, 5);
      const list = (rows, f) => (rows.length ? `<ul class="small" style="margin:6px 0 0;padding-left:18px">${rows.map((r) => `<li>${esc(r.name.slice(0, 70))} — ${f(r)}</li>`).join('')}</ul>` : '');
      return `<div class="card"><div class="bar"><h2 style="margin:0">${esc(o.comp.name)}</h2>${tierChip(o.comp.tier)} ${catChip(o.comp.cat)}<span class="muted small">${fmtDate(a.date)}${a.hasPrev ? ' vs ' + fmtDate(a.prevDate) : ''}</span><span class="grow"></span>${o.sync === 'ok' ? '<span class="chip up">Tersimpan di Google Sheets</span>' : o.sync ? `<span class="chip down" title="${esc(o.sync)}">Gagal kirim ke Sheets</span> <button class="btn sm" data-act="retry-sync" data-id="${o.comp.id}">Coba lagi</button>` : `<span class="chip">Hanya lokal</span>`}</div>
        ${a.hasPrev ? `<div class="kpis" style="margin:12px 0 4px"><div class="kpi new"><div class="v">${s.baru}</div><div class="l">SKU baru</div></div><div class="kpi up"><div class="v">${s.naik}</div><div class="l">Penjualan naik</div></div><div class="kpi down"><div class="v">${s.turun}</div><div class="l">Penjualan turun</div></div><div class="kpi"><div class="v">${s.hargaNaik}</div><div class="l">Harga naik</div></div><div class="kpi"><div class="v">${s.hargaTurun}</div><div class="l">Harga turun</div></div><div class="kpi"><div class="v">${s.hilang}</div><div class="l">Hilang</div></div></div>
        <div class="grid2"><div><h3>Penjualan naik teratas</h3>${list(top('naik'), (r) => `${num(r.sales)} terjual (${num(r.rate)}/hari)`) || '<span class="muted small">–</span>'}</div><div><h3>Perubahan harga terbesar</h3>${list(pr, (r) => `${rp(r.prevPrice)} → ${rp(r.price)} (${r.pricePct > 0 ? '+' : ''}${r.pricePct.toFixed(1)}%)`) || '<span class="muted small">–</span>'}</div></div>`
          : `<p class="muted" style="margin:10px 0 0">Ini scrape pertama untuk kompetitor ini (${num(s.total)} SKU) — dijadikan baseline. Upload scrape berikutnya untuk melihat perubahan.</p>`}
        <div class="bar" style="margin-top:12px"><button class="btn sm" data-act="goto-comp" data-id="${o.comp.id}">Buka di Kompetitor</button></div></div>`;
    }).join('');
  }

  // =====================================================================
  // MATCHER
  // =====================================================================
  function matcherItems() {
    const u = S.ui.m;
    const q = u.q.trim().toLowerCase();
    const list = [];
    for (const c of S.comps) {
      if (u.comp !== 'all' && u.comp !== c.id) continue;
      const l = lastSnap(c.id);
      if (!l) continue;
      for (const it of l.items) {
        const key = c.id + '|' + it.k;
        const e = S.matches[key];
        const sg = S.sugg[key] || [];
        const top = sg[0] ? sg[0].score : 0;
        let st = e && !e.none ? 'matched' : e && e.none ? 'none' : top >= KS.THRESH.review ? 'review' : 'none';
        if (u.filter !== st) continue;
        if (q && !it.name.toLowerCase().includes(q)) continue;
        list.push({ comp: c, it, key, e, sg, top });
      }
    }
    if (u.filter === 'review') list.sort((a, b) => b.top - a.top);
    return list;
  }

  function viewMatcher() {
    const main = $('#main');
    const u = S.ui.m;
    main.innerHTML = `<h1>SKU Matcher</h1><p class="sub">Cocokkan nama produk kompetitor ke katalog kita. Nama dibaca per bagian (merek, tipe, warna, ukuran/kapasitas) dan satuan disamakan, misalnya 120mm = 12CM. Warna atau ukuran yang berbeda tidak akan disetujui otomatis. Boleh punya beberapa sumber katalog (mis. Drive/Sheet yang berbeda) — pencocokan memakai semuanya.</p>
      <div class="card"><h2>Sumber katalog</h2><div id="cats"></div>
        <div class="bar" style="margin-top:12px"><input type="text" id="cname" placeholder="Nama sumber (mis. Katalog Gudang B)"><label class="btn">+ Tambah CSV<input type="file" id="cfile" accept=".csv,.tsv,text/csv" hidden></label><span class="help">CSV dengan kolom <code>id</code>, <code>name</code>; opsional <code>hpp</code>/<code>modal</code> untuk hitung margin.</span></div></div>
      <div id="mprog"></div>
      <div class="card"><div class="bar"><h2 style="margin:0" class="grow">Antrian pencocokan</h2><button class="btn" data-act="rematch" title="Hitung ulang match otomatis; match manual tetap">Hitung ulang otomatis</button><button class="btn" data-act="rematch-all" title="Hitung ulang SEMUA, termasuk match manual">Match ulang semua</button><button class="btn danger" data-act="clear-matches" title="Hapus semua data match">Hapus semua match</button><button class="btn pri" data-act="bulk-ok">Setujui semua saran ≥ <span id="bulkpct">60</span>%</button></div>
        <div class="tabs" id="mtabs"></div>
        <div class="bar"><input type="search" id="mq" class="grow" placeholder="Cari nama produk kompetitor…" value="${esc(u.q)}"><select id="mcomp"><option value="all">Semua kompetitor</option>${S.comps.map((c) => `<option value="${c.id}" ${u.comp === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><input type="number" id="bulkin" min="40" max="100" value="60" style="width:70px" title="Ambang persetujuan massal (%)"></div>
        <div id="mtbl"></div></div>`;
    fillCats();
    $('#cfile').onchange = addCatalog;
    $('#mq').oninput = (e) => ((u.q = e.target.value), (u.page = 0), fillMatcher());
    $('#mcomp').onchange = (e) => ((u.comp = e.target.value), (u.page = 0), fillMatcher());
    $('#bulkin').oninput = (e) => ($('#bulkpct').textContent = e.target.value);
    runSuggUI();
  }

  async function runSuggUI(force) {
    const box = $('#mprog');
    if (box) box.innerHTML = `<div class="small muted">Menghitung saran match…</div><div class="prog"><i></i></div>`;
    await ensureSugg((p) => {
      const i = $('#mprog i');
      if (i) i.style.width = Math.round(p * 100) + '%';
    }, force);
    if (S.view !== 'matcher') return;
    if ($('#mprog')) $('#mprog').innerHTML = '';
    fillMatcher();
  }

  function fillCats() {
    const box = $('#cats');
    if (!box) return;
    box.innerHTML = S.catalogs.length
      ? `<div class="tbl"><table><thead><tr><th>Nama</th><th class="n">SKU</th><th class="n">Ada HPP</th><th>Aktif</th><th></th></tr></thead><tbody>${S.catalogs.map((c) => `<tr><td>${esc(c.name)}</td><td class="n">${num(c.rows.length)}</td><td class="n">${num(c.rows.filter((r) => r[2]).length)}</td><td><input type="checkbox" data-act="cat-toggle" data-id="${c.id}" ${c.enabled ? 'checked' : ''}></td><td><button class="btn sm danger" data-act="cat-del" data-id="${c.id}">Hapus</button></td></tr>`).join('')}</tbody></table></div>`
      : empty('Belum ada katalog. Tambahkan CSV katalog Anda.');
  }

  async function addCatalog(e) {
    const f = e.target.files[0];
    if (!f) return;
    const rows = KS.parseCatalog(await f.text());
    if (!rows.length) return toast('CSV tidak terbaca (butuh kolom id,name).', true);
    const name = ($('#cname').value || f.name.replace(/\.[^.]+$/, '')).trim();
    const c = { id: 'cat-' + KS.uid(), name, rows, enabled: true };
    S.catalogs.push(c);
    await KS.db.catPut(c);
    await afterCatalogChange();
    toast(`${num(rows.length)} SKU ditambahkan ke "${name}"`);
  }
  async function afterCatalogChange() {
    fillCats();
    $('#mprog') && ($('#mprog').innerHTML = `<div class="small muted">Membangun index katalog…</div><div class="prog"><i></i></div>`);
    await rebuildIndexes((p) => {
      const i = $('#mprog i');
      if (i) i.style.width = Math.round(p * 100) + '%';
    });
    // hapus match otomatis yang katalognya hilang / nonaktif
    for (const [k, v] of Object.entries(S.matches)) if (!v.none && !v.manual && !S.catMap[v.src]) delete S.matches[k];
    dirty();
    if (S.view === 'matcher') await runSuggUI();
  }

  function fillMatcher() {
    const u = S.ui.m;
    const counts = { matched: 0, review: 0, none: 0 };
    const keepF = u.filter,
      keepQ = u.q;
    u.q = '';
    for (const f of ['matched', 'review', 'none']) (u.filter = f), (counts[f] = matcherItems().length);
    u.filter = keepF;
    u.q = keepQ;
    $('#mtabs').innerHTML = [['review', 'Perlu review'], ['none', 'Tidak ketemu'], ['matched', 'Sudah match']].map(([f, l]) => `<button class="${u.filter === f ? 'on' : ''}" data-act="mfilter" data-f="${f}">${l} ${num(counts[f])}</button>`).join('');
    const list = matcherItems();
    S.mView = list;
    const slice = list.slice(u.page * PAGE, u.page * PAGE + PAGE);
    $('#mtbl').innerHTML = list.length
      ? `<div class="tbl"><table><thead><tr><th>Kompetitor</th><th>Produk kompetitor</th><th>${u.filter === 'matched' ? 'Match di katalog' : 'Saran dari katalog'}</th><th></th></tr></thead><tbody>${slice
          .map((r, i) => {
            const gi = u.page * PAGE + i;
            let mid;
            if (r.e && !r.e.none) {
              const m = S.matchOf(r.comp.id, r.it.k);
              mid = m ? `<span class="score ${m.score >= 0.75 ? 'hi' : 'md'}">${r.e.manual ? '✓' : Math.round(m.score * 100) + '%'}</span>${esc(m.name)} <span class="muted small">ID ${esc(m.id)}</span>` : '<span class="muted">katalog tidak aktif</span>';
            } else if (r.e && r.e.none) mid = '<span class="muted">Ditandai: bukan produk kita</span>';
            else
              mid = `<div class="sugg">${r.sg
                .map((s, j) => `<button data-act="pick" data-i="${gi}" data-j="${j}"><span class="score ${s.score >= 0.75 ? 'hi' : s.score >= 0.5 ? 'md' : 'lo'}">${Math.round(s.score * 100)}%</span>${esc(s.name)} <span class="muted">· ID ${esc(s.id)}${S.indexes.length > 1 ? ' · ' + esc(s.srcName) : ''}</span>${whyChips(s.why)}</button>`)
                .join('') || '<span class="muted small">Tidak ada kandidat</span>'}</div>`;
            return `<tr><td>${esc(r.comp.name)}</td><td><div class="nm">${esc(r.it.name)}</div><div class="sm2">${rp(r.it.price)} · ${esc(r.it.k)}</div>${attrLine(r.it.name)}</td><td>${mid}</td><td style="white-space:nowrap"><button class="btn sm" data-act="msearch" data-i="${gi}">Cari…</button> ${r.e ? `<button class="btn sm" data-act="unmatch" data-i="${gi}">Lepas</button>` : `<button class="btn sm" data-act="mnone" data-i="${gi}">Bukan produk kita</button>`}</td></tr>`;
          })
          .join('')}</tbody></table></div>${pager(list.length, u.page, 'mpage')}`
      : empty(S.indexes.length ? 'Tidak ada item di kategori ini.' : 'Tambahkan / aktifkan katalog dulu.');
  }

  function searchModal(gi) {
    const r = S.mView[gi];
    modal(`<h2>Cari di katalog</h2><p class="sub" style="margin-bottom:6px">${esc(r.it.name)}</p>${attrLine(r.it.name)}<div style="height:12px"></div><input type="search" id="sq" style="width:100%" value="${esc(r.it.name)}" autofocus><div id="sres" style="margin-top:12px"></div><div class="bar" style="margin-top:14px"><span class="grow"></span><button class="btn" data-act="close">Tutup</button></div>`);
    const go = () => {
      const c = KS.matchAll(S.indexes, $('#sq').value, 8);
      $('#sres').innerHTML = `<div class="sugg">${c.map((s, j) => `<button data-act="pick-search" data-gi="${gi}" data-j="${j}"><span class="score ${s.score >= 0.75 ? 'hi' : 'md'}">${Math.round(s.score * 100)}%</span>${esc(s.name)} <span class="muted">· ID ${esc(s.id)} · ${esc(s.srcName)}</span>${whyChips(s.why)}</button>`).join('') || '<span class="muted">Tidak ada hasil</span>'}</div>`;
      S._sres = c;
    };
    $('#sq').oninput = go;
    go();
  }

  function setMatch(r, s, manual) {
    S.matches[r.key] = { src: s.src, id: s.id, score: +s.score.toFixed(3), manual: !!manual };
    dirty();
  }

  // =====================================================================
  // SETTINGS
  // =====================================================================
  function viewSettings() {
    const st = S.settings;
    $('#main').innerHTML = `<h1>Pengaturan</h1><p class="sub">Sambungan Google Sheets, aturan harga, dan kelola kompetitor.</p>
      <div class="grid2">
      <div class="card"><h2>Google Sheets</h2>
        <p class="help">Web ini statis (GitHub Pages) sehingga menulis ke Sheet lewat Google Apps Script. Langkah: buka Sheet → Extensions → Apps Script → tempel isi <code>apps-script/Code.gs</code> → Deploy → Web app (Execute as: Me, Access: Anyone) → salin URL <code>/exec</code> ke bawah.</p>
        <label class="fld">URL Web App Apps Script<input type="url" id="sapi" value="${esc(st.apiUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></label><br>
        <label class="fld">Token rahasia (sama dengan TOKEN di Code.gs, opsional)<input type="password" id="stoken" value="${esc(st.token)}"></label>
        <div class="bar" style="margin-top:12px"><button class="btn pri" data-act="save-api">Simpan &amp; tes koneksi</button><button class="btn" data-act="pull">Tarik data dari Sheets</button><button class="btn" data-act="push-all">Kirim ulang semua</button></div></div>
      <div class="card"><h2>Aturan analisis &amp; harga</h2>
        <div class="row" style="display:flex;gap:14px;flex-wrap:wrap">
        <label class="fld">Strategi saran harga<select id="sstrat"><option value="median" ${st.strategy === 'median' ? 'selected' : ''}>Median harga kompetitor yang laku</option><option value="min" ${st.strategy === 'min' ? 'selected' : ''}>Terendah</option><option value="min1" ${st.strategy === 'min1' ? 'selected' : ''}>Terendah − 1%</option></select></label>
        <label class="fld">Pembulatan<select id="sround"><option value="1" ${st.round == 1 ? 'selected' : ''}>Tidak</option><option value="100" ${st.round == 100 ? 'selected' : ''}>Rp 100</option><option value="1000" ${st.round == 1000 ? 'selected' : ''}>Rp 1.000</option></select></label>
        <label class="fld">"Naik" jika laju ≥ × periode lalu<input type="number" step="0.05" id="sup" value="${st.upRatio}"></label>
        <label class="fld">"Turun" jika laju ≤ × periode lalu<input type="number" step="0.05" id="sdown" value="${st.downRatio}"></label>
        <label class="fld">Auto-match jika skor ≥<input type="number" step="0.05" min="0.5" max="1" id="smatch" value="${st.matchAuto}"></label></div>
        <div class="bar" style="margin-top:12px"><button class="btn pri" data-act="save-rules">Simpan aturan</button></div>
        <p class="help">Penjualan dihitung dari selisih kolom <i>terjual</i> antar scrape; jika tidak ada, dari penurunan <i>stok</i> (restock tidak dihitung sebagai penjualan). Status naik/turun membandingkan laju per hari periode ini vs periode sebelumnya (butuh ≥3 scrape).</p></div></div>
      <div class="card"><h2>Kompetitor &amp; tier</h2><div class="tbl"><table><thead><tr><th>Nama</th><th>Tier</th><th>Kategori</th><th class="n">Snapshot</th><th></th></tr></thead><tbody>${S.comps.map((c) => `<tr><td><input type="text" data-cname="${c.id}" value="${esc(c.name)}"></td><td><select data-ctier="${c.id}">${S.tiers.concat(S.tiers.includes(c.tier) ? [] : [c.tier]).map((t) => `<option ${c.tier === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td><td><select data-ccat="${c.id}">${catOpts(c.cat)}</select></td><td class="n">${(S.snaps[c.id] || []).length}</td><td style="white-space:nowrap"><button class="btn sm" data-act="backup-comp" data-id="${c.id}">Backup</button> <button class="btn sm danger" data-act="del-comp" data-id="${c.id}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Belum ada.</td></tr>'}</tbody></table></div>
        <div class="bar" style="margin-top:12px"><input type="text" id="ntier" placeholder="Tier baru (mis. Premium)"><button class="btn" data-act="add-tier">Tambah tier</button></div></div>
      <div class="card"><h2>Kategori</h2>
        <p class="help" style="margin-top:-6px;margin-bottom:12px">Label buatan sendiri untuk mengelompokkan toko, misalnya Komputer, Laptop, atau Aksesoris. Satu toko memakai satu kategori; atur di kolom Kategori pada tabel di atas, saat upload, atau di halaman Kompetitor.</p>
        <div class="tbl"><table><thead><tr><th>Nama kategori</th><th class="n">Toko</th><th></th></tr></thead><tbody>${allCats().map((n) => `<tr><td><input type="text" data-catname="${esc(n)}" value="${esc(n)}"></td><td class="n">${S.comps.filter((c) => c.cat === n).length}</td><td class="n"><button class="btn sm danger" data-act="del-cat" data-name="${esc(n)}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Belum ada kategori.</td></tr>'}</tbody></table></div>
        <div class="bar" style="margin-top:12px"><input type="text" id="ncat" placeholder="Kategori baru (mis. Komputer)"><button class="btn" data-act="add-cat">Tambah kategori</button></div></div>
      <div class="card"><h2>Backup</h2><div class="bar"><button class="btn" data-act="backup">Download backup semua kompetitor (JSON)</button><label class="btn">Restore backup<input type="file" id="rfile" accept=".json" hidden></label><button class="btn danger" data-act="reset">Hapus semua data lokal</button></div>
        <p class="help">Backup satu toko tersedia di tabel Kompetitor di atas dan di halaman Kompetitor. Restore menggabungkan ke data yang ada: snapshot yang sudah ada dilewati, kompetitor yang belum ada dibuat otomatis, tidak ada data yang ditimpa.</p></div>`;
    $('#rfile').onchange = restoreBackup;
    $$('[data-cname]').forEach((i) => (i.onchange = () => ((compById(i.dataset.cname).name = i.value.trim() || compById(i.dataset.cname).name), dirty())));
    $$('[data-ccat]').forEach((i) => (i.onchange = () => ((compById(i.dataset.ccat).cat = i.value), dirty())));
    $$('[data-catname]').forEach(
      (i) =>
        (i.onchange = () => {
          const old = i.dataset.catname,
            nn = i.value.trim();
          if (!nn || (nn.toLowerCase() !== old.toLowerCase() && allCats().some((c) => c.toLowerCase() === nn.toLowerCase()))) return viewSettings();
          S.cats = S.cats.filter((c) => c !== old).concat(nn);
          S.comps.forEach((c) => c.cat === old && (c.cat = nn));
          dirty();
          viewSettings();
        })
    );
    $('#ncat').onkeydown = (e) => e.key === 'Enter' && $('[data-act=add-cat]').click();
    $$('[data-ctier]').forEach((i) => (i.onchange = () => ((compById(i.dataset.ctier).tier = i.value), dirty())));
  }

  async function restoreBackup(e) {
    const input = e.target;
    try {
      const j = JSON.parse(await input.files[0].text());
      if (!j || !Array.isArray(j.comps) || !Array.isArray(j.snaps)) throw new Error('bukan file backup Pantau Kompetitor');
      const r = await mergeData(j.comps, j.snaps);
      if (j.matches) for (const [k, v] of Object.entries(j.matches)) if (!(k in S.matches)) S.matches[k] = v;
      if (j.tiers) S.tiers = [...new Set([...S.tiers, ...j.tiers])];
      if (j.cats) S.cats = [...new Set([...S.cats, ...j.cats])];
      dirty();
      const names = j.comps.map((c) => c.name).slice(0, 3).join(', ') + (j.comps.length > 3 ? ', …' : '');
      toast(`Restore ${names}: ${r.added} snapshot ditambahkan, ${r.skipped} sudah ada${r.newComps ? `, ${r.newComps} kompetitor baru` : ''}`);
      render();
    } catch (er) {
      toast('Backup tidak valid: ' + er.message, true);
    } finally {
      input.value = '';
    }
  }
  /** isi file backup. compId diisi = satu toko; kosong = semua. */
  function backupPayload(compId) {
    const comps = compId ? S.comps.filter((c) => c.id === compId) : S.comps;
    const ids = new Set(comps.map((c) => c.id));
    const matches = {};
    for (const [k, v] of Object.entries(S.matches)) if (ids.has(k.split('|')[0])) matches[k] = v;
    return {
      format: 'pantau-kompetitor-backup',
      version: 2,
      scope: compId ? 'competitor' : 'all',
      exportedAt: new Date().toISOString(),
      comps,
      tiers: compId ? [...new Set(comps.map((c) => c.tier))] : S.tiers,
      cats: compId ? [...new Set(comps.map((c) => c.cat).filter(Boolean))] : allCats(),
      matches,
      snaps: comps.flatMap((c) => S.snaps[c.id] || []),
    };
  }
  async function mergeData(comps, snaps) {
    let added = 0,
      skipped = 0,
      newComps = 0;
    for (const c of comps)
      if (!compById(c.id)) {
        S.comps.push({ id: c.id, name: c.name, tier: c.tier, cat: c.cat || '' });
        newComps++;
      }
    for (const s of snaps) {
      if (!compById(s.compId)) continue;
      const arr = (S.snaps[s.compId] = S.snaps[s.compId] || []);
      if (arr.some((x) => x.id === s.id)) {
        skipped++;
        continue;
      }
      arr.push(s);
      arr.sort((a, b) => a.date.localeCompare(b.date));
      await KS.db.snapPut(s);
      added++;
    }
    S.dirty = true;
    return { added, skipped, newComps };
  }

  // =====================================================================
  // ROUTER & EVENTS
  // =====================================================================
  function render() {
    $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
    modal(null);
    ({ dashboard: viewDashboard, kompetitor: viewKomp, upload: viewUpload, matcher: viewMatcher, settings: viewSettings }[S.view] || viewDashboard)();
    window.scrollTo(0, 0);
  }
  function go(v) {
    S.view = v;
    history.replaceState(null, '', '#' + v);
    render();
  }

  document.addEventListener('change', (e) => {
    const t = e.target;
    const p = (id) => S.pending.find((x) => x.id === id);
    if (t.dataset.pcomp) (p(t.dataset.pcomp).compId = t.value), fillPending();
    else if (t.dataset.pname) p(t.dataset.pname).newName = t.value;
    else if (t.dataset.ptier) p(t.dataset.ptier).newTier = t.value;
    else if (t.dataset.pcat) { const pp = p(t.dataset.pcat); pp.newCat = t.value === '__new' ? askNewCat() || '' : t.value; fillPending(); }
    else if (t.dataset.pdate) p(t.dataset.pdate).date = t.value ? new Date(t.value).toISOString() : p(t.dataset.pdate).date;
    else if (t.dataset.pmerge) { p(t.dataset.pmerge).merge = t.checked; fillPending(); }
    else if (t.dataset.psold) p(t.dataset.psold).soldMode = t.value;
    else if (t.dataset.pmap) {
      const x = p(t.dataset.pmap);
      x.info.mapping[t.dataset.f] = t.value || undefined;
      const n = KS.normalizeItems(x.info.raw, x.info.mapping, { merge: x.merge }).length;
      $(`[data-pid="${x.id}"] [data-cnt]`).textContent = `${num(n)} produk terbaca dari ${num(x.info.raw.length)} baris`;
    } else if (t.dataset.act === 'cat-toggle') {
      const c = S.catalogs.find((x) => x.id === t.dataset.id);
      c.enabled = t.checked;
      KS.db.catPut(c).then(afterCatalogChange);
    }
  });

  document.addEventListener('click', async (e) => {
    const nav = e.target.closest('[data-view]');
    if (nav) return go(nav.dataset.view);
    if (e.target.id === 'modal') return modal(null);
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    const d = el.dataset;
    const u = S.ui;
    switch (d.act) {
      case 'close': return modal(null);
      case 'mov': u.dash.mov = d.k; $$('.kpi').forEach((k) => k.classList.toggle('on', k.dataset.k === d.k)); return fillMov();
      case 'rpage': u.dash.page = Math.max(0, u.dash.page + +d.d); return fillReco();
      case 'grp': return groupModal(S.recoView[+d.i]);
      case 'goto-k': e.preventDefault(); u.k = { ...u.k, comp: 'all', status: d.s, page: 0, q: '' }; return go('kompetitor');
      case 'goto-comp': u.k = { ...u.k, comp: d.id, status: 'all', page: 0, q: '', snap: null }; return go('kompetitor');
      case 'kgroup': u.k.group = d.g; return viewKomp();
      case 'pick-comp': u.k.comp = d.id; u.k.page = 0; u.k.snap = null; return viewKomp();
      case 'kfilter': u.k.status = d.f; u.k.page = 0; return fillKomp();
      case 'ksort': u.k.dir = u.k.sort === d.k ? -u.k.dir : 1; u.k.sort = d.k; return fillKTable();
      case 'kpage': u.k.page = Math.max(0, u.k.page + +d.d); return fillKTable();
      case 'del-snap': {
        const sn = S.snaps[u.k.comp];
        const s = sn[u.k.snap != null && u.k.snapComp === u.k.comp ? u.k.snap : sn.length - 1];
        if (!confirm(`Hapus snapshot ${fmtDate(s.date)}?`)) return;
        await KS.db.snapDel(s.id);
        S.snaps[u.k.comp] = sn.filter((x) => x !== s);
        u.k.snap = null;
        dirty();
        return viewKomp();
      }
      case 'export-k': {
        const rows = [['Kompetitor', 'Tier', 'Kategori', 'SKU', 'Nama', 'Status', 'Harga', 'Harga sebelumnya', 'Δ Harga', 'Δ %', 'Stok', 'Terjual total', 'Terjual periode', 'Rate/hari', 'URL']];
        S.kView.forEach((r) => rows.push([r.comp.name, r.comp.tier, r.comp.cat || '', r.k, r.name, (KS.STATUS[r.status] || {}).label, r.price, r.prevPrice, r.priceDelta, r.pricePct == null ? '' : r.pricePct.toFixed(1), r.stock, r.sold, r.sales, r.rate == null ? '' : r.rate.toFixed(2), r.url]));
        return KS.download('kompetitor.csv', KS.toCSV(rows));
      }
      case 'export-reco': {
        const rows = [['Produk', 'Katalog ID', 'Kompetitor menjual', 'Kompetitor total', 'Rate/hari', 'Terjual total', 'Harga min', 'Median', 'Maks', 'Saran harga', 'HPP', 'Margin %']];
        S.recoView.forEach((g) => rows.push([g.name, g.match ? g.match.id : '', g.nSellers, g.nCarriers, g.rate.toFixed(2), g.soldTotal, g.min, g.med, g.max, g.suggest, g.cost || '', g.margin == null ? '' : g.margin.toFixed(1)]));
        return KS.download('rekomendasi-sku.csv', KS.toCSV(rows));
      }
      case 'pend-del': S.pending = S.pending.filter((x) => x.id !== d.id); return fillPending();
      case 'process': return processPending();
      case 'retry-sync': {
        const o = S.lastResult.find((x) => x.comp.id === d.id);
        try {
          setSync('busy', 'Mengirim…');
          await KS.sync.pushSnapshot(S, o.comp, S.snaps[o.comp.id], o.idx, o.a);
          o.sync = 'ok';
          setSync('ok', 'Tersinkron');
        } catch (er) {
          o.sync = er.message;
          setSync('err', 'Gagal sinkron');
          toast(er.message, true);
        }
        return fillResult();
      }
      case 'mfilter': u.m.filter = d.f; u.m.page = 0; return fillMatcher();
      case 'mpage': u.m.page = Math.max(0, u.m.page + +d.d); return fillMatcher();
      case 'pick': { const r = S.mView[+d.i]; setMatch(r, r.sg[+d.j], true); return fillMatcher(); }
      case 'msearch': return searchModal(+d.i);
      case 'pick-search': { const r = S.mView[+d.gi]; setMatch(r, S._sres[+d.j], true); modal(null); return fillMatcher(); }
      case 'mnone': S.matches[S.mView[+d.i].key] = { none: true }; dirty(); return fillMatcher();
      case 'unmatch': delete S.matches[S.mView[+d.i].key]; dirty(); return fillMatcher();
      case 'bulk-ok': {
        const th = (+$('#bulkin').value || 60) / 100;
        let n = 0;
        for (const r of matcherItems()) if (!r.e && r.sg[0] && r.sg[0].score >= th) (setMatch(r, r.sg[0], true), n++);
        toast(`${n} SKU disetujui`);
        return fillMatcher();
      }
      case 'rematch':
        for (const [k, v] of Object.entries(S.matches)) if (!v.manual && !v.none) delete S.matches[k];
        S.sugg = {};
        dirty();
        return runSuggUI(true);
      case 'rematch-all':
        if (!confirm('Match ulang SEMUA SKU (termasuk match manual dan tanda "tidak ada di katalog")? Pilihan manual akan diganti hasil otomatis.')) return;
        S.matches = {};
        S.sugg = {};
        dirty();
        return runSuggUI(true);
      case 'clear-matches':
        if (!confirm('Hapus SEMUA data match (otomatis, manual, dan "tidak ada")? Riwayat snapshot tidak ikut terhapus.')) return;
        S.matches = {};
        S.sugg = {};
        dirty();
        toast('Semua match dihapus');
        return fillMatcher();
      case 'cat-del':
        if (!confirm('Hapus sumber katalog ini?')) return;
        S.catalogs = S.catalogs.filter((c) => c.id !== d.id);
        await KS.db.catDel(d.id);
        return afterCatalogChange();
      case 'save-api':
        S.settings.apiUrl = $('#sapi').value.trim();
        S.settings.token = $('#stoken').value;
        persist();
        try {
          setSync('busy', 'Tes…');
          const r = await KS.sync.ping(S);
          setSync('ok', 'Tersambung');
          return toast('Tersambung ke Sheet: ' + (r.sheet || 'OK'));
        } catch (er) {
          setSync('err', 'Gagal');
          return toast(er.message, true);
        }
      case 'save-rules': {
        const st = S.settings;
        st.strategy = $('#sstrat').value;
        st.round = +$('#sround').value;
        st.upRatio = +$('#sup').value || 1.25;
        st.downRatio = +$('#sdown').value || 0.75;
        st.matchAuto = +$('#smatch').value || 0.75;
        dirty();
        return toast('Aturan disimpan');
      }
      case 'pull':
        try {
          setSync('busy', 'Menarik…');
          const j = await KS.sync.pull(S);
          const snaps = j.snapshots.map((s) => ({ id: s.compId + '|' + s.date, compId: s.compId, date: s.date, file: 'sheet', soldMode: s.soldMode || 'cumulative', items: s.items.map((a) => ({ k: String(a[0]), name: a[1], price: a[2] === '' ? null : a[2], stock: a[3] === '' ? null : a[3], sold: a[4] === '' ? null : a[4], url: a[5] || '' })) }));
          await mergeData(j.competitors, snaps);
          for (const c of j.competitors) if (!S.tiers.includes(c.tier)) S.tiers.push(c.tier);
          dirty();
          setSync('ok', 'Tersinkron');
          toast(`${j.competitors.length} kompetitor, ${snaps.length} snapshot ditarik`);
          await ensureSugg();
          return render();
        } catch (er) {
          setSync('err', 'Gagal');
          return toast(er.message, true);
        }
      case 'push-all':
        try {
          for (const c of S.comps) {
            const sn = S.snaps[c.id] || [];
            if (!sn.length) continue;
            setSync('busy', 'Mengirim ' + c.name);
            await KS.sync.pushSnapshot(S, c, sn, sn.length - 1, KS.analyzeComp(sn, null, cfg()));
          }
          setSync('ok', 'Tersinkron');
          return toast('Semua kompetitor terkirim');
        } catch (er) {
          setSync('err', 'Gagal');
          return toast(er.message, true);
        }
      case 'del-comp':
        if (!confirm('Hapus kompetitor beserta seluruh riwayatnya (lokal)?')) return;
        for (const s of S.snaps[d.id] || []) await KS.db.snapDel(s.id);
        delete S.snaps[d.id];
        S.comps = S.comps.filter((c) => c.id !== d.id);
        dirty();
        return viewSettings();
      case 'add-cat': {
        const n = $('#ncat').value.trim();
        if (n && !allCats().some((c) => c.toLowerCase() === n.toLowerCase())) (S.cats.push(n), persist());
        return viewSettings();
      }
      case 'del-cat': {
        const n = d.name;
        const k = S.comps.filter((c) => c.cat === n).length;
        if (!confirm(`Hapus kategori "${n}"?${k ? ` ${k} toko akan jadi tanpa kategori (data toko tidak dihapus).` : ''}`)) return;
        S.cats = S.cats.filter((c) => c !== n);
        S.comps.forEach((c) => c.cat === n && (c.cat = ''));
        dirty();
        return viewSettings();
      }
      case 'add-tier': {
        const t = $('#ntier').value.trim();
        if (t && !S.tiers.includes(t)) (S.tiers.push(t), persist());
        return viewSettings();
      }
      case 'backup':
        return KS.download(`backup-kompetitor-semua-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backupPayload()), 'application/json');
      case 'backup-comp': {
        const c = compById(d.id);
        if (!c) return;
        const n = (S.snaps[c.id] || []).length;
        KS.download(`backup-${KS.slug(c.name) || 'toko'}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backupPayload(c.id)), 'application/json');
        return toast(`Backup ${c.name}: ${n} snapshot`);
      }
      case 'reset':
        if (!confirm('Hapus SEMUA data lokal di browser ini? (data di Google Sheets tidak terhapus)')) return;
        await KS.db.clearAll();
        return location.reload();
    }
  });

  // ---------- boot ----------
  (async function boot() {
    try {
      await load();
    } catch (e) {
      console.error(e);
      toast('Gagal memuat data lokal: ' + e.message, true);
    }
    if (S.settings.apiUrl) setSync('', 'Sheets terhubung');
    const h = location.hash.slice(1);
    if (['dashboard', 'kompetitor', 'upload', 'matcher', 'settings'].includes(h)) S.view = h;
    render();
    ensureSugg().then(() => {
      if (S.view === 'dashboard') render();
    });
  })();
})();
