# Integrasi QRIS Dinamis Xendit untuk GadgetCare

Integrasi ini menggunakan hosted invoice Xendit. Nominal ditentukan oleh database GadgetCare, lalu pelanggan diarahkan ke halaman checkout Xendit untuk membayar melalui metode yang tersedia pada akun merchant (aktifkan QRIS di dashboard). Status lunas hanya diubah oleh webhook yang memiliki callback token valid.

## 1. Daftar dan aktifkan Xendit
1. Buat akun merchant di https://dashboard.xendit.co/register atau buka https://www.xendit.co/id/.
2. Lengkapi verifikasi/onboarding bisnis yang diminta Xendit.
3. Di dashboard, pastikan metode QRIS tersedia dan aktif. Ketersediaan metode pembayaran bisa bergantung pada hasil aktivasi akun.

## 2. Atur secrets di Supabase
Buka Supabase Dashboard → Edge Functions → Secrets. Tambahkan:
- `XENDIT_SECRET_KEY`: Secret API key dari Xendit. Simpan hanya di server.
- `XENDIT_CALLBACK_TOKEN`: callback verification token dari pengaturan webhook Invoice Xendit.
- `SUPABASE_URL`: URL proyek Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: service-role key proyek. Jangan taruh di frontend atau commit ke GitHub.

## 3. Terapkan database
File migrasi `supabase/migrations/20261009000000_midtrans_payments.sql` menambahkan kolom status pembayaran yang dipakai oleh integrasi ini. Jika migrasi sebelumnya sudah dijalankan, tidak perlu menjalankannya ulang.

## 4. Deploy fungsi
Dari folder proyek lokal yang sudah terhubung ke proyek Supabase:
```sh
supabase functions deploy create-xendit-payment --no-verify-jwt
supabase functions deploy xendit-webhook --no-verify-jwt
```
Webhook bersifat publik karena dipanggil Xendit; fungsi memverifikasi header `x-callback-token`.

## 5. Atur webhook Invoice Xendit
Di dashboard Xendit → Settings / Developers → Webhooks, atur Invoice callback URL:
`https://sqpolxwdyypbxylgvihi.supabase.co/functions/v1/xendit-webhook`
Ambil callback token dari dashboard dan masukkan ke secret `XENDIT_CALLBACK_TOKEN`.

## 6. Uji
1. Buat booking baru di GadgetCare.
2. Tetapkan harga dari halaman admin.
3. Di bagian Pembayaran, masukkan kode booking dan nomor WhatsApp.
4. Lanjutkan ke checkout Xendit dan pilih QRIS jika sudah tersedia di akun.
5. Setelah pembayaran sukses, pastikan status booking berubah menjadi `Dibayar` melalui webhook.

## Keamanan dan catatan
- Jangan memasukkan secret key ke `index.html`, GitHub Pages, atau chat.
- Harga diambil dari database, bukan dari input pelanggan.
- Jangan mengubah status menjadi lunas hanya berdasarkan redirect browser.
- File lama `create-midtrans-payment` dan `midtrans-webhook` tidak dipakai oleh frontend setelah perpindahan ini; jangan deploy atau gunakan lagi.
- Perubahan GitHub tidak otomatis menerapkan migrasi atau deploy fungsi ke Supabase.
