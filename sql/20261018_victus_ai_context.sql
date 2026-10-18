-- Private, bot-only knowledge and conversation memory. Apply with the ticket AI migration.
create table if not exists public.victus_ai_knowledge (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  source_type text not null check (source_type in ('staff_ticket', 'staff_command')),
  source_id text not null,
  ticket_id uuid references public.tickets(id) on delete set null,
  title text not null,
  question text not null,
  answer text not null,
  category text not null,
  created_by text,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as
    (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(question, '') || ' ' || coalesce(answer, ''))) stored,
  unique (source_type, source_id)
);
create index if not exists victus_ai_knowledge_search_idx on public.victus_ai_knowledge using gin (search_vector);
create index if not exists victus_ai_knowledge_guild_idx on public.victus_ai_knowledge (guild_id, created_at desc);
alter table public.victus_ai_knowledge enable row level security;
revoke all on public.victus_ai_knowledge from anon, authenticated;
grant select, insert, update, delete on public.victus_ai_knowledge to service_role;

create table if not exists public.victus_ai_memory (
  id bigint generated always as identity primary key,
  user_id text not null,
  session_id text not null,
  scope text not null check (scope in ('public', 'private')),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored
);
create index if not exists victus_ai_memory_user_idx on public.victus_ai_memory (user_id, scope, created_at desc);
create index if not exists victus_ai_memory_search_idx on public.victus_ai_memory using gin (search_vector);
alter table public.victus_ai_memory enable row level security;
revoke all on public.victus_ai_memory from anon, authenticated;
grant select, insert, update, delete on public.victus_ai_memory to service_role;
grant usage, select on sequence public.victus_ai_memory_id_seq to service_role;

create table if not exists public.victus_ai_learning_seen (
  message_id uuid primary key references public.ticket_messages(id) on delete cascade,
  processed_at timestamptz not null default now()
);
create index if not exists ticket_messages_staff_learning_idx
  on public.ticket_messages (created_at, id) where author_is_staff = true;
alter table public.victus_ai_learning_seen enable row level security;
revoke all on public.victus_ai_learning_seen from anon, authenticated;
grant select, insert on public.victus_ai_learning_seen to service_role;

create or replace function public.victus_ai_unlearned_ticket_messages(p_limit integer default 40)
returns table (message_id uuid, ticket_id uuid, guild_id text, subject text,
  description text, category text, question text, answer text)
language sql stable security definer set search_path = public as $$
  select m.id, t.id, t.guild_id, t.subject, t.description,
         coalesce(c.name, 'Support'), coalesce(q.content, t.description), m.content
  from public.ticket_messages m
  join public.tickets t on t.id = m.ticket_id
  left join public.ticket_categories c on c.id = t.category_id
  left join lateral (
    select prior.content from public.ticket_messages prior
    where prior.ticket_id = m.ticket_id and prior.author_is_staff = false
      and prior.author_discord_id not like 'ai:%'
      and prior.author_discord_id not like 'system:%'
      and (prior.created_at, prior.id) < (m.created_at, m.id)
    order by prior.created_at desc, prior.id desc limit 1
  ) q on true
  where m.author_is_staff = true
    and m.author_discord_id not like 'ai:%'
    and m.author_discord_id not like 'system:%'
    and not exists (select 1 from public.victus_ai_learning_seen s where s.message_id = m.id)
  order by m.created_at, m.id
  limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.victus_ai_unlearned_ticket_messages(integer) from public, anon, authenticated;
grant execute on function public.victus_ai_unlearned_ticket_messages(integer) to service_role;

create or replace function public.victus_ai_search_knowledge(p_guild_id text, p_query text, p_limit integer default 6)
returns table (id uuid, source_type text, title text, question text, answer text)
language sql stable security definer set search_path = public as $$
  select k.id, k.source_type, k.title, k.question, k.answer
  from public.victus_ai_knowledge k
  where k.guild_id = p_guild_id
    and k.search_vector @@ websearch_to_tsquery('english', left(p_query, 500))
  order by ts_rank(k.search_vector, websearch_to_tsquery('english', left(p_query, 500))) desc,
           case when k.source_type = 'staff_command' then 1 else 0 end desc,
           k.created_at desc
  limit least(greatest(p_limit, 1), 10);
$$;
revoke all on function public.victus_ai_search_knowledge(text, text, integer) from public, anon, authenticated;
grant execute on function public.victus_ai_search_knowledge(text, text, integer) to service_role;

create or replace function public.victus_ai_search_memory(p_user_id text, p_scope text, p_query text, p_limit integer default 12)
returns table (id bigint, session_id text, role text, content text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.session_id, m.role, m.content, m.created_at
  from public.victus_ai_memory m
  where m.user_id = p_user_id and m.scope = p_scope
    and m.search_vector @@ websearch_to_tsquery('english', left(p_query, 500))
  order by ts_rank(m.search_vector, websearch_to_tsquery('english', left(p_query, 500))) desc,
           m.created_at desc
  limit least(greatest(p_limit, 1), 20);
$$;
revoke all on function public.victus_ai_search_memory(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.victus_ai_search_memory(text, text, text, integer) to service_role;
