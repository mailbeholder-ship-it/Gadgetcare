-- GadgetCare: pengaturan jam operasional bersama untuk admin dan halaman pelanggan
create table if not exists public.site_settings (
  id text primary key check (id = 'main'),
  opening_hours jsonb not null default '{"days":[1,2,3,4,5,6],"open_time":"09:00","close_time":"17:00"}'::jsonb,
  is_closed boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
drop policy if exists "Public can read operating hours" on public.site_settings;
create policy "Public can read operating hours" on public.site_settings
  for select to anon, authenticated using (true);
drop policy if exists "Authenticated users can update operating hours" on public.site_settings;
create policy "Authenticated users can update operating hours" on public.site_settings
  for all to authenticated using (true) with check (true);
insert into public.site_settings (id, opening_hours, is_closed)
values ('main', '{"days":[1,2,3,4,5,6],"open_time":"09:00","close_time":"17:00"}'::jsonb, false)
on conflict (id) do nothing;
