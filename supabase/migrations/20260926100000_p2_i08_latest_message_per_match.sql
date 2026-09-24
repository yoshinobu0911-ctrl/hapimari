-- I08（PR#1 統合指摘表）: メッセージ一覧のプレビュー用。呼び出し者のマッチごとに最新メッセージ1件を返す。
-- 旧実装（messages.tsx で全件取得→先頭を選ぶ）は PostgREST の max_rows=1000 で無言に打ち切られ、
-- 古い会話のプレビューが「マッチしました」に化けていた。
-- 設計: docs/design/2026-09-24_P2必須6件_設計提案.md I08 節
--
-- security invoker: matches / messages の既存 RLS（当事者のみ閲覧可）がそのまま効く。
-- ブロック・退会相手のマッチも従来どおり返す（messages の SELECT RLS は当事者判定のみのため）。
-- WHERE の当事者条件は必須（RLS を素通りする service_role / postgres 向けの多層防御）。
create or replace function public.get_my_latest_messages()
returns table (match_id uuid, body text, created_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select m.id, lm.body, lm.created_at
  from public.matches m
  cross join lateral (
    select msg.body, msg.created_at
    from public.messages msg
    where msg.match_id = m.id
    order by msg.created_at desc
    limit 1
  ) lm
  where m.user_a = auth.uid() or m.user_b = auth.uid();
$$;

comment on function public.get_my_latest_messages() is
  'メッセージ一覧のプレビュー用。呼び出し者のマッチごとに最新メッセージ1件（本文・時刻）を返す。INVOKERで既存RLSに従い、加えてWHEREで当事者に限定（RLSを素通りするロール向けの多層防御）。メッセージ0件のマッチは行を返さない';

-- 新規関数には PUBLIC の EXECUTE が既定で付くため、必ず明示的に revoke する
revoke execute on function public.get_my_latest_messages() from public, anon;
grant execute on function public.get_my_latest_messages() to authenticated, service_role;
