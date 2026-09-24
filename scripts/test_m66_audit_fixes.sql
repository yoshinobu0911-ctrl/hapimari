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
-- 2026-09-20（PR#1 指摘 4055523978）: 検証用マッチIDをロール切替前に退避しておく。
-- do $$ ... $$ の中では psql 変数が展開されないため、temp table 経由で渡す。
-- 旧版は認証ロールに切り替えたあと matches を引いており、RLSで0行になっても
-- exception when others が拾って PASS になる構造だった。
create temp table t_match as select :'match_id'::uuid as id;
grant select on t_match to authenticated;

\echo ''
\echo '################ #1 凍結・退会ユーザーのデートRPC貫通 ################'

\echo '--- T1-a: activeな女性はデートRPCを使える（正常系が壊れていないこと） ---'
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role','authenticated')::text, true);
set local role authenticated;
select case when set_date_intent(:'match_id'::uuid, true) is not null
            then 'PASS: 正常系は動作する' else 'FAIL' end;
reset role;

\echo '--- T1-b: 凍結すると拒否される（理由が inactive_account であることまで確認） ---'
update profiles set status = 'suspended' where id = :'female_id';
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role','authenticated')::text, true);
set local role authenticated;
do $$
declare mid uuid;
begin
  select id into mid from t_match;
  if mid is null then
    raise notice 'FAIL(前提): 検証用マッチIDを取得できない';
    return;
  end if;
  begin
    perform set_date_intent(mid, true);
    raise notice 'FAIL: 凍結ユーザーがデートRPCを実行できた';
  exception
    when raise_exception then
      if sqlerrm = 'inactive_account' then
        raise notice 'PASS: 凍結ユーザーは inactive_account で拒否された';
      else
        raise notice 'FAIL: 拒否はされたが理由が違う (%)', sqlerrm;
      end if;
    when others then
      raise notice 'FAIL: 想定外の失敗 (% / %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

\echo '--- T1-c: 退会でも同様に拒否される（理由まで確認） ---'
update profiles set status = 'withdrawn' where id = :'female_id';
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role','authenticated')::text, true);
set local role authenticated;
do $$
declare mid uuid;
begin
  select id into mid from t_match;
  if mid is null then
    raise notice 'FAIL(前提): 検証用マッチIDを取得できない';
    return;
  end if;
  begin
    perform set_date_intent(mid, true);
    raise notice 'FAIL: 退会ユーザーがデートRPCを実行できた';
  exception
    when raise_exception then
      if sqlerrm = 'inactive_account' then
        raise notice 'PASS: 退会ユーザーは inactive_account で拒否された';
      else
        raise notice 'FAIL: 拒否はされたが理由が違う (%)', sqlerrm;
      end if;
    when others then
      raise notice 'FAIL: 想定外の失敗 (% / %)', sqlstate, sqlerrm;
  end;
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
exception
  when raise_exception then
    if sqlerrm = 'not_entitled' then
      raise notice 'PASS: 未課金男性の挿入は拒否された (%)', sqlerrm;
    else
      raise notice 'FAIL: 想定外の拒否理由 (%)', sqlerrm;
    end if;
  when others then
    raise notice 'FAIL: 想定外の拒否理由 (%)', sqlerrm;
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
\echo '################ #3 三点測位の再現（本番RPC越しの多点観測） ################'
\echo '--- 攻撃モデル: 攻撃者が自位置を12方位×2距離に詐称し、本番の get_profile_distances()'
\echo '    が返す距離だけで被害者を区別できるかを観測する。区別できたら三点測位が成立＝不合格。'
\echo '    ※ 2026-09-20改訂（PR#1 指摘 4055523946）: 旧版はテスト内で量子化してから帯域化を'
\echo '       手計算していたため恒真だった。被害者の座標は生のまま置き、量子化は本番関数に委ねる。'

-- 攻撃者（観測者）= 既出の女性。被害者 = 男性6名（同一セル3名 × 2セル）。
create temp table atk as select :'female_id'::uuid as id;

create temp table victim_ids as
select id, row_number() over (order by created_at) as n
from profiles where gender = 'male' and status = 'active' order by created_at limit 6;

-- 被害者の「生座標」。同一セル内で互いに3〜4km離す（量子化が無ければ区別できる距離）
create temp table victim_raw as
select v.id, v.n,
  case when v.n <= 3 then 35.670   + (v.n - 1) * 0.0150
       else                35.715   + (v.n - 4) * 0.0150 end as vlat,
  case when v.n <= 3 then 139.7350 + (v.n - 1) * 0.0225
       else                139.7900 + (v.n - 4) * 0.0200 end as vlng
from victim_ids v;

-- 「同一セル」の定義は本番と同じ snap 関数で決める（観測値のほうは本番RPCから取る）
create temp table victim_cells as
select vr.id, vr.n, _snap_lat(vr.vlat) as clat, _snap_lng(vr.vlng) as clng from victim_raw vr;

\echo '--- T3-pre1: 前提（被害者6名が「2セル × 各3名」に配置されている） ---'
select case when count(*) = 2 and min(c) = 3 and max(c) = 3
            then 'PASS(前提): 2セル×各3名に配置できている'
            else 'FAIL(前提): セル構成が想定外 (' || coalesce(string_agg(c::text, ','), '0セル') || ')' end
