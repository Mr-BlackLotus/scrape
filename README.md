# Pantau Kompetitor

Web statis (tanpa build) untuk memantau scrape toko kompetitor: upload JSON → dibandingkan dengan scrape sebelumnya → disimpan ke Google Sheets per kompetitor/tier.

## Fitur
- **Upload JSON** hasil scraper (banyak file sekaligus). Kolom nama/harga/stok/terjual/SKU/URL dideteksi otomatis, bisa diubah manual.
- **Per kompetitor & tier** (Agresif, Expert, Reguler, atau tier buatan sendiri). Di Sheet: satu tab per kompetitor, mis. `Agresif - TokoA`.
- **Perbandingan tiap upload**: SKU baru, penjualan naik / turun / laku / stagnan, SKU hilang, harga naik/turun (nominal & %).
- **Halaman Kompetitor**: buka satu toko atau semua sekaligus, filter status, cari, sort, export CSV.
- **SKU Matcher**: cocokkan nama produk kompetitor ke katalog (`data/katalog.csv`, 54.592 SKU). Bisa banyak sumber katalog (Drive/Sheet berbeda), review saran, cari manual, setujui massal.
- **Dashboard**: SKU yang oke dijual (gabungan semua kompetitor) + harga min/median/maks + saran harga (+ margin bila katalog punya kolom `hpp`).

## Cara pakai
1. **Publish web**: repo → Settings → Pages → Branch `main` / root. Buka `https://mr-blacklotus.github.io/scrape/`. (Atau jalankan lokal: `python3 -m http.server` lalu buka `localhost:8000`.)
2. **Sambungkan Google Sheets** (sekali saja): buka Sheet scrape → Extensions → Apps Script → tempel `apps-script/Code.gs` → Deploy → New deployment → Web app (Execute as *Me*, access *Anyone*) → salin URL `/exec` → menu **Pengaturan** di web → *Simpan & tes koneksi*. Opsional: isi `TOKEN` di Code.gs dan di web.
3. **Upload scrape** di menu *Upload Scrape*. Upload pertama = baseline; mulai upload kedua muncul perubahan. Tren naik/turun butuh ≥3 scrape.
4. Buka **SKU Matcher** untuk meninjau saran pencocokan; hasilnya dipakai dashboard.

Folder `samples/` berisi contoh data palsu untuk uji coba (3 toko × 3 tanggal).

## Format JSON yang dibaca
Array produk, atau objek yang berisi array (`products`, `items`, `data`, …). Contoh field yang dikenali: `name/nama/title`, `price/harga`, `stock/stok/qty`, `sold/terjual`, `sku/id`, `url`. Nama kompetitor dari field `competitor/shop/toko` atau nama file; tanggal dari `scraped_at/date` atau tanggal file.

## Aturan hitung
- Penjualan periode = selisih `terjual` antar scrape; bila tidak ada, penurunan `stok` (restock diabaikan).
- Naik/turun = laju per hari periode ini vs periode sebelumnya (ambang di Pengaturan, default ×1,25 / ×0,75).
- Saran harga = median (atau terendah / terendah−1%) dari harga kompetitor yang laku dan stoknya ada.

Data utama disimpan di IndexedDB browser; Google Sheets jadi penyimpanan cloud & bisa ditarik ulang (*Tarik data dari Sheets*). Gunakan *Backup* di Pengaturan untuk salinan JSON.
