-- ============================================================
-- M7.1 Stripe決済の本実装（サーバー側）
-- 設計書: docs/design/M7_1_payment_design.md（2026-08-11 オーナー承認済み）
--
--   1. subscriptions テーブル新設（課金の唯一の正）
--   2. stripe_events テーブル新設（Webhookの冪等処理）
--   3. profiles.subscription_active を「派生値」に降格し、トリガで自動同期
--   4. 課金判定を is_subscription_active() に一本化（期限を必ず評価する）
--   5. messages の INSERT ポリシーを can_caller_message() 経由に統一
--   6. モック課金RPC purchase_subscription を削除（無料で有料化できる裏口を塞ぐ）
--   7. 期限切れの掃除（pg_cron・日次）
--
-- 設計の要点:
--   ・利用者は subscriptions を **一切書き換えられない**（INSERT/UPDATE/DELETE をGRANTしない）。
--     有料になれる経路は Stripe Webhook（service_role）だけ。
--   ・Webhookを取りこぼしても current_period_end を毎回評価するため、期限が切れれば
--     自動的に送信不可へ戻る（フェイルセーフ）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. subscriptions
-- ------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id     text not null,
  stripe_subscription_id text unique,
  plan                   text not null check (plan in ('male_1m', 'male_3m', 'male_6m')),
  -- Stripe の subscription.status をそのまま保持する（独自の状態機械を作らない）
  status                 text not null default 'incomplete'
                           check (status in (
                             'incomplete', 'incomplete_expired', 'trialing', 'active',
                             'past_due', 'canceled', 'unpaid', 'paused'
                           )),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists subscriptions_stripe_customer_id_key
  on public.subscriptions (stripe_customer_id);

comment on table public.subscriptions is
  '課金の唯一の正。書き込みは Stripe Webhook（service_role）のみ。profiles.subscription_active はここからの派生値';
comment on column public.subscriptions.current_period_end is
  'この日時までは有料機能を利用できる。解約予約時もこの日時までは利用可';

alter table public.subscriptions enable row level security;

-- 閲覧は本人の行のみ
create policy "本人のみ自分の契約を閲覧可" on public.subscriptions
  for select to authenticated
  using (user_id = auth.uid());

-- 列単位GRANT: Stripe側の識別子（customer/subscription ID）は利用者に渡さない
revoke all on table public.subscriptions from anon, authenticated;
grant select (
  user_id, plan, status, current_period_end, cancel_at_period_end, created_at, updated_at
) on public.subscriptions to authenticated;
-- INSERT / UPDATE / DELETE は authenticated に与えない（＝自分で有料にできない）
grant all on table public.subscriptions to service_role;

-- ------------------------------------------------------------
-- 2. stripe_events（冪等性）
--    Stripe は同じイベントを再送することがある。処理済みIDを記録して二重処理を防ぐ。
--    ペイロードは保存しない（カード情報・個人情報をDBに増やさないため）。
-- ------------------------------------------------------------
create table if not exists public.stripe_events (
  id           text primary key,   -- Stripe の event.id（evt_...）
  type         text not null,
  received_at  timestamptz not null default now()
);
alter table public.stripe_events enable row level security; -- ポリシー無し = 利用者からは不可視
revoke all on table public.stripe_events from anon, authenticated;
grant all on table public.stripe_events to service_role;

-- ------------------------------------------------------------
-- 3. 課金判定の単一関数
--    「status が有効」かつ「期限が未来」の両方を満たすときだけ true。
-- ------------------------------------------------------------
create or replace function public.is_subscription_active(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from subscriptions s
    where s.user_id = p_user
      and s.status in ('active', 'trialing')
      and s.current_period_end is not null
      and s.current_period_end > now()
  );
$$;
revoke execute on function public.is_subscription_active(uuid) from public, anon;
grant execute on function public.is_subscription_active(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 4. profiles.subscription_active の自動同期
--    既存の RLS・UI・admin が広く参照しているため列は残し、派生値として維持する。
-- ------------------------------------------------------------
create or replace function public._sync_subscription_flag()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  -- DELETE では NEW が未割り当てのため、TG_OP で明示的に振り分ける
  if tg_op = 'DELETE' then
    target := old.user_id;
  else
    target := new.user_id;
  end if;

  update profiles
     set subscription_active = public.is_subscription_active(target)
   where id = target;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_subscription_flag on public.subscriptions;
create trigger trg_sync_subscription_flag
  after insert or update or delete on public.subscriptions
  for each row execute function public._sync_subscription_flag();

-- ------------------------------------------------------------
-- 5. 課金ゲートを新方式へ差し替え
--    5-1. can_caller_message()（M6.6 の単一認可ヘルパ）
--    5-2. messages の INSERT ポリシー（従来 subscription_active をインライン参照していた）
--    ※ M6.6 のトリガ _enforce_message_entitlement は can_caller_message を見ているため自動追従する
-- ------------------------------------------------------------
create or replace function public.can_caller_message()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and status = 'active'
      and is_verified = true
      and (gender = 'female' or public.is_subscription_active(auth.uid()))
  );
$$;
revoke execute on function public.can_caller_message() from public, anon;
grant execute on function public.can_caller_message() to authenticated, service_role;

drop policy if exists "当事者・本人確認済み・非ブロック・男性は課金済みのみ送信可" on public.messages;
create policy "当事者・非ブロック・送信資格ありのみ送信可" on public.messages
  for insert to authenticated
  with check (
    sender = auth.uid()
    and public.is_match_participant(match_id)
    and not public.is_match_blocked(match_id)
    and public.can_caller_message()
  );

-- ------------------------------------------------------------
-- 6. モック課金RPCの削除
--    これが残っている限り「1円も払わずに有料になれる」経路が開いたままになる。
--    ※ apps/mobile/src/lib/payment.ts はこのRPCを呼んでいるため、
--      M7.2（画面改修）までは有料プラン画面の登録ボタンがエラーになる。設計書 §8-2 に記載。
-- ------------------------------------------------------------
drop function if exists public.purchase_subscription(text);

-- 既存のモック課金フラグを一度リセットする（払っていないのに有料の状態を残さない）
-- 開発用シードは seed.sql が subscriptions に有効行を作り直す。
update public.profiles set subscription_active = false where subscription_active = true;

-- ------------------------------------------------------------
-- 7. 期限切れの掃除（表示用の整合。ゲート本体は is_subscription_active が担う）
--    更新直後のWebhook遅延で誤って解約扱いにしないよう3日の猶予を置く。
-- ------------------------------------------------------------
create or replace function public.expire_stale_subscriptions()
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  n integer;
begin
  update subscriptions
     set status = 'canceled', updated_at = now()
   where status in ('active', 'trialing')
     and current_period_end is not null
     and current_period_end <= now() - interval '3 days';
  get diagnostics n = row_count;

  -- Webhook取りこぼし対策: フラグと実態のズレを一括で直す
  update profiles p
     set subscription_active = public.is_subscription_active(p.id)
   where p.subscription_active is distinct from public.is_subscription_active(p.id);

  return n;
end $$;
revoke execute on function public.expire_stale_subscriptions() from public, anon, authenticated;
grant execute on function public.expire_stale_subscriptions() to service_role;

-- pg_cron: 毎日 3:10 JST（18:10 UTC）。拡張が無い環境ではスキップ（daily_stats と同じ方針）
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'hapimari-expire-subscriptions',
    '10 18 * * *',
    $job$select public.expire_stale_subscriptions();$job$
  );
exception when others then
  raise notice 'pg_cron の設定をスキップしました（手動実行で代替）: %', sqlerrm;
end;
$$;
