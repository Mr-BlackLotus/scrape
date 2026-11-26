# Pantau Kompetitor

Web statis (tanpa build) untuk memantau scrape toko kompetitor: upload JSON → dibandingkan dengan scrape sebelumnya → disimpan ke Google Sheets per kompetitor/tier.

## Fitur
- **Upload hasil scrape** `.xlsx` / `.csv` / `.json` (banyak file sekaligus). Kolom nama/varian/harga/stok/terjual/URL dideteksi otomatis, bisa diubah manual. Format Shopee (satu baris per varian, kolom *Terjual/Bln*) didukung: varian digabung jadi 1 produk (harga = varian tersedia termurah), penjualan dibaca sebagai per bulan. Nama kompetitor ditebak dari nama file `shopee_<toko>_…`.
- **Per kompetitor & tier** (Agresif, Expert, Reguler, atau tier buatan sendiri). Di Sheet: satu tab per kompetitor, mis. `Agresif - TokoA`.
- **Kategori buatan sendiri** (mis. Komputer, Laptop, Aksesoris): label tambahan di luar tier, satu per toko. Dibuat di Pengaturan → Kategori, atau langsung saat upload / di halaman Kompetitor. Daftar toko di halaman Kompetitor bisa dikelompokkan menurut Kategori atau Tier, dan Dashboard punya filter kategori. Kategori tersimpan di browser dan ikut Backup/Restore JSON; tidak dikirim ke Google Sheets.
- **Perbandingan tiap upload**: SKU baru, penjualan naik / turun / laku / stagnan, SKU hilang, harga naik/turun (nominal & %).
- **Halaman Kompetitor**: buka satu toko atau semua sekaligus, filter status, cari, sort, export CSV.
- **SKU Matcher**: cocokkan nama produk kompetitor ke katalog (`data/katalog.csv`, 54.592 SKU). Bisa banyak sumber katalog (Drive/Sheet berbeda), review saran, cari manual, setujui massal.
  - Algoritma pencocokan = **SKU Catalog Matcher** (`js/match.js`): token dinormalisasi (MX-7 = MX7, 4 GRAM = 4g, hitam = black), skor gabungan cakupan nama kompetitor dan nama katalog berbobot IDF, dengan penalti untuk merek berbeda, kode model yang tidak cocok, varian/ukuran berbeda. Tambahan kecil: 12CM = 120mm dan warna berbeda (White ≠ Black) menurunkan skor.
  - **Langsung tembak, tanpa pilihan**: untuk tiap produk (dan tiap varian) matcher memeriksa urut **merek → tipe/model → warna** (plus ukuran/gram varian). Kandidat teratas yang lolos semuanya langsung dipasang sebagai match; kalau tidak ada yang lolos, masuk tab **Tidak ketemu**. Skor minimal 45%. Koreksi manual tetap bisa lewat tombol **Cari…**.
  - Tombol di SKU Matcher: **Hitung ulang otomatis** (match manual tetap), **Match ulang semua** (termasuk manual), **Hapus semua match** (snapshot tidak terhapus).
  - **Varian produk**: jika file scrape punya kolom Varian, setiap varian jadi baris sendiri (`nama ▸ varian`) dan dicocokkan sendiri. Gram/kapasitas/warna dari varian dipakai, mis. `ARCTIC MX-7 2G 4G 8G ▸ 4G` cocok ke SKU 4g (varian 2g/8g hanya 60%). Centang "Gabung varian" saat upload untuk cara lama (1 produk per URL). Catatan: kalau snapshot sebelumnya digabung, hapus dan upload ulang supaya perbandingannya konsisten.
  - Tampilan varian di Dashboard, Kompetitor, dan SKU Matcher: baris produk induk di atas, varian-variannya berurutan ke bawah (`↳ varian`), masing-masing punya harga, status, dan pencocokan sendiri.
- **Dashboard**: SKU yang oke dijual (gabungan semua kompetitor) + harga min/median/maks + saran harga (+ margin bila katalog punya kolom `hpp`).

## Cara pakai
1. **Publish web**: repo → Settings → Pages → Branch `main` / root. Buka `https://mr-blacklotus.github.io/scrape/`. (Atau jalankan lokal: `python3 -m http.server` lalu buka `localhost:8000`.)
2. **Sambungkan Google Sheets** (sekali saja): buka Sheet scrape → Extensions → Apps Script → tempel `apps-script/Code.gs` → Deploy → New deployment → Web app (Execute as *Me*, access *Anyone*) → salin URL `/exec` → menu **Pengaturan** di web → *Simpan & tes koneksi*. Opsional: isi `TOKEN` di Code.gs dan di web.
3. **Upload scrape** di menu *Upload Scrape*. Upload pertama = baseline; mulai upload kedua muncul perubahan. Tren naik/turun butuh ≥3 scrape.
4. Buka **SKU Matcher** untuk meninjau saran pencocokan; hasilnya dipakai dashboard.

Folder `samples/` berisi contoh data palsu untuk uji coba (3 toko × 3 tanggal).

## Format file yang dibaca
`.xlsx` (sheet terbesar, baris pertama = header) atau `.csv` dengan kolom seperti `Nama Produk, Varian, Harga Jual, Stok, Terjual/Bln, Link`. JSON:
Array produk, atau objek yang berisi array (`products`, `items`, `data`, …). Contoh field yang dikenali: `name/nama/title`, `price/harga`, `stock/stok/qty`, `sold/terjual`, `sku/id`, `url`. Nama kompetitor dari field `competitor/shop/toko` atau nama file; tanggal dari `scraped_at/date` atau tanggal file.

## Aturan hitung
- Jika kolom terjual berarti **per bulan** (mis. `Terjual/Bln`): penjualan = nilai kolom itu, tren naik/turun = dibanding scrape sebelumnya (cukup 2 scrape). Jika **kumulatif**: penjualan periode = selisih `terjual` antar scrape; bila tidak ada, penurunan `stok` (restock diabaikan).
- Naik/turun = laju per hari periode ini vs periode sebelumnya (ambang di Pengaturan, default ×1,25 / ×0,75).
- Saran harga = median (atau terendah / terendah−1%) dari harga kompetitor yang laku dan stoknya ada.

Data utama disimpan di IndexedDB browser; Google Sheets jadi penyimpanan cloud & bisa ditarik ulang (*Tarik data dari Sheets*). Gunakan *Backup* di Pengaturan untuk salinan JSON.

## Backup & restore
- **Semua kompetitor**: Pengaturan → *Download backup semua kompetitor (JSON)*.
- **Satu kompetitor**: tombol *Backup toko ini* di halaman Kompetitor, atau *Backup* di tabel Kompetitor (Pengaturan). File berisi seluruh riwayat snapshot toko itu dan pencocokan SKU-nya, tidak mencampur toko lain.
- **Restore**: *Restore* di halaman Kompetitor atau Pengaturan, file dari kedua jenis backup bisa dipakai. Sifatnya menggabung: snapshot yang sudah ada dilewati, kompetitor yang belum ada dibuat lagi, pencocokan SKU yang sudah ada tidak ditimpa. Restore file yang sama dua kali aman.
