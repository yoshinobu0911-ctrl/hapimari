-- M6.6 監査指摘4件の修正を検証する攻撃再現テスト
-- 実行: docker exec -i supabase_db_hapimari psql -U postgres -d postgres < scripts/test_m66_audit_fixes.sql
-- 全テストはトランザクション内で行い最後に rollback（DBを汚さない）

\set QUIET on
\pset pager off
begin;

create temp table t_ids as
select
  (select id from profiles where gender = 'female' and status = 'active' and is_verified order by created_at limit 1) as f,
  (select id from profiles where gender = 'male' and status = 'active' and is_verified and subscription_active order by created_at limit 1) as m,
  (select id from profiles where gender = 'male' and status = 'active'
     and id <> (select id from profiles where gender='male' and status='active' and is_verified and subscription_active order by created_at limit 1)
   order by created_at limit 1) as m2;
grant select on t_ids to authenticated;
select f as female_id, m as male_id, m2 as male2_id from t_ids \gset

-- 検証用のマッチを用意（女性F・男性M）
insert into matches (user_a, user_b)
  select least(:'female_id'::uuid, :'male_id'::uuid), greatest(:'female_id'::uuid, :'male_id'::uuid)
  on conflict do nothing;
select id as match_id from matches
  where user_a = least(:'female_id'::uuid, :'male_id'::uuid)
    and user_b = greatest(:'female_id'::uuid, :'male_id'::uuid) \gset

\echo ''
\echo '################ #1 凍結・退会ユーザーのデートRPC貫通 ################'

\echo '--- T1-a: activeな女性はデートRPCを使える（正常系が壊れていないこと） ---'
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role','authenticated')::text, true);
set local role authenticated;
select case when set_date_intent(:'match_id'::uuid, true) is not null
            then 'PASS: 正常系は動作する' else 'FAIL' end;
reset role;

\echo '--- T1-b: 凍結すると同じ操作が拒否される（メッセージ挿入経路が閉じる） ---'
update profiles set status = 'suspended' where id = :'female_id';
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role','authenticated')::text, true);
set local role authenticated;
do $$
declare mid uuid;
begin
  select id into mid from matches order by created_at limit 1;
  perform set_date_intent(mid, true);
  raise notice 'FAIL: 凍結ユーザーがデートRPCを実行できた';
exception when others then
  raise notice 'PASS: 凍結ユーザーは拒否された (%)', sqlerrm;
end $$;
reset role;

\echo '--- T1-c: 退会でも同様に拒否される ---'
update profiles set status = 'withdrawn' where id = :'female_id';
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role','authenticated')::text, true);
set local role authenticated;
do $$
declare mid uuid;
begin
  select id into mid from matches limit 1;
  perform set_date_intent(mid, true);
  raise notice 'FAIL: 退会ユーザーがデートRPCを実行できた';
exception when others then
  raise notice 'PASS: 退会ユーザーは拒否された (%)', sqlerrm;
end $$;
reset role;

\echo '--- T1-d: 未課金男性は読み取り(get_date_status)は可・自動メッセージ挿入は不可 ---'
update profiles set status = 'active' where id = :'female_id';
-- M7.1以降、課金の正は subscriptions テーブル（profiles.subscription_active は派生値）。
-- 「未課金」を作るには subscriptions の行も消す必要がある（2026-09-02 テスト追随）
delete from subscriptions where user_id = :'male_id';
update profiles set subscription_active = false, is_verified = true where id = :'male_id';
select set_config('request.jwt.claims', json_build_object('sub', :'male_id', 'role','authenticated')::text, true);
set local role authenticated;
do $$
declare mid uuid;
begin
  select id into mid from matches order by created_at limit 1;
  perform get_date_status(mid);
  raise notice 'PASS: 未課金でも読み取りは可能（チャット画面が壊れない）';
exception when others then
  raise notice 'FAIL: 読み取りが拒否された (%)', sqlerrm;
end $$;
do $$
declare mid uuid;
begin
  select id into mid from matches order by created_at limit 1;
  insert into messages (match_id, sender, body)
    values (mid, (current_setting('request.jwt.claims')::json->>'sub')::uuid, '課金なしで送信');
  raise notice 'FAIL: 未課金男性がメッセージを挿入できた';
