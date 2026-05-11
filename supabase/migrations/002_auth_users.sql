-- ============================================================
-- KathaKitaab.ai — Auth / Users / Free-era tracking
--
-- Public users table that mirrors Supabase auth.users, plus columns
-- we own:
--   - is_free_era:   admitted under the first-100 signups gate
--   - free_era_seq:  monotonic position (1..100) for analytics
--   - is_pro:        paid tier flag (kept here so reads avoid a join)
--   - books_generated_lifetime: counter for the 1-generation free quota
--   - display_name:  cached from OAuth metadata
--
-- A trigger on auth.users INSERT keeps the row in sync. RLS is set
-- so users can read/update their own row; service-role bypasses RLS
-- for the generation route's counter increment.
-- ============================================================

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  is_free_era boolean not null default false,
  free_era_seq integer,
  is_pro boolean not null default false,
  books_generated_lifetime integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_free_era_seq on public.users (free_era_seq)
  where free_era_seq is not null;

-- ── Trigger: auto-insert public.users row on auth signup ────
--
-- Supabase emits a row into auth.users on every signup. We mirror
-- that into public.users so the rest of the app can read profile
-- info via RLS-friendly queries.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ── Atomic counter bump for the per-user generation quota ──
create or replace function public.increment_books_generated(user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
    set books_generated_lifetime = books_generated_lifetime + 1,
        updated_at = now()
    where id = user_id;
end;
$$;

-- ── RLS ─────────────────────────────────────────────────────
alter table public.users enable row level security;

drop policy if exists "users_select_self" on public.users;
create policy "users_select_self"
  on public.users
  for select
  using (auth.uid() = id);

drop policy if exists "users_update_self" on public.users;
create policy "users_update_self"
  on public.users
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── Waitlist (for users who signed up after the first-100 cap) ──
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- No public select — only the service role can read the waitlist
-- (operator-only). Inserts come from a route that uses service role,
-- so we don't need an anon-INSERT policy here.

-- ── Content reports (for the report-content button) ─────────
--
-- Anonymous-friendly: anyone can submit a report. The operator
-- triage queue reads via service-role.
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  book_slug text not null,
  scene_id text,
  reporter_user_id uuid references public.users(id) on delete set null,
  reporter_owner_id text,
  reason text not null,
  notes text,
  status text not null default 'open', -- 'open' | 'reviewing' | 'resolved' | 'dismissed'
  created_at timestamptz not null default now()
);

create index if not exists idx_content_reports_status on public.content_reports (status, created_at desc);

alter table public.content_reports enable row level security;

-- Public can INSERT a report. No select policy → only service-role
-- can read. This prevents reporters from enumerating each other.
drop policy if exists "anyone_can_report" on public.content_reports;
create policy "anyone_can_report"
  on public.content_reports
  for insert
  with check (true);
