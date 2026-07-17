-- ============================================================
-- 2026-07-12 オーナー決定: R1改定「登録可能年齢は男女とも35歳以上」
--   旧: 女性35歳以上・男性45歳以上
--   理由: 35歳女性から見て最年少の男性が10歳上では登録動機を損なう。
--         年齢で強く区切らない方針（ラス恋型にしない）。
--   既存データへの影響なし（現会員は全員35歳以上のため制約違反は発生しない）
-- ============================================================

alter table profiles drop constraint profiles_min_age_check;

alter table profiles add constraint profiles_min_age_check check (
  birth_date <= (current_date - interval '35 years')
);