from (select clat, clng, count(*) as c from victim_cells group by 1,2) x;

insert into profile_locations (user_id, loc_lat, loc_lng)
select id, vlat, vlng from victim_raw
on conflict (user_id) do update set loc_lat = excluded.loc_lat, loc_lng = excluded.loc_lng;

-- 観測地点: 12方位 × 2距離（約5.5km / 約16km）。この距離帯は5km刻みで返るため、
-- 量子化が無ければ被害者間の3〜4kmの差が観測値に現れる（＝このテストに感度がある）
create temp table attacker_pts as
select 35.6925 + r * cos(radians(a)) as alat,
       139.7725 + r * sin(radians(a)) as alng, a, (r * 1000)::int as k
from generate_series(0, 330, 30) a, unnest(array[0.05, 0.15]) r;

create temp table obs (a int, k int, victim uuid, distance_km int);

-- 本番RPC越しに観測する（テスト側では量子化も帯域化も一切しない）
create or replace function pg_temp.observe() returns void language plpgsql as $$
declare pt record; atkid uuid := (select id from atk);
begin
  delete from obs;
  for pt in select * from attacker_pts loop
    insert into profile_locations (user_id, loc_lat, loc_lng) values (atkid, pt.alat, pt.alng)
      on conflict (user_id) do update set loc_lat = excluded.loc_lat, loc_lng = excluded.loc_lng;
    perform set_config('request.jwt.claims',
      json_build_object('sub', atkid, 'role', 'authenticated')::text, true);
    insert into obs(a, k, victim, distance_km)
      select pt.a, pt.k, d.user_id, d.distance_km
      from public.get_profile_distances((select array_agg(id) from victim_ids)) d;
  end loop;
end $$;

select pg_temp.observe();

\echo '--- T3-pre2: 前提（観測が空振りしていない＝24地点 × 6名 = 144件） ---'
select case when count(*) = (select count(*) from attacker_pts) * (select count(*) from victim_ids)
            then 'PASS(前提): ' || count(*) || ' 件の観測を取得'
            else 'FAIL(前提): 観測 ' || count(*) || ' 件（期待 '
                 || (select count(*) from attacker_pts) * (select count(*) from victim_ids) || ' 件）' end
from obs;

\echo '--- T3-a: 同一セル内では、どの観測地点からも被害者を区別できない ---'
select case when count(*) = 0
            then 'PASS: 全' || (select count(*) from attacker_pts)
                 || '観測地点で、同一セル内の被害者位置は完全に区別不能'
            else 'FAIL: ' || count(*) || ' 通りの(観測地点×セル)で区別できてしまう' end
from (
  select o.a, o.k, c.clat, c.clng
  from obs o join victim_cells c on c.id = o.victim
  group by o.a, o.k, c.clat, c.clng
  having count(distinct o.distance_km) > 1
) leaks;

\echo '--- T3-b: 観測ベクトルの種類数がセル数と一致（＝セルより細かく絞れない） ---'
create temp table sigs as
  select victim, string_agg(distance_km::text, ',' order by a, k) as sig from obs group by victim;
select case when (select count(distinct sig) from sigs)
                 = (select count(*) from (select distinct clat, clng from victim_cells) c)
            then 'PASS: 観測ベクトルは ' || (select count(distinct sig) from sigs)
                 || ' 種類＝セル数と一致（交点計算しても点に収束せずセルに留まる）'
            else 'FAIL: ' || (select count(distinct sig) from sigs) || ' 種類に分離（セル数 '
                 || (select count(*) from (select distinct clat, clng from victim_cells) c)
                 || ' より細かい）' end;

\echo '--- T3-c: 別セルどうしは区別できる（測距機能そのものは生きている） ---'
select case when count(distinct sig) > 1
            then 'PASS: 別セルは異なる観測ベクトルを返す（機能は生きている）'
            else 'FAIL: 全セルが同じ観測値＝距離機能が死んでいる' end
from sigs;

\echo '--- T3-b2: 到達可能な分解能（＝攻撃者に残る不確実性）の実測 ---'
select 'セル寸法: 緯度 ' || round((0.045 * 111.0)::numeric, 1) || 'km × 経度 '
     || round((0.055 * 111.0 * cos(radians(35.68)))::numeric, 1) || 'km'
     || ' / 旧方式の分解能: 約1.1km（座標2桁丸め）' as 分解能;

\echo '--- T3-d(対照): 量子化を外すと同じテストが赤くなる（＝このテストが効いている証拠） ---'
create or replace function public._snap_lat(p_lat double precision) returns double precision
  language sql immutable as $x$ select p_lat $x$;
create or replace function public._snap_lng(p_lng double precision) returns double precision
  language sql immutable as $x$ select p_lng $x$;
select pg_temp.observe();
select case when count(*) > 0
            then 'PASS(対照): 量子化を外すと ' || count(*)
                 || ' 通りで区別できてしまう＝このテストは回帰を検知できる'
            else 'FAIL(対照): 量子化を外しても漏洩を検知できない＝このテストは無効' end
from (
  select o.a, o.k, c.clat, c.clng
  from obs o join victim_cells c on c.id = o.victim
  group by o.a, o.k, c.clat, c.clng
  having count(distinct o.distance_km) > 1
) leaks;
-- 対照で差し替えた snap 関数は rollback で元に戻る（同一トランザクション内のDDL）

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