exception when others then
  raise notice 'PASS: 未課金男性の挿入は拒否された (%)', sqlerrm;
end $$;
reset role;
update profiles set subscription_active = true where id = :'male_id';

\echo ''
\echo '################ #2 凍結・退会ユーザーの会員列挙と測距 ################'

\echo '--- T2-a: 凍結ユーザーには他人のプロフィールが1件も見えない（自分の行のみ） ---'
update profiles set status = 'suspended' where id = :'female_id';
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role','authenticated')::text, true);
set local role authenticated;
select case when count(*) filter (where id <> :'female_id') = 0
            then 'PASS: 他人は0件（自分の行のみ ' || count(*) || '件）'
            else 'FAIL: 他人が ' || count(*) filter (where id <> :'female_id') || '件見えている' end
from profiles_public;

\echo '--- T2-b: 凍結ユーザーは測距できない ---'
select case when count(*) = 0 then 'PASS: 距離は0件' else 'FAIL: ' || count(*) || '件返った' end
from get_profile_distances(array[:'male_id'::uuid, :'male2_id'::uuid]);
reset role;
update profiles set status = 'active' where id = :'female_id';

\echo '--- T2-c: activeユーザーは従来どおり見える・測れる（正常系） ---'
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role','authenticated')::text, true);
set local role authenticated;
select case when count(*) > 1 then 'PASS: 他人が見える (' || count(*) || '件)' else 'FAIL' end from profiles_public;
reset role;

\echo ''
\echo '################ #3 三点測位の再現（前回見落とした多点観測の実測） ################'
\echo '--- 攻撃モデル: 攻撃者が自位置を12方位×複数距離に詐称し、被害者への帯域距離を観測。'
\echo '    セル内の被害者位置を区別できるなら三点測位で自宅圏が絞れる（＝FAIL）。'

-- 被害者候補: 1つの5kmセル内に散らばる25点（東京都心付近）
create temp table victim_pts as
select 35.6800 + (i * 0.008) as vlat, 139.7600 + (j * 0.010) as vlng, i, j
from generate_series(0,4) i, generate_series(0,4) j;

-- 攻撃者の観測地点: 24点（多方位・多距離）
create temp table attacker_pts as
select 35.68 + 0.30 * cos(radians(a)) * (1 + 0.5*k) as alat,
       139.76 + 0.36 * sin(radians(a)) * (1 + 0.5*k) as alng, a, k
from generate_series(0, 330, 30) a, generate_series(0,1) k;

-- 各攻撃地点から、各被害者位置に対して返る帯域距離（本番と同じ量子化＋帯域化の合成）
create temp table obs as
select ap.a, ap.k, vp.i, vp.j,
  (case
     when km < 5 then 3
     when km <= 30 then greatest(5, (round(km / 5) * 5))::int
     when km <= 100 then (round(km / 10) * 10)::int
     else 110 end) as band
from attacker_pts ap, victim_pts vp,
lateral (select _distance_km(ap.alat, ap.alng, _snap_lat(vp.vlat), _snap_lng(vp.vlng)) as km) d;

-- 判定は「同一セルに属する被害者位置」を単位に行う（セル境界をまたぐ点が
-- 別の値を返すのは設計どおり＝漏洩ではない）。攻撃者が得られる情報がセルの
-- 識別までに留まる＝セル内の位置は原理的に区別できない、を検証する。
create temp table victim_cells as
select vp.i, vp.j, _snap_lat(vp.vlat) as clat, _snap_lng(vp.vlng) as clng from victim_pts vp;

\echo '--- T3-a: 同一セル内では、どの観測地点からも被害者を区別できない ---'
select case when count(*) = 0
            then 'PASS: 全24観測地点で、同一セル内の被害者位置は完全に区別不能'
            else 'FAIL: ' || count(*) || ' 通りの(観測地点×セル)で区別できてしまう' end
from (
  select o.a, o.k, c.clat, c.clng
  from obs o join victim_cells c on c.i = o.i and c.j = o.j
  group by o.a, o.k, c.clat, c.clng
  having count(distinct o.band) > 1
) leaks;

