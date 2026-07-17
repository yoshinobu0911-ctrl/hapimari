-- ============================================================
-- 2026-07-12 オーナー指示による仕様変更
--   1. 通話の即時解禁: 「10通で通話解禁（R5前段）」を撤廃し、
--      マッチ成立後すぐに通話できるようにする（callsのINSERT条件から
--      call_unlocked を外す。matches.call_unlocked 列は残すが未使用になる）
--   2. R3（子持ち理解ゲート）はアプリ側で撤廃（DB変更なし・記録のみ）
-- ============================================================

drop policy "当事者かつ通話解禁済みのみ記録作成可" on calls;

create policy "当事者のみ記録作成可" on calls
  for insert to authenticated
  with check (public.is_match_participant(match_id));
