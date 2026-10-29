-- ============================================================
-- MIGRAÇÃO 095 — Página de links da bio (estilo Linktree). Cada usuário do CRM cria a própria página.
-- Pública em /l/<endereço>. Só o dono cria/edita; qualquer pessoa lê a página publicada pela função bio_public
-- (links ocultos ou sem endereço não saem) e conta cliques por bio_click / visitas por bio_view.
-- Imagem do destaque: bucket público bio-images (pasta = id do usuário).
-- ============================================================

create table public.bio_pages (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,29}$'),
  title text not null default 'Peregrinos Intercâmbio' check (char_length(title) <= 80),
  subtitle text not null default 'O caminho transforma' check (char_length(subtitle) <= 120),
  instagram text not null default '' check (instagram ~ '^[A-Za-z0-9._]{0,30}$'),
  whatsapp text not null default '' check (whatsapp ~ '^[0-9]{0,15}$'),
  theme text not null default 'falesia' check (theme in ('falesia', 'papel', 'azul')),
  hero_enabled boolean not null default true,
  hero_image_path text,
  hero_title text not null default 'Baixe o app grátis' check (char_length(hero_title) <= 80),
  hero_subtitle text not null default 'Seu intercâmbio na Irlanda, passo a passo' check (char_length(hero_subtitle) <= 140),
  hero_url text not null default 'https://app.peregrinosintercambio.com/#/' check (hero_url = '' or hero_url ~* '^(https?://|mailto:|tel:)'),
  published boolean not null default true,
  views integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bio_pages enable row level security;
create policy "bio_pages: dono lê" on public.bio_pages for select to authenticated using (user_id = auth.uid());
create policy "bio_pages: dono cria" on public.bio_pages for insert to authenticated with check (user_id = auth.uid());
create policy "bio_pages: dono altera" on public.bio_pages for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "bio_pages: dono apaga" on public.bio_pages for delete to authenticated using (user_id = auth.uid());

create table public.bio_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bio_pages(user_id) on delete cascade,
  label text not null default '' check (char_length(label) <= 80),
  url text not null default '' check (url = '' or url ~* '^(https?://|mailto:|tel:)'),
  icon text not null default 'link' check (char_length(icon) <= 20),
  position integer not null default 0,
  enabled boolean not null default true,
  clicks integer not null default 0,
  created_at timestamptz not null default now()
);
create index bio_links_user_idx on public.bio_links (user_id, position);
alter table public.bio_links enable row level security;
create policy "bio_links: dono lê" on public.bio_links for select to authenticated using (user_id = auth.uid());
create policy "bio_links: dono cria" on public.bio_links for insert to authenticated with check (user_id = auth.uid());
create policy "bio_links: dono altera" on public.bio_links for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "bio_links: dono apaga" on public.bio_links for delete to authenticated using (user_id = auth.uid());

create or replace function public.bio_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger bio_pages_touch before update on public.bio_pages for each row execute function public.bio_touch();

-- página pública: só publicada; só links ligados, com título e endereço
create or replace function public.bio_public(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'page', jsonb_build_object(
      'slug', p.slug, 'title', p.title, 'subtitle', p.subtitle, 'instagram', p.instagram, 'whatsapp', p.whatsapp,
      'theme', p.theme, 'hero_enabled', p.hero_enabled, 'hero_image_path', p.hero_image_path,
      'hero_title', p.hero_title, 'hero_subtitle', p.hero_subtitle, 'hero_url', p.hero_url),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'label', l.label, 'url', l.url, 'icon', l.icon) order by l.position, l.created_at)
      from public.bio_links l
      where l.user_id = p.user_id and l.enabled and btrim(l.label) <> '' and l.url <> ''), '[]'::jsonb))
  from public.bio_pages p
  where p.slug = lower(btrim(p_slug)) and p.published;
$$;
grant execute on function public.bio_public(text) to anon, authenticated;

create or replace function public.bio_click(p_link uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.bio_links l set clicks = l.clicks + 1
  where l.id = p_link and l.enabled
    and exists (select 1 from public.bio_pages p where p.user_id = l.user_id and p.published);
$$;
grant execute on function public.bio_click(uuid) to anon, authenticated;

create or replace function public.bio_view(p_slug text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.bio_pages set views = views + 1 where slug = lower(btrim(p_slug)) and published;
$$;
grant execute on function public.bio_view(text) to anon, authenticated;

-- imagens do destaque (bucket público; cada usuário só mexe na própria pasta)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bio-images', 'bio-images', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy "bio-images: leitura pública" on storage.objects for select using (bucket_id = 'bio-images');
create policy "bio-images: dono envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'bio-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "bio-images: dono troca" on storage.objects for update to authenticated
  using (bucket_id = 'bio-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "bio-images: dono apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'bio-images' and (storage.foldername(name))[1] = auth.uid()::text);
