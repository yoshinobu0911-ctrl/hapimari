-- ============================================================
-- 価値観タグ（相性判定の中核・discoverカード刷新に伴う追加）
-- タグの辞書は packages/shared/src/value_tags.ts が正とし、DBは text[] で保持する
-- ============================================================

alter table profiles add column value_tags text[] not null default '{}';

-- カラム単位GRANT（init migration の方針に合わせて追加カラムぶんを明示付与）
grant insert (value_tags) on public.profiles to authenticated;
grant update (value_tags) on public.profiles to authenticated;
