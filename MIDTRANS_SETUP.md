# Integrasi Midtrans GadgetCare

Integrasi ini menggunakan **Midtrans Snap**. Nominal diambil dari database, dan status lunas hanya ditetapkan oleh notifikasi webhook yang signature-nya valid. Tombol pelanggan tidak dapat menandai booking sebagai lunas.

## File yang ditambahkan

- `supabase/migrations/20261009000000_midtrans_payments.sql`
- `supabase/functions/create-midtrans-payment/index.ts`
- `supabase/functions/midtrans-webhook/index.ts`

## 1. Jalankan migrasi database

Buka Supabase Dashboard → SQL Editor → New query. Salin dan jalankan isi file migrasi. Pastikan tabel `public.bookings` memang memiliki kolom `id`, `booking_code`, `customer_name`, `phone`, `total_price`, dan `estimated_price`.

## 2. Siapkan Midtrans

1. Buat/masuk ke akun Midtrans dan mulai dari **Sandbox**.
2. Buka Settings → Access Keys dan salin **Server Key Sandbox**. Jangan pernah memasukkan Server Key ke `index.html`, GitHub Pages, atau chat publik.
3. Di Supabase Dashboard → Edge Functions → Secrets, atur:
   - `MIDTRANS_SERVER_KEY` = Server Key Sandbox
   - `MIDTRANS_IS_PRODUCTION` = `false`
   - `SUPABASE_URL` = URL proyek Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` = service-role key proyek (secret server-side saja; jangan commit nilainya)
4. Pastikan fungsi dijalankan dengan secrets tersebut. Jangan pernah menambahkan service-role key ke file frontend.

## 3. Deploy Edge Functions

Dari folder proyek lokal yang sudah dihubungkan ke proyek Supabase, jalankan:

```sh
supabase functions deploy create-midtrans-payment
supabase functions deploy midtrans-webhook
```

Jika menggunakan dashboard/editor, buat kedua Edge Function dengan nama dan isi file yang sama lalu deploy. Pastikan fungsi `create-midtrans-payment` dapat dipanggil publik; fungsi ini memvalidasi kode booking + nomor WhatsApp dan hanya membaca harga dari database. Jangan nonaktifkan validasi di webhook.

## 4. Konfigurasi notifikasi Midtrans

Atur Payment Notification URL menjadi:

```
https://sqpolxwdyypbxylgvihi.supabase.co/functions/v1/midtrans-webhook
```

Gunakan endpoint tersebut untuk Sandbox terlebih dahulu. Webhook memvalidasi `signature_key` menggunakan SHA-512 dan membandingkan `gross_amount` dengan harga database sebelum mengubah status.

## 5. Tes di Sandbox

1. Buat booking baru dari website.
2. Tetapkan harga service dari halaman admin. Pastikan harga tersimpan di `total_price` atau `estimated_price` sesuai fungsi database yang sudah ada.
3. Buka bagian Pembayaran di website, masukkan kode booking dan nomor WhatsApp yang sama dengan booking.
4. Klik **Lanjut ke Pembayaran** dan selesaikan transaksi dengan metode/kartu uji yang disediakan dashboard Midtrans Sandbox.
5. Periksa kolom `payment_status` di tabel `bookings`. Status hanya boleh berubah menjadi `Dibayar` setelah webhook valid diterima.
6. Uji juga transaksi pending, cancel, dan expire. Jangan beralih ke production sampai alur ini tervalidasi.

## Catatan

- Perubahan frontend dan fungsi di GitHub tidak otomatis menjalankan SQL migration atau deploy Edge Functions di Supabase.
- Jangan menganggap transaksi lunas berdasarkan redirect browser saja; webhook adalah sumber kebenaran.
- Jika skema kolom harga di database berbeda, sesuaikan query dan migrasi sebelum deploy.
