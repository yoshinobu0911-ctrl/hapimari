-- ============================================================
-- 明示的な権限付与（M1で発覚した問題への対応）
--
-- 現行の Supabase ローカルスタック（CLI 2.109 / npm版）では、
-- 旧来の「public スキーマのテーブルに anon/authenticated/service_role へ
-- DML を自動GRANT」が適用されず、REFERENCES/TRIGGER/TRUNCATE しか付かない。
-- そのため RLS ポリシーに対応する最小権限をここで明示的に付与する。
-- （行レベルの制御は 20260705100000_init.sql の RLS ポリシーが担う）
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

-- service_role: 管理画面（apps/admin）と Edge Functions 用。RLSはバイパスするが
-- SQLレベルの権限は必要
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

-- authenticated: RLSポリシーと対になる最小権限
-- （INSERT/UPDATE のカラム単位GRANTは init migration で付与済み）
grant select on public.profiles to authenticated;
grant select on public.likes to authenticated;
grant select on public.matches to authenticated;
grant select on public.messages to authenticated;
grant select, insert, update on public.date_proposals to authenticated;
grant select, insert, update on public.calls to authenticated;

-- verifications / reports は SPEC どおり「閲覧・更新は service_role のみ」。
-- authenticated には INSERT（カラム単位・init で付与済み）以外を与えない。

-- daily_stats は service_role / pg_cron のみ（authenticated への権限なし）
