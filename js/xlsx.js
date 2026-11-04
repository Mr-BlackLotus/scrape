/* xlsx.js — pembaca .xlsx minimalis tanpa dependensi (zip + XML, memakai DecompressionStream bawaan browser) */
(function () {
  const KS = window.KS;

  async function inflate(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  async function unzip(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Bukan file .xlsx yang valid');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const td = new TextDecoder();
    const files = {};
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true),
        el = dv.getUint16(p + 30, true),
        cl = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
      const lnl = dv.getUint16(off + 26, true),
        lel = dv.getUint16(off + 28, true);
      const start = off + 30 + lnl + lel;
      files[name] = { method, data: u8.subarray(start, start + csize) };
      p += 46 + nl + el + cl;
    }
    const read = async (name) => {
      const f = files[name];
      if (!f) return null;
      const bytes = f.method === 0 ? f.data : await inflate(f.data);
      return td.decode(bytes);
    };
    return { files, read };
  }

  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const colIdx = (ref) => {
    let n = 0;
    for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  /** return {sheets:[{name, rows:[[...]]}]} */
  async function readWorkbook(buf) {
    const z = await unzip(buf);
    const shared = [];
    const ssx = await z.read('xl/sharedStrings.xml');
    if (ssx) {
      xml(ssx)
        .querySelectorAll('si')
        .forEach((si) => {
          let t = '';
          si.querySelectorAll('t').forEach((x) => {
            if (!x.closest('rPh')) t += x.textContent;
          });
          shared.push(t);
        });
    }
    const wb = xml(await z.read('xl/workbook.xml'));
    const rels = xml((await z.read('xl/_rels/workbook.xml.rels')) || '<r/>');
    const relMap = {};
    rels.querySelectorAll('Relationship').forEach((r) => (relMap[r.getAttribute('Id')] = r.getAttribute('Target')));
    const sheets = [];
    for (const s of Array.from(wb.querySelectorAll('sheet'))) {
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = relMap[rid] || `worksheets/sheet${sheets.length + 1}.xml`;
      target = target.replace(/^\//, '');
      const path = target.startsWith('xl/') ? target : 'xl/' + target;
      const sx = await z.read(path);
      if (!sx) continue;
      const rows = [];
      xml(sx)
        .querySelectorAll('sheetData > row')
        .forEach((row) => {
          const arr = [];
          row.querySelectorAll('c').forEach((c) => {
            const ref = c.getAttribute('r');
            const t = c.getAttribute('t');
            const v = c.querySelector('v');
            let val = null;
            if (t === 'inlineStr') val = Array.from(c.querySelectorAll('t')).map((x) => x.textContent).join('');
            else if (v) {
              const raw = v.textContent;
              if (t === 's') val = shared[+raw] ?? '';
              else if (t === 'str' || t === 'e') val = raw;
              else if (t === 'b') val = raw === '1';
              else val = raw === '' ? null : Number(raw);
            }
            arr[ref ? colIdx(ref) : arr.length] = val;
          });
          rows.push(arr);
        });
      sheets.push({ name: s.getAttribute('name'), rows });
    }
    return sheets;
  }

  /** ArrayBuffer .xlsx → array objek (baris pertama = header) dari sheet terbesar */
  KS.readXLSX = async function (buf) {
    const sheets = await readWorkbook(buf);
    if (!sheets.length) throw new Error('Workbook kosong');
    const best = sheets.slice().sort((a, b) => b.rows.length - a.rows.length)[0];
    return KS.rowsToObjects(best.rows);
  };

  KS.rowsToObjects = function (rows) {
    const hi = rows.findIndex((r) => r && r.filter((x) => x != null && x !== '').length >= 2);
    if (hi < 0) return [];
    const head = rows[hi].map((h, i) => (h == null || h === '' ? 'kolom' + (i + 1) : String(h).trim()));
    const out = [];
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.some((x) => x != null && x !== '')) continue;
      const o = {};
      head.forEach((h, j) => (o[h] = r[j] === undefined || r[j] === '' ? null : r[j]));
      out.push(o);
    }
    return out;
  };
})();
