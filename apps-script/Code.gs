/**
 * Pantau Kompetitor — Google Apps Script (Web App)
 * Menyimpan hasil scrape ke Google Sheets, satu tab per kompetitor: "<Tier> - <Kompetitor>"
 * (mis. "Agresif - TokoA", "Expert - TokoB"), ditambah:
 *   - "Perubahan"   : log SKU baru / penjualan naik-turun / perubahan harga
 *   - "_Kompetitor" : daftar kompetitor + tier (dipakai web untuk restore)
 *   - "_Snapshots"  : data mentah tiap upload (dipakai tombol "Tarik data dari Sheets")
 *
 * PASANG: buka Sheet → Extensions → Apps Script → tempel file ini → Deploy → New deployment →
 *         Web app → Execute as: Me, Who has access: Anyone → salin URL /exec ke menu Pengaturan web.
 * Setelah mengubah kode, buat deployment baru (Manage deployments → Edit → New version).
 */

// Sheet tujuan (bisa dikosongkan jika script ini dibuat dari dalam Sheet-nya: Extensions → Apps Script)
var SHEET_ID = '1pJXEKRcnJCfqveU_hLzSa6Lt_08MZ7zbTQNmbuadjSw';
// Token rahasia sederhana (opsional). Isi sama persis di menu Pengaturan web. Kosongkan untuk menonaktifkan.
var TOKEN = '';

var CFG_SHEET = '_Kompetitor';
var RAW_SHEET = '_Snapshots';
var LOG_SHEET = 'Perubahan';
var CELL_LIMIT = 40000; // batas aman karakter per sel (maks 50.000)

function ss_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function auth_(t) {
  return !TOKEN || t === TOKEN;
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (!auth_(p.token)) return json_({ ok: false, error: 'Token salah' });
    if (p.action === 'loadAll') return json_(loadAll_());
    return json_({ ok: true, sheet: ss_().getName() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var b = JSON.parse(e.postData.contents);
    if (!auth_(b.token)) return json_({ ok: false, error: 'Token salah' });
    switch (b.action) {
      case 'ping':
        return json_({ ok: true, sheet: ss_().getName() });
      case 'saveCompetitor':
        return json_(saveCompetitor_(b));
      case 'saveChanges':
        return json_(saveChanges_(b));
      case 'saveRaw':
        return json_(saveRaw_(b));
      default:
        return json_({ ok: false, error: 'Aksi tidak dikenal: ' + b.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function sheet_(name, header) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (header) {
      sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#e6f2ef');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}
function tabName_(c) {
  return String(c.tier + ' - ' + c.name).replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 99);
}

// ---------- daftar kompetitor ----------
function upsertConfig_(c, count, date) {
  var sh = sheet_(CFG_SHEET, ['id', 'nama', 'tier', 'tab', 'jumlah_sku', 'upload_terakhir']);
  var vals = sh.getDataRange().getValues();
  var row = -1;
  for (var i = 1; i < vals.length; i++) if (vals[i][0] === c.id) { row = i + 1; break; }
  var rec = [c.id, c.name, c.tier, tabName_(c), count, date];
  if (row < 0) sh.appendRow(rec);
  else {
    var oldTab = vals[row - 1][3];
    if (oldTab && oldTab !== rec[3]) {
      // tier berubah → ganti nama tab
      var old = ss_().getSheetByName(oldTab);
      if (old && !ss_().getSheetByName(rec[3])) old.setName(rec[3]);
    }
    sh.getRange(row, 1, 1, rec.length).setValues([rec]);
  }
}

// ---------- tab per kompetitor ----------
function saveCompetitor_(b) {
  var c = b.comp;
  var name = tabName_(c);
  upsertConfig_(c, b.total, new Date());
  var sh = ss_().getSheetByName(name);
  if (!sh) sh = sheet_(name, b.header);
  if (b.first) {
    sh.clearContents();
    sh.getRange(1, 1, 1, b.header.length).setValues([b.header]).setFontWeight('bold').setBackground('#e6f2ef');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, b.header.length).setNumberFormat('@');
  }
  if (b.rows.length) {
    var start = sh.getLastRow() + 1;
    var rng = sh.getRange(start, 1, b.rows.length, b.header.length);
    rng.setNumberFormat('General');
    // SKU & Match ID sebagai teks agar angka 0 di depan tidak hilang
    sh.getRange(start, 1, b.rows.length, 1).setNumberFormat('@');
    rng.setValues(b.rows);
    sh.getRange(start, 3, b.rows.length, 1).setNumberFormat('#,##0');
    sh.getRange(start, 9, b.rows.length, 2).setNumberFormat('#,##0;-#,##0');
  }
  return { ok: true, tab: name, rows: b.rows.length };
}

// ---------- log perubahan ----------
function saveChanges_(b) {
  var sh = sheet_(LOG_SHEET, ['Tanggal', 'Kompetitor', 'Tier', 'SKU', 'Nama Produk', 'Jenis', 'Harga lama', 'Harga baru', 'Δ Harga', 'Δ %', 'Rate/hari']);
  if (b.rows.length) sh.getRange(sh.getLastRow() + 1, 1, b.rows.length, b.rows[0].length).setValues(b.rows);
  return { ok: true, rows: b.rows.length };
}

// ---------- snapshot mentah (untuk restore) ----------
function saveRaw_(b) {
  var sh = sheet_(RAW_SHEET, ['compId', 'date', 'part', 'parts', 'data']);
  var c = b.comp;
  // hapus baris lama dengan comp+tanggal yang sama
  var vals = sh.getDataRange().getValues();
  for (var i = vals.length - 1; i >= 1; i--) if (vals[i][0] === c.id && vals[i][1] === b.date) sh.deleteRow(i + 1);
  var s = JSON.stringify(b.items);
  var parts = Math.max(1, Math.ceil(s.length / CELL_LIMIT));
  var out = [];
  for (var p = 0; p < parts; p++) out.push([c.id, b.date, p, parts, s.substr(p * CELL_LIMIT, CELL_LIMIT)]);
  sh.getRange(sh.getLastRow() + 1, 1, out.length, 5).setNumberFormat('@').setValues(out);
  upsertConfig_(c, b.items.length, new Date());
  return { ok: true, parts: parts };
}

function loadAll_() {
  var cfg = ss_().getSheetByName(CFG_SHEET);
  var raw = ss_().getSheetByName(RAW_SHEET);
  var comps = [];
  if (cfg) {
    var v = cfg.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) comps.push({ id: String(v[i][0]), name: String(v[i][1]), tier: String(v[i][2]) });
  }
  var snaps = [];
  if (raw) {
    var r = raw.getDataRange().getValues();
    var map = {};
    for (var j = 1; j < r.length; j++) {
      var k = r[j][0] + '|' + r[j][1];
      (map[k] = map[k] || { compId: String(r[j][0]), date: String(r[j][1]), parts: [] }).parts[Number(r[j][2])] = String(r[j][4]);
    }
    for (var key in map) {
      try {
        snaps.push({ compId: map[key].compId, date: map[key].date, items: JSON.parse(map[key].parts.join('')) });
      } catch (e) {}
    }
  }
  return { ok: true, competitors: comps, snapshots: snaps };
}
