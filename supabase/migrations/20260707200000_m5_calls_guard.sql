-- ============================================================
-- M5: 通話ログのRLS強化（docs/design/M5_design.md §3・オーナー承認済み）
--   R5（message_count>=10 で通話解禁）をサーバ側でも担保する。
--   通話ボタンのUI非表示に加え、未解禁マッチへの calls INSERT をDBレベルで拒否。
-- ============================================================

drop policy "当事者のみ記録作成可" on calls;

create policy "当事者かつ通話解禁済みのみ記録作成可" on calls
  for insert to authenticated
  with check (
    public.is_match_participant(match_id)
    and exists (select 1 from matches where id = match_id and call_unlocked)
  );
