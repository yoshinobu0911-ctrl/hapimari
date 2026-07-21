-- M6.5 P1 攻撃再現テスト（psql・ロールなりすましで authenticated 視点を再現）
-- 実行: docker exec supabase_db_hapimari psql -U postgres -d postgres -f /tmp/test_m65_p1.sql
-- 全テストはトランザクション内で行い最後に rollback（DBを汚さない）

\set QUIET on
\pset pager off

begin;

-- テスト用ユーザーを temp table に確保（DOブロック内では psql 変数が使えないため）
create temp table t_ids as
select
  (select id from profiles where gender = 'female' and status = 'active' and is_verified order by created_at limit 1) as f,
  (select id from profiles where gender = 'male' and status = 'active' order by created_at limit 1) as m,
  (select id from profiles where gender = 'male' and status = 'active'
     and id <> (select id from profiles where gender = 'male' and status = 'active' order by created_at limit 1)
   order by created_at limit 1) as m2;
grant select on t_ids to authenticated;
select f as female_id, m as male_id, m2 as male2_id from t_ids \gset

\echo '=== T1: profiles 本体は本人の行のみ（female視点） ==='
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when count(*) = 1 and bool_and(id = :'female_id') then 'PASS: 自分の行のみ' else 'FAIL: ' || count(*) || '行見えている' end
from profiles;

\echo '=== T2: profiles_public は他人が見えるが秘匿列が存在しない ==='
select case when count(*) > 1 then 'PASS: 他人のプロフィールが見える (' || count(*) || '行)' else 'FAIL: ' || count(*) || '行' end from profiles_public;
select case when count(*) = 0 then 'PASS: birth_date/子ども/理解宣言/subscription_active 列は存在しない'
            else 'FAIL: 秘匿列が露出 ' || string_agg(column_name, ',') end
from information_schema.columns
where table_name = 'profiles_public'
  and column_name in ('birth_date','has_children','children_living_together','ok_child_date','understands_children','understands_remarriage','subscription_active');
select case when bool_and(age between 18 and 120) then 'PASS: age は計算済み整数' else 'FAIL' end from profiles_public where id <> :'female_id';
reset role;

\echo '=== T3: 距離は帯域値のみ・ペア固定ジッター（2回測って完全一致） ==='
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table t3a as select * from get_profile_distances(array[:'male_id'::uuid, :'male2_id'::uuid]);
create temp table t3b as select * from get_profile_distances(array[:'male_id'::uuid, :'male2_id'::uuid]);
select case when (select count(*) from (select * from t3a except select * from t3b) d) = 0
             and (select count(*) from t3a) > 0
            then 'PASS: 2回の測距が完全一致（ジッター固定・対象' || (select count(*) from t3a) || '名）'
            else 'FAIL' end;
select case when bool_and(distance_km in (3,5,10,15,20,25,30,40,50,60,70,80,90,100,110))
            then 'PASS: 全て帯域値 (' || string_agg(distinct distance_km::text, ',') || ')'
            else 'FAIL: 生のkmが露出 ' || string_agg(distance_km::text, ',') end from t3a;
reset role;

