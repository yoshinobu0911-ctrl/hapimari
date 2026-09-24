-- I39（PR#1 統合指摘表・Sonnet S4）: 通話記録 calls の INSERT に「呼び出し者が本人確認済み」を追加する。
-- 通話トークン（agora-token）は双方の本人確認を必須にしているが、calls の INSERT ポリシーは
-- is_verified を見ておらず、本人確認前の利用者が REST で「通話した」記録を作れた。
-- 設計: docs/design/2026-09-26_I39_設計提案.md
--
-- 旧ポリシー（20260730100000_m6_6_audit_fixes.sql）を if exists なしで drop する
-- （名前が合わなければ migration ごと失敗させる）。
drop policy "当事者・active・非ブロックのみ記録作成可" on public.calls;
create policy "当事者・active・本人確認済み・非ブロックのみ記録作成可" on public.calls
  for insert to authenticated
  with check (
    public.is_match_participant(match_id)
    and not public.is_match_blocked(match_id)
    and public.is_caller_active()
    -- 本人確認済み（profiles の本人行は SELECT ポリシーで読める。新しい関数は作らない）
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_verified)
  );
