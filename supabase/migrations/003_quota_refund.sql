-- ============================================================
-- 003_quota_refund.sql
--
-- Adds the matching decrement function for the per-user generation
-- quota so a failed generation can refund the slot it burned at
-- request entry. Floors at zero — concurrent refund + success
-- shouldn't underflow into negatives.
--
-- Safe to re-run: create or replace + idempotent.
-- ============================================================

create or replace function public.decrement_books_generated(user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
    set books_generated_lifetime = greatest(0, books_generated_lifetime - 1),
        updated_at = now()
    where id = user_id;
end;
$$;