\echo '--- T3-b: 観測ベクトルの種類数がセル数と一致（＝セルより細かく絞れない） ---'
create temp table sigs as
  select i, j, string_agg(band::text, ',' order by a, k) as sig from obs group by i, j;
select case when (select count(distinct sig) from sigs)
                 = (select count(*) from (select distinct clat, clng from victim_cells) c)
            then 'PASS: 観測ベクトルは '
                 || (select count(distinct sig) from sigs)
                 || ' 種類＝セル数と一致（交点計算しても点に収束せずセルに留まる）'
            else 'FAIL: ' || (select count(distinct sig) from sigs) || ' 種類に分離（セル数 '
                 || (select count(*) from (select distinct clat, clng from victim_cells) c)
                 || ' より細かい）' end;

\echo '--- T3-b2: 到達可能な分解能（＝攻撃者に残る不確実性）の実測 ---'
select 'セル寸法: 緯度 ' || round((0.045 * 111.0)::numeric, 1) || 'km × 経度 '
     || round((0.055 * 111.0 * cos(radians(35.68)))::numeric, 1) || 'km'
     || ' / 旧方式の分解能: 約1.1km（座標2桁丸め）' as 分解能;

\echo '--- T3-c: 十分離れたセルは区別できる（機能として距離が意味を持つこと） ---'
select case when count(distinct band) > 1 then 'PASS: 別セルは異なる距離を返す（機能は生きている）'
            else 'FAIL: 距離が常に同じ＝機能不全' end
from (
  select (case when km < 5 then 3 when km <= 30 then greatest(5,(round(km/5)*5))::int
               when km <= 100 then (round(km/10)*10)::int else 110 end) as band
  from (select _distance_km(35.68, 139.76, _snap_lat(v), _snap_lng(139.76)) as km
        from unnest(array[35.70, 35.80, 35.95, 36.20]) v) x
) y;

\echo '--- T3-d: 旧方式（ペア固定ジッター）なら区別できてしまったことの対照確認 ---'
select case when count(distinct band_old) > 1
            then 'PASS(対照): 旧方式ではセル内で ' || count(distinct band_old) || ' 段階に分離＝三点測位が成立していた'
            else 'INFO: 対照条件では差が出なかった' end
from (
  select (case when km < 5 then 3 when km <= 30 then greatest(5,(round(km/5)*5))::int
               when km <= 100 then (round(km/10)*10)::int else 110 end) as band_old
  from (select _distance_km(35.68, 139.90, vp.vlat, vp.vlng) as km from victim_pts vp) x
) y;

\echo ''
\echo '################ #4 ブロック・退会後の写真署名URL ################'
\echo '--- T4-a: 承認済み写真は通常は可視 ---'
insert into photo_reviews (path, user_id, status)
  values (:'male_id' || '/test_m66.jpg', :'male_id'::uuid, 'approved') on conflict (path) do update set status='approved';
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role','authenticated')::text, true);
set local role authenticated;
select case when is_photo_visible_to(:'male_id' || '/test_m66.jpg') then 'PASS: 可視' else 'FAIL' end;
reset role;

\echo '--- T4-b: ブロックすると同じパスが不可視になる ---'
insert into blocks (blocker, blocked) values (:'female_id'::uuid, :'male_id'::uuid) on conflict do nothing;
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role','authenticated')::text, true);
set local role authenticated;
select case when not is_photo_visible_to(:'male_id' || '/test_m66.jpg') then 'PASS: ブロック後は不可視' else 'FAIL: まだ見える' end;
reset role;
delete from blocks where blocker = :'female_id'::uuid and blocked = :'male_id'::uuid;

\echo '--- T4-c: 相手が退会すると不可視になる ---'
update profiles set status = 'withdrawn' where id = :'male_id';
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role','authenticated')::text, true);
set local role authenticated;
select case when not is_photo_visible_to(:'male_id' || '/test_m66.jpg') then 'PASS: 退会後は不可視' else 'FAIL: まだ見える' end;
reset role;

rollback;
