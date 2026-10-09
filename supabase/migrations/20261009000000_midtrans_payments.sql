-- Midtrans payment tracking for GadgetCare.
-- Apply this migration in the Supabase SQL Editor before deploying the Edge Functions.

alter table public.bookings
  add column if not exists payment_status text not null default 'Belum Dibayar',
  add column if not exists payment_order_id text,
  add column if not exists payment_method text,
  add column if not exists payment_paid_at timestamptz;

create unique index if not exists bookings_payment_order_id_unique
  on public.bookings (payment_order_id)
  where payment_order_id is not null;

create index if not exists bookings_payment_status_idx
  on public.bookings (payment_status);
