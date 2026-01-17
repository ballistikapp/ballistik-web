-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.daily_pnl_snapshots (
  id bigint NOT NULL DEFAULT nextval('daily_pnl_snapshots_id_seq'::regclass),
  project_id bigint NOT NULL,
  date date NOT NULL,
  total_sol_balance numeric NOT NULL DEFAULT 0,
  total_token_value numeric NOT NULL DEFAULT 0,
  total_invested numeric NOT NULL DEFAULT 0,
  total_realized_pnl numeric NOT NULL DEFAULT 0,
  total_unrealized_pnl numeric NOT NULL DEFAULT 0,
  total_pnl numeric NOT NULL DEFAULT 0,
  wallets_scanned integer NOT NULL DEFAULT 0,
  snapshot_data jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT daily_pnl_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT daily_pnl_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.failed_fees (
  id bigint NOT NULL DEFAULT nextval('failed_fees_id_seq'::regclass),
  funder_secret_key text NOT NULL,
  funder_wallet_id bigint NOT NULL,
  sol_amount numeric NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT failed_fees_pkey PRIMARY KEY (id),
  CONSTRAINT failed_fees_funder_wallet_id_fkey FOREIGN KEY (funder_wallet_id) REFERENCES public.wallets(id)
);
CREATE TABLE public.pnl_statistics (
  id bigint NOT NULL DEFAULT nextval('pnl_statistics_id_seq'::regclass),
  wallet_id bigint NOT NULL,
  mint_address text NOT NULL,
  total_invested numeric NOT NULL DEFAULT 0,
  total_realized_pnl numeric NOT NULL DEFAULT 0,
  unrealized_pnl numeric NOT NULL DEFAULT 0,
  current_value numeric NOT NULL DEFAULT 0,
  current_price numeric,
  roi_percentage numeric,
  yield_rate numeric,
  last_calculated timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT pnl_statistics_pkey PRIMARY KEY (id),
  CONSTRAINT pnl_statistics_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id)
);
CREATE TABLE public.positions (
  id bigint NOT NULL DEFAULT nextval('positions_id_seq'::regclass),
  wallet_id bigint NOT NULL,
  token_balance numeric NOT NULL DEFAULT 0,
  total_buy_amount numeric NOT NULL DEFAULT 0,
  total_sell_amount numeric NOT NULL DEFAULT 0,
  average_buy_price numeric,
  last_transaction_signature text,
  last_updated timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  project_id bigint,
  mint_address text,
  token_name text,
  token_symbol text,
  token_image_url text,
  token_decimals integer,
  CONSTRAINT positions_pkey PRIMARY KEY (id),
  CONSTRAINT positions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id),
  CONSTRAINT positions_project_fk FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.projects (
  id bigint NOT NULL DEFAULT nextval('projects_id_seq'::regclass),
  user_id uuid NOT NULL,
  funder_wallet_id bigint NOT NULL,
  dev_wallet_id bigint NOT NULL,
  mint_address text NOT NULL UNIQUE,
  name text,
  token_name text,
  token_symbol text NOT NULL,
  secret_key text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT projects_pkey PRIMARY KEY (id),
  CONSTRAINT projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT projects_funder_wallet_id_fkey FOREIGN KEY (funder_wallet_id) REFERENCES public.wallets(id),
  CONSTRAINT projects_dev_wallet_id_fkey FOREIGN KEY (dev_wallet_id) REFERENCES public.wallets(id)
);
CREATE TABLE public.transactions (
  id bigint NOT NULL DEFAULT nextval('transactions_id_seq'::regclass),
  wallet_id bigint NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type = ANY (ARRAY['buy'::text, 'sell'::text, 'create'::text])),
  transaction_signature text NOT NULL,
  sol_amount numeric NOT NULL,
  token_amount numeric NOT NULL,
  price_per_token numeric NOT NULL,
  slippage_bps integer,
  fee_amount numeric,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'failed'::text])),
  bundle_id text,
  block_time timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  project_id bigint,
  mint_address text,
  CONSTRAINT transactions_pkey PRIMARY KEY (id),
  CONSTRAINT transactions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id),
  CONSTRAINT transactions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.vanity_mint_tokens (
  id bigint NOT NULL DEFAULT nextval('vanity_mint_tokens_id_seq'::regclass),
  private_key text NOT NULL,
  public_key text NOT NULL,
  suffix text NOT NULL,
  project_id bigint,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  used_at timestamp with time zone,
  CONSTRAINT vanity_mint_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT vanity_mint_tokens_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.wallets (
  id bigint NOT NULL DEFAULT nextval('wallets_id_seq'::regclass),
  type text NOT NULL CHECK (type = ANY (ARRAY['bundler'::text, 'volume'::text, 'distribution'::text, 'funding'::text, 'dev'::text])),
  user_id uuid,
  project_id bigint,
  public_key text NOT NULL UNIQUE,
  private_key text NOT NULL,
  session_id text,
  bot_session_id text,
  status text NOT NULL DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'stopped'::text, 'reclaimed'::text, 'error'::text, 'failed'::text])),
  initial_balance_sol numeric DEFAULT 0,
  current_balance_sol numeric DEFAULT 0,
  reclaimed_amount_sol numeric,
  reclaim_tx_signature text,
  reclaimed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT wallets_pkey PRIMARY KEY (id),
  CONSTRAINT wallets_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);