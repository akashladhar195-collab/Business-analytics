create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  dataset_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.datasets (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  name text not null check (char_length(name) between 1 and 160),
  table_name text not null,
  row_count integer not null check (row_count between 0 and 25000),
  columns jsonb not null default '[]'::jsonb,
  mappings jsonb not null default '{}'::jsonb,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.projects
  drop constraint if exists projects_dataset_id_fkey;
alter table public.projects
  add constraint projects_dataset_id_fkey foreign key (dataset_id) references public.datasets (id) on delete set null;

create table if not exists public.saved_charts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  dataset_id uuid references public.datasets (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  dataset_id uuid references public.datasets (id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.datasets enable row level security;
alter table public.saved_charts enable row level security;
alter table public.reports enable row level security;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile" on public.profiles for select using ((select auth.uid()) = id);
drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile" on public.profiles for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "Users manage their projects" on public.projects;
create policy "Users manage their projects" on public.projects for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage their datasets" on public.datasets;
create policy "Users manage their datasets" on public.datasets for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage their saved charts" on public.saved_charts;
create policy "Users manage their saved charts" on public.saved_charts for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage their reports" on public.reports;
create policy "Users manage their reports" on public.reports for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create index if not exists projects_user_created_idx on public.projects (user_id, created_at desc);
create index if not exists datasets_user_created_idx on public.datasets (user_id, created_at desc);
create index if not exists saved_charts_user_created_idx on public.saved_charts (user_id, created_at desc);
create index if not exists reports_user_created_idx on public.reports (user_id, created_at desc);