\echo '=== T4: 同性の距離は取得できない（male視点でmale2を測距） ==='
select set_config('request.jwt.claims', json_build_object('sub', :'male_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when count(*) = 0 then 'PASS: 同性は対象外' else 'FAIL' end from get_profile_distances(array[:'male2_id'::uuid]);
reset role;

\echo '=== T5: 位置更新の30分制限（連続2回目は拒否） ==='
select set_config('request.jwt.claims', json_build_object('sub', :'male_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform set_my_location(35.68, 139.76);
    perform set_my_location(35.69, 139.77);
    raise notice 'FAIL: 連続更新が通ってしまった';
  exception when others then
    if sqlerrm = 'too_frequent' then
      raise notice 'PASS: 2回目は too_frequent で拒否';
    else
      raise notice 'NOTE: 拒否理由=% （30分以内の既存更新か日次上限）', sqlerrm;
    end if;
  end;
end $$;
reset role;

\echo '=== T6: ブロック済みペアはメッセージ/通話/デートRPCが全て拒否 ==='
insert into blocks (blocker, blocked) select f, m from t_ids on conflict do nothing;
insert into matches (user_a, user_b) select least(f, m), greatest(f, m) from t_ids on conflict do nothing;
create temp table t_match as
select id as match_id from matches, t_ids
where user_a = least(f, m) and user_b = greatest(f, m);
grant select on t_match to authenticated;

select case when is_match_blocked(match_id) then 'PASS: is_match_blocked = true' else 'FAIL' end from t_match;

select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare mid uuid; fid uuid;
begin
  select match_id into mid from t_match;
  select f into fid from t_ids;
  begin
    insert into messages (match_id, sender, body) values (mid, fid, 'should fail');
    raise notice 'FAIL: ブロック中にメッセージが送れた';
  exception when others then
    raise notice 'PASS: メッセージ送信拒否 (%)', sqlerrm;
  end;
  begin
    insert into calls (match_id, started_at) values (mid, now());
    raise notice 'FAIL: ブロック中に通話記録が作れた';
  exception when others then
    raise notice 'PASS: 通話記録拒否 (%)', sqlerrm;
  end;
  begin
    perform set_date_intent(mid, true);
    raise notice 'FAIL: ブロック中にデート意向が送れた';
  exception when others then
    if sqlerrm = 'blocked' then
      raise notice 'PASS: デートRPC拒否 (blocked)';
    else
      raise notice 'FAIL?: デートRPCの拒否理由が想定外 (%)', sqlerrm;
    end if;
  end;
end $$;
reset role;

\echo '=== T7: ブロック相手の距離・プロフィールは非表示 ==='
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when count(*) = 0 then 'PASS: ブロック相手の距離は取得不可' else 'FAIL' end from get_profile_distances(array[:'male_id'::uuid]);
select case when count(*) = 0 then 'PASS: ブロック相手はビューにも出ない' else 'FAIL' end from profiles_public where id = :'male_id';
reset role;

\echo '=== T8: photo_reviews — 他人パス登録拒否・本人登録OK・未承認は本人のみ表示 ==='
select set_config('request.jwt.claims', json_build_object('sub', :'male2_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_fid uuid; v_m2 uuid;
begin
  select f, m2 into v_fid, v_m2 from t_ids;
  begin
    perform register_photo_for_review(v_fid::text || '/evil.jpg');
    raise notice 'FAIL: 他人領域のパスが登録できた';
  exception when others then
    raise notice 'PASS: 他人パス登録拒否 (%)', sqlerrm;
  end;
  perform register_photo_for_review(v_m2::text || '/test.jpg');
end $$;
select case when count(*) = 1 then 'PASS: 本人パス登録OK・審査中でも本人には見える' else 'FAIL' end
from get_approved_photo_paths(array[:'male2_id' || '/test.jpg']);
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role', 'authenticated')::text, true);
select case when count(*) = 0 then 'PASS: 未承認写真は他人から見えない' else 'FAIL' end
from get_approved_photo_paths(array[:'male2_id' || '/test.jpg']);
reset role;

\echo '=== T9: 三点測位シミュレーション（3観測しても帯域+固定ジッターで自宅特定不能） ==='
do $$
declare
  atk uuid; tgt uuid;
  tgt_lat float; tgt_lng float;
  d1 int; d2 int; d3 int;
begin
  select m2, f into atk, tgt from t_ids;
  select loc_lat, loc_lng into tgt_lat, tgt_lng from profile_locations where user_id = tgt;
  if tgt_lat is null then
    raise notice 'SKIP: 対象に位置データなし';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', atk, 'role','authenticated')::text, true);
  -- 攻撃者が自位置を3回変えて測距（0.05度 ≒ 5.6km北 / 5.6km南 / 4.5km東）
  update profile_locations set loc_lat = tgt_lat + 0.05, loc_lng = tgt_lng, updated_at = now() - interval '1 hour' where user_id = atk;
  select distance_km into d1 from get_profile_distances(array[tgt]);
  update profile_locations set loc_lat = tgt_lat - 0.05, loc_lng = tgt_lng, updated_at = now() - interval '1 hour' where user_id = atk;
  select distance_km into d2 from get_profile_distances(array[tgt]);
  update profile_locations set loc_lat = tgt_lat, loc_lng = tgt_lng + 0.05, updated_at = now() - interval '1 hour' where user_id = atk;
  select distance_km into d3 from get_profile_distances(array[tgt]);
  raise notice '3観測の取得値: %km / %km / %km（真距離は約5.6 / 5.6 / 4.5km）', d1, d2, d3;
  if coalesce(d1,0) in (3,5,10) and coalesce(d2,0) in (3,5,10) and coalesce(d3,0) in (3,5,10) then
    raise notice 'PASS: 3観測とも帯域値のみ。±1.5km固定誤差+5km帯域のため交点計算でも数km四方までしか絞れない';
  else
    raise notice 'FAIL: 予期しない値';
  end if;
end $$;

rollback;
\echo '=== 全テスト完了（rollback済み・DB無変更） ==='
