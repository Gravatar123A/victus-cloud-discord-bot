-- Discord-only ticket AI state. Keep this separate from website support tickets.
alter table public.ticket_categories
  add column if not exists premium_support boolean not null default false;

update public.ticket_categories
   set premium_support = true
 where lower(trim(name)) = 'premium support';

create unique index if not exists ticket_categories_one_premium_per_guild
  on public.ticket_categories (guild_id) where premium_support = true;

create table if not exists public.discord_ticket_ai_state (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  enabled boolean not null default true,
  disabled_by text,
  disabled_at timestamptz,
  staff_pinged_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists discord_ticket_ai_state_updated_idx
  on public.discord_ticket_ai_state (updated_at desc);

alter table public.discord_ticket_ai_state enable row level security;
revoke all on public.discord_ticket_ai_state from anon, authenticated;
grant select, insert, update, delete on public.discord_ticket_ai_state to service_role;

-- Atomic cooldown across bot restarts or multiple workers.
create or replace function public.discord_ticket_claim_staff_ping(p_ticket_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed boolean := false;
begin
  insert into public.discord_ticket_ai_state (ticket_id)
  values (p_ticket_id) on conflict (ticket_id) do nothing;

  update public.discord_ticket_ai_state
     set staff_pinged_at = now(), updated_at = now()
   where ticket_id = p_ticket_id
     and (staff_pinged_at is null or staff_pinged_at < now() - interval '15 minutes')
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;
revoke all on function public.discord_ticket_claim_staff_ping(uuid) from public, anon, authenticated;
grant execute on function public.discord_ticket_claim_staff_ping(uuid) to service_role;
