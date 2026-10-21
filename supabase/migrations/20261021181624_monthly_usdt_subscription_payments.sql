-- $50 USDT / 30-day manually verified subscription payments.
-- The QR in index.html encodes the exact TRC20 address below.
begin;

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_email text not null,
  amount numeric(10,2) not null default 50.00 check (amount = 50.00),
  network text not null default 'TRC20' check (network = 'TRC20'),
  wallet_address text not null default 'TC5HoQ5YC6AUzYqfrs26fdRXo6UJ1G8zUM'
    check (wallet_address = 'TC5HoQ5YC6AUzYqfrs26fdRXo6UJ1G8zUM'),
  tx_hash text not null unique check (length(trim(tx_hash)) >= 20),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id)
);

alter table public.subscription_payments enable row level security;
revoke all on public.subscription_payments from public, anon, authenticated;
grant select, insert on public.subscription_payments to authenticated;

drop policy if exists "customers view own subscription payments" on public.subscription_payments;
create policy "customers view own subscription payments"
on public.subscription_payments for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
);

drop policy if exists "customers submit pending subscription payment" on public.subscription_payments;
create policy "customers submit pending subscription payment"
on public.subscription_payments for insert to authenticated
with check (
  user_id = (select auth.uid())
  and user_email = (select auth.jwt()->>'email')
  and amount = 50.00
  and network = 'TRC20'
  and wallet_address = 'TC5HoQ5YC6AUzYqfrs26fdRXo6UJ1G8zUM'
  and status = 'pending'
  and reviewed_at is null
  and reviewed_by is null
  and length(trim(tx_hash)) >= 20
);

create or replace function public.admin_review_subscription_payment(
  p_payment_id uuid,
  p_approve boolean,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := auth.uid();
  v_payment public.subscription_payments%rowtype;
  v_start timestamptz := now();
  v_end timestamptz := now() + interval '30 days';
begin
  if v_admin is null or not exists (
    select 1 from public.profiles p where p.id = v_admin and p.role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;

  select * into v_payment
  from public.subscription_payments
  where id = p_payment_id
  for update;

  if not found then raise exception 'Payment request not found'; end if;
  if v_payment.status <> 'pending' then raise exception 'This payment request has already been reviewed'; end if;

  update public.subscription_payments
  set status = case when p_approve then 'approved' else 'rejected' end,
      admin_note = left(coalesce(p_note,''),500),
      reviewed_at = now(),
      reviewed_by = v_admin
  where id = p_payment_id;

  if p_approve then
    insert into public.subscriptions
      (user_id, plan_code, status, starts_at, ends_at, max_monthly_emails, created_by, updated_at)
    values
      (v_payment.user_id, 'monthly_50_usdt', 'active', v_start, v_end, 1000000, v_admin, now())
    on conflict (user_id) do update set
      plan_code = 'monthly_50_usdt',
      status = 'active',
      starts_at = v_start,
      ends_at = v_end,
      max_monthly_emails = 1000000,
      created_by = v_admin,
      updated_at = now();
  end if;

  return jsonb_build_object(
    'payment_id', p_payment_id,
    'status', case when p_approve then 'approved' else 'rejected' end,
    'user_id', v_payment.user_id,
    'subscription_ends_at', case when p_approve then v_end else null end
  );
end;
$$;

revoke all on function public.admin_review_subscription_payment(uuid,boolean,text) from public, anon;
grant execute on function public.admin_review_subscription_payment(uuid,boolean,text) to authenticated;

commit;
