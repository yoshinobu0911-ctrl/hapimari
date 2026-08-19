-- ============================================================
-- M7.2 権限の穴ふさぎ（docs/design/M7_2_payment_ui_design.md §9-5）
-- 2026-08-19 オーナー承認: 「課金の有無に限らず、利用者が他の利用者の
-- 個人情報を照会できる経路を残さない」方針の一環。
--
-- 問題: is_subscription_active(uuid) は authenticated が任意のユーザーIDを
--       渡して実行でき、「他の会員が課金しているか」を照会できた。
-- 修正: 本人（p_user = auth.uid()）以外の照会は、行の有無にかかわらず
--       false を返す。auth.uid() を持たないサーバー側の実行
--       （service_role・トリガ・pg_cron・migration）は従来どおり判定できる。
--
-- 呼び出し元への影響（すべて確認済み・挙動は変わらない）:
--   can_caller_message()        … auth.uid() 自身を渡すため通る
--   trg_sync_subscription_flag  … Webhook(service_role)実行。auth.uid() は null で通る
--   expire_stale_subscriptions()… pg_cron/postgres 実行。auth.uid() は null で通る
--   アプリ画面                  … このRPCを使わない（自分の subscriptions 行から導出）
-- ============================================================

create or replace function public.is_subscription_active(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or p_user = auth.uid())
     and exists (
       select 1 from subscriptions s
       where s.user_id = p_user
         and s.status in ('active', 'trialing')
         and s.current_period_end is not null
         and s.current_period_end > now()
     );
$$;

comment on function public.is_subscription_active(uuid) is
  '課金判定の単一関数。ログイン利用者は自分の分しか true を得られない（他会員の課金状態は照会不可）';

-- 権限は M7.1 から変更なし（再宣言して固定する）
revoke execute on function public.is_subscription_active(uuid) from public, anon;
grant execute on function public.is_subscription_active(uuid) to authenticated, service_role;
