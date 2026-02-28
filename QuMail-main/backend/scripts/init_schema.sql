create extension if not exists pgcrypto;

create table if not exists public.gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  email text not null unique,
  access_token text not null,
  refresh_token text,
  token_expiry timestamptz,
  history_id text,
  connected_at timestamptz default now(),
  last_sync_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists public.gmail_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.gmail_accounts(id) on delete cascade,
  gmail_message_id text not null,
  thread_id text,
  subject text,
  from_email text,
  from_raw text,
  snippet text,
  labels text[] default '{}',
  is_unread boolean default false,
  internal_ts timestamptz,
  payload jsonb,
  last_synced_at timestamptz default now(),
  unique(account_id, gmail_message_id)
);

create index if not exists idx_gmail_messages_account_id on public.gmail_messages(account_id);
create index if not exists idx_gmail_messages_internal_ts on public.gmail_messages(internal_ts desc);
