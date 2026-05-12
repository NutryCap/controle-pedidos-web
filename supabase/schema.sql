-- SCHEMA COMPLETO - CONTROLE DE PEDIDOS
-- Execute no Supabase > SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  nome text not null,
  perfil text not null check (
    perfil in ('representante','supervisor','admin','assistente_vendas','gerente_expedicao')
  ),
  representante_codigo text,
  supervisor_codigo text,
  criado_em timestamptz default now()
);

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  seq text not null unique,
  cliente text,
  representante text,
  status integer default 1,
  status_texto text,
  entrada date,
  total numeric,
  observacao text,
  entregue boolean not null default false,
  entregue_em timestamptz,
  entregue_por uuid references public.usuarios(id),
  prazo_final date,
  dias_uteis_restantes integer,
  situacao_prazo text,
  mensagem_prazo text,
  atualizado_em timestamptz default now()
);

create table if not exists public.historico_pedidos (
  id bigint generated always as identity primary key,
  seq text not null,
  acao text not null,
  usuario_id uuid references public.usuarios(id),
  detalhes jsonb,
  criado_em timestamptz default now()
);

alter table public.pedidos
add column if not exists status_texto text,
add column if not exists entrada date,
add column if not exists observacao text,
add column if not exists prazo_final date,
add column if not exists dias_uteis_restantes integer,
add column if not exists situacao_prazo text,
add column if not exists mensagem_prazo text,
add column if not exists atualizado_em timestamptz default now(),
add column if not exists entregue_em timestamptz,
add column if not exists entregue_por uuid references public.usuarios(id);

alter table public.pedidos alter column status drop not null;
alter table public.pedidos alter column status set default 1;

-- Migração caso existam colunas antigas
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pedidos' AND column_name = 'data_entrada'
  ) THEN
    EXECUTE 'update public.pedidos set entrada = data_entrada::date where entrada is null and data_entrada is not null';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pedidos' AND column_name = 'obs'
  ) THEN
    EXECUTE 'update public.pedidos set observacao = obs where observacao is null and obs is not null';
  END IF;
END $$;

create or replace function public.meu_perfil()
returns text
language sql
stable
security definer
as $$
  select perfil from public.usuarios where id = auth.uid();
$$;

create or replace function public.meu_representante()
returns text
language sql
stable
security definer
as $$
  select representante_codigo from public.usuarios where id = auth.uid();
$$;

alter table public.usuarios enable row level security;
alter table public.pedidos enable row level security;
alter table public.historico_pedidos enable row level security;

drop policy if exists usuarios_leem_proprio on public.usuarios;
create policy usuarios_leem_proprio on public.usuarios
for select using (
  id = auth.uid()
  or public.meu_perfil() in ('admin','supervisor')
);

drop policy if exists pedidos_select_por_perfil on public.pedidos;
create policy pedidos_select_por_perfil on public.pedidos
for select using (
  public.meu_perfil() in ('admin','supervisor','assistente_vendas','gerente_expedicao')
  or (public.meu_perfil() = 'representante' and representante = public.meu_representante())
);

drop policy if exists pedidos_upload_assistente on public.pedidos;
create policy pedidos_upload_assistente on public.pedidos
for insert with check (
  public.meu_perfil() in ('admin','assistente_vendas')
);

drop policy if exists pedidos_update_assistente_gerente on public.pedidos;
create policy pedidos_update_assistente_gerente on public.pedidos
for update using (
  public.meu_perfil() in ('admin','assistente_vendas','gerente_expedicao')
)
with check (
  public.meu_perfil() in ('admin','assistente_vendas','gerente_expedicao')
);

drop policy if exists historico_select on public.historico_pedidos;
create policy historico_select on public.historico_pedidos
for select using (
  public.meu_perfil() in ('admin','supervisor','assistente_vendas','gerente_expedicao')
);

drop policy if exists historico_insert on public.historico_pedidos;
create policy historico_insert on public.historico_pedidos
for insert with check (auth.uid() is not null);
