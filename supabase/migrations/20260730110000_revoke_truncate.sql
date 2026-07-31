-- ============================================================
-- 監査指摘 #13: TRUNCATE 等の過剰権限を剥奪（ハードニング）
--
-- 背景: Supabase のデフォルト権限（pg_default_acl）は、postgres / supabase_admin が
--       作成したテーブルに対し anon・authenticated へ arwdDxtm を一括付与する。
--       このうち D=TRUNCATE / x=REFERENCES / t=TRIGGER はアプリが一切必要としない上、
--       **TRUNCATE は RLS を迂回する**（行単位のポリシーが評価されない）。
--
-- 実害の評価: PostgREST は TRUNCATE を呼ぶ経路を持たないため現実の悪用可能性は低い。
--             ただし多層防御として、認可の穴は原理的に塞いでおく。
--
-- 対応: ①既存の全テーブル/ビューから剥奪 ②今後作るテーブルにも付かないよう既定を変更
-- ============================================================

-- ① 既存オブジェクト
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- ② 今後 postgres が作成するテーブル（マイグレーションはこのロールで実行される）
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- 参考: アプリが実際に必要とするのは select / insert / update / delete のみで、
--       それらは各テーブルの明示 GRANT（20260706010000_explicit_grants.sql 以降）で
--       個別に付与している。本剥奪によって機能が失われることはない。
