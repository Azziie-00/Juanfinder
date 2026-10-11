-- One-time JUAN-AI capstone generation quota.
-- Run this script in Supabase SQL Editor before deploying the related API changes.
-- The server uses the Supabase service-role client; browser clients must not access this table or its RPCs.

create table if not exists public.ai_user_ai_usage (
    user_id bigint primary key references public.users(user_id) on delete cascade,
    status text not null default 'available'
        check (status in ('available', 'generating', 'disabled')),
    generated_titles jsonb not null default '[]'::jsonb
        check (jsonb_typeof(generated_titles) = 'array'),
    disabled_at timestamptz,
    updated_at timestamptz not null default now()
);

alter table public.ai_user_ai_usage enable row level security;
revoke all on table public.ai_user_ai_usage from anon, authenticated;
grant all on table public.ai_user_ai_usage to service_role;

create or replace function public.claim_ai_title_generation(p_user_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.ai_user_ai_usage (user_id, status)
    values (p_user_id, 'available')
    on conflict (user_id) do nothing;

    update public.ai_user_ai_usage
    set status = 'generating',
        updated_at = now()
    where user_id = p_user_id
      and status = 'available';

    return found;
end;
$$;

create or replace function public.complete_ai_title_generation(
    p_user_id bigint,
    p_titles jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    if jsonb_typeof(p_titles) <> 'array' or jsonb_array_length(p_titles) <> 3 then
        return false;
    end if;

    update public.ai_user_ai_usage
    set status = 'disabled',
        generated_titles = p_titles,
        disabled_at = now(),
        updated_at = now()
    where user_id = p_user_id
      and status = 'generating';

    return found;
end;
$$;

create or replace function public.release_ai_title_generation(p_user_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.ai_user_ai_usage
    set status = 'available',
        updated_at = now()
    where user_id = p_user_id
      and status = 'generating';

    return found;
end;
$$;

revoke all on function public.claim_ai_title_generation(bigint) from public, anon, authenticated;
revoke all on function public.complete_ai_title_generation(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.release_ai_title_generation(bigint) from public, anon, authenticated;

grant execute on function public.claim_ai_title_generation(bigint) to service_role;
grant execute on function public.complete_ai_title_generation(bigint, jsonb) to service_role;
grant execute on function public.release_ai_title_generation(bigint) to service_role;
