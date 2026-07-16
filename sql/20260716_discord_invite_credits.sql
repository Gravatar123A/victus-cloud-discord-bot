-- ============================================================================
-- discord_invite_credits
-- Escrow ledger for the "+20 COINS per Discord invite" reward.
--
-- One row per invited person (UNIQUE invitee_discord_id) so a re-invite or a
-- rejoin can never earn a second payout (idempotency + anti-farm).
--
-- Lifecycle:
--   pending      -> inserted on guildMemberAdd once an inviter is attributed
--   confirmed    -> the scheduler paid the inviter 20 COINS after qualify_at
--                   (invitee still a member + inviter's Victus account linked)
--   voided       -> invitee left before qualify_at; no COINS were ever moved
--   clawed_back  -> reserved for the instant-grant variant (unused in escrow)
--   unattributed -> join could not be tied to exactly one invite (vanity /
--                   widget / simultaneous joins); never pays out
--
-- COINS move ONLY via the canonical Paymenter rail (admin-paymenter
-- credits.adjust, currency=COINS), never profiles.total_cp.
-- ============================================================================

create table if not exists public.discord_invite_credits (
    id                  uuid primary key default gen_random_uuid(),
    guild_id            text not null,
    inviter_discord_id  text,
    invitee_discord_id  text not null,
    invite_code         text,
    inviter_user_id     uuid,
    coins               integer not null default 20,
    status              text not null default 'pending'
                            check (status in ('pending','confirmed','voided','clawed_back','unattributed')),
    joined_at           timestamptz not null default now(),
    qualify_at          timestamptz not null,
    paid_at             timestamptz,
    left_at             timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    -- One credit per invited person: blocks re-invite / rejoin farming and
    -- makes the join handler's insert idempotent (ON CONFLICT DO NOTHING).
    constraint discord_invite_credits_invitee_unique unique (invitee_discord_id)
);

-- Scheduler: "which pending credits are due?"  (status, qualify_at)
create index if not exists discord_invite_credits_due_idx
    on public.discord_invite_credits (status, qualify_at);

-- Rate cap: "how many credits has this inviter earned in the last 24h?"
create index if not exists discord_invite_credits_inviter_idx
    on public.discord_invite_credits (inviter_discord_id, joined_at);

-- ── Row Level Security: service-role only ──────────────────────────────────
-- The bot connects with the service key, which bypasses RLS. Enabling RLS with
-- no permissive policy means anon/authenticated clients get zero access.
alter table public.discord_invite_credits enable row level security;

drop policy if exists discord_invite_credits_service_role on public.discord_invite_credits;
create policy discord_invite_credits_service_role
    on public.discord_invite_credits
    for all
    to service_role
    using (true)
    with check (true);
