-- TROPICAURA — Tour de contrôle : schéma de la base (Postgres / Supabase).
-- Les tables ont été créées par l'outillage de construction ; ce fichier les documente et
-- permet de les recréer.

create table if not exists categories (
  id text primary key,
  label text not null,
  illustration_product text,
  image_url text,
  image_ratio double precision default 1,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists products (
  id text primary key,
  name text not null,
  variety text default '',
  category text not null references categories(id) on delete restrict,
  origin text default '',
  description text default '',
  photo_asset text,              -- photo embarquée dans l'application (assets/produce/<clé>.webp)
  photo_url text,                -- photo publiée depuis l'administration
  photo_ratio double precision default 1,
  tint text default '#7AAA2C',
  months jsonb default '[]'::jsonb,
  available boolean not null default false,
  archived boolean not null default false,
  bio boolean not null default false,
  rating numeric default 0,
  reviews integer default 0,
  retail jsonb,                  -- RetailOffer de lib/catalog/schema.ts, ou null
  wholesale jsonb default '[]'::jsonb, -- WholesaleOffer[]
  is_example boolean not null default false,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  updated_by text                -- identifiant du compte, jamais une adresse e-mail
);

create table if not exists settings (
  key text primary key,          -- 'rules' | 'compat' | 'link' | 'audience' (rayons masqués aux pros) | 'filters' (Tout, De saison)
  value jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists seals (
  ref text primary key,          -- '<table>:<identifiant>'
  sig text not null,             -- empreinte HMAC posée par le serveur
  sealed_at timestamptz default now()
);

create table if not exists journal (
  id serial primary key,
  at timestamptz not null default now(),
  user_id text,
  action text,
  entity text,
  entity_id text,
  summary text,
  sig text
);

-- Espace commandes. `enc` : la commande entière, chiffrée par le serveur (AES-256-GCM).
create table if not exists orders (
  id text primary key,
  received_at timestamptz not null default now(),
  enc text not null
);

-- Publications de l'équipe : vidéos de « Découvrir » et annonces du bandeau d'accueil.
create table if not exists publications (
  id text primary key,
  kind text not null,            -- 'video' | 'annonce'
  data jsonb not null,
  published boolean not null default false,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Stockage : compartiment public « publications » (vidéos MP4/WebM/MOV et aperçus, 50 Mo).

-- Stockage : compartiment public « catalogue » (image/webp, image/png, image/jpeg, 3 Mo).

create table if not exists packagings (
  id text primary key,            -- identifiant du produit
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);
alter table packagings enable row level security;

create table if not exists zones (
  id text primary key,            -- identifiant du produit ; sans ligne : monde entier
  zone jsonb not null,            -- { "mode": "all" | "sn" | "except", "except": ["FR", …] }
  updated_at timestamptz default now()
);
alter table zones enable row level security;

-- Limite par visiteur (routes publiques). `key` = « <usage>:<empreinte salée de l'adresse réseau> » ;
-- aucune adresse n'est gardée en clair. Les lignes de plus d'une heure sont effacées au fil de l'eau.
create table if not exists rate_hits (
  id bigserial primary key,
  key text not null,
  at timestamptz not null default now()
);
create index if not exists rate_hits_key_at on rate_hits (key, at);
alter table rate_hits enable row level security;

-- Produits introuvables : un client a cherché un produit absent du catalogue (api/orders.js,
-- `type: 'produit_introuvable'`). `enc` : la demande entière, chiffrée par le serveur (AES-256-GCM).
create table if not exists product_requests (
  id text primary key,
  received_at timestamptz not null default now(),
  enc text not null
);
alter table product_requests enable row level security;

-- Vues, J'aime et commentaires des vidéos et publications photo (api/publications.js,
-- `?public=reactions`). Une ligne par geste ; aucun e-mail ni téléphone.
create table if not exists publication_reactions (
  id bigserial primary key,
  publication_id text not null,
  kind text not null,             -- 'view' | 'like' | 'comment'
  account_id text not null,
  account_name text default '',
  account_type text default 'particulier',
  body text default '',           -- texte du commentaire
  client_id text default '',      -- identifiant du commentaire côté application
  at timestamptz default now(),
  created_at timestamptz not null default now()
);
create index if not exists publication_reactions_account on publication_reactions (account_id);
create index if not exists publication_reactions_pub on publication_reactions (publication_id);
alter table publication_reactions enable row level security;

-- Paniers en cours (api/orders.js, `type: 'panier'` ; GET `?vue=paniers`). Un panier par compte,
-- remplacé à chaque envoi de l'application. `enc` : le panier entier (client, lignes, totaux),
-- chiffré par le serveur comme les commandes. `updated_at` : dernière modification du panier.
-- `status` : 'actif' | 'commande' (l'état « abandonné » se calcule à la lecture).
create table if not exists carts (
  account_id text primary key,
  enc text not null,
  updated_at timestamptz not null default now(),
  status text not null default 'actif'
);
alter table carts enable row level security;
revoke all on carts from anon, authenticated;

-- ───────────── Sécurité par ligne — À EXÉCUTER À LA MAIN avant une mise en production.
-- Sans politique, seule la clé de service (routes /api) accède aux tables.
alter table categories enable row level security;
alter table products   enable row level security;
alter table settings   enable row level security;
alter table seals      enable row level security;
alter table journal    enable row level security;
alter table orders     enable row level security;
alter table publications enable row level security;

-- ───────────── Tables laissées par la mise en place, inutilisées : à supprimer.
drop table if exists admin_users;
drop table if exists activity_log;
drop table if exists rls_probe;
