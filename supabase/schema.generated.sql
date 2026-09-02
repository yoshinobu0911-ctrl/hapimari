


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "storage";


ALTER SCHEMA "storage" OWNER TO "supabase_admin";


CREATE TYPE "storage"."buckettype" AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


ALTER TYPE "storage"."buckettype" OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "public"."_age_band"("p_birth" "date") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when p_birth is null then null
    else (floor(date_part('year', age(p_birth)) / 5) * 5)::int || '-'
         || ((floor(date_part('year', age(p_birth)) / 5) * 5)::int + 4)
  end;
$$;


ALTER FUNCTION "public"."_age_band"("p_birth" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_bio_features"("p_bio" "text") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case when p_bio is null then '{}'::jsonb else jsonb_build_object(
    'length', char_length(p_bio),
    'lines', array_length(string_to_array(p_bio, E'\n'), 1),
    -- 1文字あたりのバイト数。絵文字・記号が多い文ほど大きくなる（原文には戻せない）
    'multibyte_ratio', round((octet_length(p_bio)::numeric / greatest(char_length(p_bio), 1)), 2),
    'question_marks', char_length(p_bio) - char_length(replace(p_bio, '？', '')),
    'mentions_hobby', p_bio ~ '(趣味|旅行|映画|料理|散歩|温泉)',
    'mentions_marriage', p_bio ~ '(結婚|再婚|パートナー|将来)'
  ) end;
$$;


ALTER FUNCTION "public"."_bio_features"("p_bio" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_contains_fraud_word"("p_text" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from fraud_words w
    where lower(translate(coalesce(p_text, ''),
      'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９',
      'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz0123456789'))
      like '%' || w.word || '%'
  );
$$;


ALTER FUNCTION "public"."_contains_fraud_word"("p_text" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_a" "uuid" NOT NULL,
    "user_b" "uuid" NOT NULL,
    "message_count" integer DEFAULT 0 NOT NULL,
    "call_unlocked" boolean GENERATED ALWAYS AS (("message_count" >= 10)) STORED,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."matches" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_date_get_match"("p_match_id" "uuid") RETURNS "public"."matches"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  m matches;
begin
  -- 凍結・退会したユーザーはデート機能を一切操作できない
  -- （※ 送信資格 can_caller_message はここでは要求しない。get_date_status も
  --    この関数を通り、チャット画面の表示に使われるため。自動メッセージ挿入の
  --    資格チェックは下記 messages のトリガで一元的に強制する）
  if not public.is_caller_active() then
    raise exception 'inactive_account';
  end if;

  select * into m from matches where id = p_match_id;
  if m.id is null or (m.user_a <> auth.uid() and m.user_b <> auth.uid()) then
    raise exception 'not_participant';
  end if;
  if public.is_blocked_between(m.user_a, m.user_b) then
    raise exception 'blocked';
  end if;

  -- 相手が凍結・退会している場合も接触経路を閉じる
  if not exists (
    select 1 from profiles p
    where p.id = case when m.user_a = auth.uid() then m.user_b else m.user_a end
      and p.status = 'active'
  ) then
    raise exception 'partner_inactive';
  end if;

  return m;
end $$;


ALTER FUNCTION "public"."_date_get_match"("p_match_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_distance_km"("lat1" double precision, "lng1" double precision, "lat2" double precision, "lng2" double precision) RETURNS double precision
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;


ALTER FUNCTION "public"."_distance_km"("lat1" double precision, "lng1" double precision, "lat2" double precision, "lng2" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_email_hash"("p_email" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex');
$$;


ALTER FUNCTION "public"."_email_hash"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_email_hash_of"("p_user" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select public._email_hash(u.email) from auth.users u where u.id = p_user and u.email is not null;
$$;


ALTER FUNCTION "public"."_email_hash_of"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_enforce_message_entitlement"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is not null then
    if new.sender <> auth.uid() then
      raise exception 'sender_mismatch';
    end if;
    if not public.can_caller_message() then
      raise exception 'not_entitled';
    end if;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."_enforce_message_entitlement"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_enforce_registration_eligibility"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  h text;
  led identity_ledger;
begin
  if auth.uid() is null then
    return new; -- seed / service_role による投入は対象外
  end if;
  h := public._email_hash_of(new.id);
  if h is null then
    return new;
  end if;

  select * into led from identity_ledger where email_hash = h;
  if led.email_hash is null then
    return new; -- 初回登録
  end if;

  if led.banned then
    raise exception 'registration_banned';
  end if;
  -- クーリング期間（7日）: 退会→即再登録による各種リセットの抑止
  if led.last_withdrawn_at is not null
     and led.last_withdrawn_at > now() - interval '7 days' then
    raise exception 'registration_cooling';
  end if;

  -- 通報履歴を引き継ぐ（クーリングが短くても「通報リセット」が成立しないようにする）
  new.prior_report_count := led.report_count;
  return new;
end $$;


ALTER FUNCTION "public"."_enforce_registration_eligibility"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_ev_block"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public._log_event(new.blocker, 'block_created', new.blocked, null, '{}'::jsonb);
  return new;
end $$;


ALTER FUNCTION "public"."_ev_block"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_ev_call"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public._log_event(null, 'call_logged', null, new.match_id,
    jsonb_build_object('duration_seconds', new.duration_seconds));
  return new;
end $$;


ALTER FUNCTION "public"."_ev_call"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_ev_date"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    perform public._log_event(null, 'date_started', null, new.match_id, '{}'::jsonb);
  elsif new.status is distinct from old.status then
    perform public._log_event(null, 'date_status_changed', null, new.match_id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."_ev_date"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_ev_like"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public._log_event(new.from_user, 'like_sent', new.to_user, null,
    jsonb_build_object('has_message', new.message is not null));
  return new;
end $$;


ALTER FUNCTION "public"."_ev_like"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_ev_match"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public._log_event(new.user_a, 'match_created', new.user_b, new.id, '{}'::jsonb);
  return new;
end $$;


ALTER FUNCTION "public"."_ev_match"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_ev_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public._log_event(new.sender, 'message_sent', null, new.match_id,
    jsonb_build_object('length', char_length(new.body), 'flagged', new.flagged));
  return new;
end $$;


ALTER FUNCTION "public"."_ev_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_ev_report"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public._log_event(new.reporter, 'report_created', new.reported, null,
    jsonb_build_object('reason', new.reason));
  return new;
end $$;


ALTER FUNCTION "public"."_ev_report"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_log_event"("p_actor" "uuid", "p_type" "text", "p_target" "uuid", "p_match" "uuid", "p_props" "jsonb") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into user_events (actor_id, event_type, target_user_id, match_id, props)
  values (p_actor, p_type, p_target, p_match, coalesce(p_props, '{}'::jsonb));
$$;


ALTER FUNCTION "public"."_log_event"("p_actor" "uuid", "p_type" "text", "p_target" "uuid", "p_match" "uuid", "p_props" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_record_withdrawal"("p_user" "uuid", "p_banned" boolean, "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  h text := public._email_hash_of(p_user);
  rc int;
begin
  if h is null then
    return; -- メール未設定（想定外）の場合は台帳を作らない
  end if;

  select count(*) into rc from reports where reported = p_user;

  insert into identity_ledger (email_hash, banned, ban_reason, suppressed, report_count,
                               last_withdrawn_at, withdrawal_count)
  values (h, p_banned, p_reason, true, rc, now(), 1)
  on conflict (email_hash) do update set
    banned = identity_ledger.banned or excluded.banned,
    ban_reason = coalesce(excluded.ban_reason, identity_ledger.ban_reason),
    suppressed = true,
    report_count = greatest(identity_ledger.report_count, excluded.report_count),
    last_withdrawn_at = now(),
    withdrawal_count = identity_ledger.withdrawal_count + 1,
    updated_at = now();

  -- ブロック関係をハッシュ対で退避（相手が在籍中でもハッシュは算出できる）
  insert into block_carryover (blocker_hash, blocked_hash)
    select public._email_hash_of(b.blocker), public._email_hash_of(b.blocked)
    from blocks b
    where (b.blocker = p_user or b.blocked = p_user)
      and public._email_hash_of(b.blocker) is not null
      and public._email_hash_of(b.blocked) is not null
  on conflict do nothing;

  -- 退会した時点で認証アカウントと本人の結び付きを断つ。
  --   ・メールアドレスを無効値に置き換えることで、同じアドレスでの**再登録を可能にする**
  --     （再登録は常に新規アカウント扱いになり、過去データは復活しない＝設計方針どおり）
  --   ・発行済みトークンを失効させ、退会後の操作を止める
  --   ・以降このユーザー行は「学習用の匿名レコード」へ向かうだけで、本人には戻せない
  update auth.users set
    email = 'withdrawn-' || p_user::text || '@invalid',
    phone = null,
    raw_user_meta_data = '{}'::jsonb,
    banned_until = 'infinity'
  where id = p_user;
end $$;


ALTER FUNCTION "public"."_record_withdrawal"("p_user" "uuid", "p_banned" boolean, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_region_block"("p_pref" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when p_pref in ('北海道') then '北海道'
    when p_pref in ('青森県','岩手県','宮城県','秋田県','山形県','福島県') then '東北'
    when p_pref in ('茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県') then '関東'
    when p_pref in ('新潟県','富山県','石川県','福井県','山梨県','長野県') then '北陸甲信越'
    when p_pref in ('岐阜県','静岡県','愛知県','三重県') then '東海'
    when p_pref in ('滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県') then '関西'
    when p_pref in ('鳥取県','島根県','岡山県','広島県','山口県') then '中国'
    when p_pref in ('徳島県','香川県','愛媛県','高知県') then '四国'
    when p_pref in ('福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県') then '九州'
    when p_pref in ('沖縄県') then '沖縄'
    else 'その他' end;
$$;


ALTER FUNCTION "public"."_region_block"("p_pref" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_restore_after_reregistration"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  h text;
begin
  if auth.uid() is null then
    return new;
  end if;
  h := public._email_hash_of(new.id);
  if h is null then
    return new;
  end if;

  -- 再登録＝改めて同意を得たので配信除外を解除
  update identity_ledger set suppressed = false, updated_at = now() where email_hash = h;

  -- 過去のブロックを復元（相手が現在も在籍している場合のみ）
  insert into blocks (blocker, blocked)
    select new.id, p.id
    from block_carryover bc
    join profiles p on p.status = 'active' and public._email_hash_of(p.id) = bc.blocked_hash
    where bc.blocker_hash = h and p.id <> new.id
  on conflict do nothing;

  insert into blocks (blocker, blocked)
    select p.id, new.id
    from block_carryover bc
    join profiles p on p.status = 'active' and public._email_hash_of(p.id) = bc.blocker_hash
    where bc.blocked_hash = h and p.id <> new.id
  on conflict do nothing;

  return new;
end $$;


ALTER FUNCTION "public"."_restore_after_reregistration"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_snap_lat"("p_lat" double precision) RETURNS double precision
    LANGUAGE "sql" IMMUTABLE
    AS $$
  -- 0.045度 ≒ 5.0km（緯度は経度に依らず一定）
  select round((p_lat / 0.045)::numeric, 0)::double precision * 0.045;
$$;


ALTER FUNCTION "public"."_snap_lat"("p_lat" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_snap_lng"("p_lng" double precision) RETURNS double precision
    LANGUAGE "sql" IMMUTABLE
    AS $$
  -- 0.055度 ≒ 5.0km（日本の緯度帯 35N 付近での近似）
  select round((p_lng / 0.055)::numeric, 0)::double precision * 0.055;
$$;


ALTER FUNCTION "public"."_snap_lng"("p_lng" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_stamp_date_transitions"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status is distinct from old.status then
    if new.status = 'matched' and new.intent_matched_at is null then
      new.intent_matched_at := now();
    elsif new.status = 'scheduling' and new.first_proposed_at is null then
      new.first_proposed_at := now();
    elsif new.status = 'confirmed' then
      new.confirmed_at := now();
    elsif new.status = 'cancelled' then
      new.cancelled_at := now();
    elsif new.status = 'done' then
      new.done_at := now();
    end if;
  end if;
  -- 確定枠が入れ替わったら実施予定日も追随
  if new.confirmed_slot is distinct from old.confirmed_slot then
    new.date_on := nullif(new.confirmed_slot ->> 'date', '')::date;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."_stamp_date_transitions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_sync_subscription_flag"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  target uuid;
begin
  -- DELETE では NEW が未割り当てのため、TG_OP で明示的に振り分ける
  if tg_op = 'DELETE' then
    target := old.user_id;
  else
    target := new.user_id;
  end if;

  update profiles
     set subscription_active = public.is_subscription_active(target)
   where id = target;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."_sync_subscription_flag"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_validate_photo_ownership"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  u text;
begin
  if auth.uid() is null then
    return new; -- service_role / seed / 匿名化ジョブは対象外
  end if;
  if new.photo_urls is null then
    return new;
  end if;
  foreach u in array new.photo_urls loop
    if position('://' in u) = 0 and position(auth.uid()::text || '/' in u) <> 1 then
      raise exception 'invalid_photo_path';
    end if;
  end loop;
  return new;
end $$;


ALTER FUNCTION "public"."_validate_photo_ownership"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_validate_profile_arrays"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  bad text;
begin
  select t into bad from unnest(new.value_tags) as t
  where t not in (select id from value_tag_master where active) limit 1;
  if bad is not null then
    raise exception 'unknown_value_tag: %', bad;
  end if;

  select t into bad from unnest(new.available_times) as t
  where t not in (select value from available_time_master) limit 1;
  if bad is not null then
    raise exception 'unknown_available_time: %', bad;
  end if;

  return new;
end $$;


ALTER FUNCTION "public"."_validate_profile_arrays"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."anonymize_profile"("p_user" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  paths text[];
begin
  -- 写真・本人確認画像の「実体」は SQL から直接削除できない（Supabaseの仕様で
  -- storage テーブルへの直接DELETEは禁止・Storage API 経由のみ）。
  -- そこで削除待ちキューに積み、管理画面のジョブが Storage API で消す。
  select photo_urls into paths from profiles where id = p_user;
  if paths is not null and array_length(paths, 1) > 0 then
    delete from photo_reviews where path = any(paths);
  end if;
  delete from photo_reviews where user_id = p_user;

  -- photo_urls に載っている分だけでなく、**そのユーザーのフォルダ配下すべて**を対象にする。
  -- （プロフィールから外した写真がバケットに残り続けるのを防ぐ。検証で発見した漏れ）
  insert into file_deletion_queue (bucket_id, path)
    select 'photos', o.name from storage.objects o
    where o.bucket_id = 'photos'
      and (storage.foldername(o.name))[1] = p_user::text
  on conflict do nothing;
  if paths is not null and array_length(paths, 1) > 0 then
    insert into file_deletion_queue (bucket_id, path)
      select 'photos', p from unnest(paths) p on conflict do nothing;
  end if;

  insert into file_deletion_queue (bucket_id, path)
    select 'verifications', o.name from storage.objects o
    where o.bucket_id = 'verifications'
      and (storage.foldername(o.name))[1] = p_user::text
  on conflict do nothing;
  delete from verifications where user_id = p_user;

  -- 位置情報を削除
  delete from profile_locations where user_id = p_user;

  -- メッセージ本文を削除（誰と何往復したかの事実は学習用に残す）
  update messages set body = '' where sender = p_user;

  -- プロフィール: 特徴量へ変換し、個人を特定できる列を消す
  update profiles set
    age_band = public._age_band(birth_date),
    region_block = public._region_block(prefecture),
    bio_features = public._bio_features(bio),
    nickname = '退会済み',
    birth_date = '1900-01-01',          -- not null 制約があるため既定値へ（年齢帯のみ残す）
    prefecture = '不明',
    city = null,
    bio = null,
    photo_urls = '{}',
    voice_profile_url = null,
    email_bounced = false,
    anonymized_at = now()
  where id = p_user;
end $$;


ALTER FUNCTION "public"."anonymize_profile"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ban_account"("p_user" "uuid", "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update profiles set status = 'withdrawn', withdrawn_at = now() where id = p_user;
  perform public._record_withdrawal(p_user, true, p_reason);
end $$;


ALTER FUNCTION "public"."ban_account"("p_user" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_caller_message"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and status = 'active'
      and is_verified = true
      and (gender = 'female' or public.is_subscription_active(auth.uid()))
  );
$$;


ALTER FUNCTION "public"."can_caller_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_date"("p_match_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  m matches;
  d date_proposals;
  uid uuid := auth.uid();
begin
  m := public._date_get_match(p_match_id);

  select * into d from date_proposals
  where match_id = p_match_id and status not in ('done','cancelled')
  order by created_at desc limit 1;

  if d.id is null or d.status <> 'confirmed' then
    raise exception 'invalid_status';
  end if;

  update date_proposals set status = 'cancelled' where id = d.id;
  insert into messages (match_id, sender, body) values
    (p_match_id, uid, '申し訳ありません。今回の予定は見送らせてください。');

  return public.get_date_status(p_match_id);
end $$;


ALTER FUNCTION "public"."cancel_date"("p_match_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_daily_stats"("p_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into daily_stats (date, active_male, active_female, new_matches, dates_confirmed, forced_withdrawals)
  values (
    p_date,
    (select count(*) from profiles where gender = 'male' and status = 'active'),
    (select count(*) from profiles where gender = 'female' and status = 'active'),
    (select count(*) from matches where (created_at at time zone 'Asia/Tokyo')::date = p_date),
    (select count(*) from date_proposals
      where status in ('confirmed', 'done') and (confirmed_slot ->> 'date')::date = p_date),
    (select count(*) from profiles where status = 'suspended')
  )
  on conflict (date) do update set
    active_male = excluded.active_male,
    active_female = excluded.active_female,
    new_matches = excluded.new_matches,
    dates_confirmed = excluded.dates_confirmed,
    forced_withdrawals = excluded.forced_withdrawals;
end;
$$;


ALTER FUNCTION "public"."compute_daily_stats"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_match_on_mutual_like"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- ペア固定のロックキー（least/greatest で両方向とも同じキーになる）
  perform pg_advisory_xact_lock(hashtextextended(
    least(new.from_user, new.to_user)::text || '/' || greatest(new.from_user, new.to_user)::text, 0));
  if exists (select 1 from likes where from_user = new.to_user and to_user = new.from_user) then
    insert into matches (user_a, user_b)
    values (least(new.from_user, new.to_user), greatest(new.from_user, new.to_user))
    on conflict (user_a, user_b) do nothing;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."create_match_on_mutual_like"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_subscriptions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  n integer;
begin
  update subscriptions
     set status = 'canceled', updated_at = now()
   where status in ('active', 'trialing')
     and current_period_end is not null
     and current_period_end <= now() - interval '3 days';
  get diagnostics n = row_count;

  -- Webhook取りこぼし対策: フラグと実態のズレを一括で直す
  update profiles p
     set subscription_active = public.is_subscription_active(p.id)
   where p.subscription_active is distinct from public.is_subscription_active(p.id);

  return n;
end $$;


ALTER FUNCTION "public"."expire_stale_subscriptions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."flag_fraud_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  normalized text;
begin
  normalized := lower(translate(new.body,
    'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９',
    'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz0123456789'));
  if exists (select 1 from fraud_words w where normalized like '%' || w.word || '%') then
    new.flagged := true;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."flag_fraud_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_approved_photo_paths"("p_paths" "text"[]) RETURNS TABLE("path" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select pr.path from photo_reviews pr
  where pr.path = any(p_paths)
    and (pr.status = 'approved' or pr.user_id = auth.uid());
$$;


ALTER FUNCTION "public"."get_approved_photo_paths"("p_paths" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_date_status"("p_match_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  m matches;
  d date_proposals;
  uid uuid := auth.uid();
  is_a boolean;
  my_intent boolean;
  my_fb text;
  pending jsonb := null;
  i_am_proposer boolean := false;
  can_fb boolean := false;
  none jsonb;
begin
  m := public._date_get_match(p_match_id);
  is_a := (m.user_a = uid);

  none := jsonb_build_object(
    'exists', false, 'status', null, 'my_intent', null, 'both_agreed', false,
    'pending_slot', null, 'i_am_proposer', false, 'confirmed_slot', null,
    'area_suggestion', null, 'my_feedback', null, 'can_feedback', false,
    'message_count', m.message_count);

  select * into d from date_proposals
  where match_id = p_match_id and status not in ('done','cancelled')
  order by created_at desc limit 1;

  if d.id is null then
    return none;
  end if;

  my_intent := case when is_a then d.intent_a else d.intent_b end;

  -- R6: 相手だけが動いた collecting 状態は「何もない」と同じ見え方にする
  if d.status = 'collecting' and my_intent is null then
    return none;
  end if;

  my_fb := case when is_a then d.feedback_a else d.feedback_b end;

  if d.status = 'scheduling'
     and jsonb_array_length(coalesce(d.proposed_slots, '[]'::jsonb)) > 0 then
    pending := d.proposed_slots -> (jsonb_array_length(d.proposed_slots) - 1);
    i_am_proposer := (pending ->> 'proposed_by')::uuid = uid;
  end if;

  if d.status = 'confirmed' and d.confirmed_slot is not null then
    can_fb := ((d.confirmed_slot ->> 'date')::date < (now() at time zone 'Asia/Tokyo')::date)
              and my_fb is null;
  end if;

  return jsonb_build_object(
    'exists', true,
    'status', d.status,
    'my_intent', my_intent,
    'both_agreed', coalesce(d.intent_a, false) and coalesce(d.intent_b, false),
    'pending_slot', case when d.status = 'scheduling' then pending else null end,
    'i_am_proposer', i_am_proposer,
    'confirmed_slot', case when d.status = 'confirmed' then d.confirmed_slot else null end,
    'area_suggestion', d.area_suggestion,
    'my_feedback', my_fb,
    'can_feedback', can_fb,
    'message_count', m.message_count);
end $$;


ALTER FUNCTION "public"."get_date_status"("p_match_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_pending_file_deletions"() RETURNS TABLE("bucket_id" "text", "path" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select q.bucket_id, q.path from file_deletion_queue q where q.deleted_at is null;
$$;


ALTER FUNCTION "public"."get_pending_file_deletions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_profile_distances"("p_user_ids" "uuid"[]) RETURNS TABLE("user_id" "uuid", "distance_km" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  my_lat double precision;
  my_lng double precision;
  my_gender text;
begin
  -- #2: 凍結・退会ユーザーには測距機能を渡さない
  if not public.is_caller_active() then
    return;
  end if;

  select l.loc_lat, l.loc_lng into my_lat, my_lng
  from profile_locations l where l.user_id = uid;
  if my_lat is null or my_lng is null then
    return; -- 位置未許可: 距離機能なし
  end if;
  select p.gender into my_gender from profiles p where p.id = uid;

  return query
    select
      l.user_id,
      (with d as (
        select public._distance_km(
          my_lat, my_lng,
          public._snap_lat(l.loc_lat),   -- 相手の座標をセル中心へ量子化
          public._snap_lng(l.loc_lng)
        ) as km
      )
      select case
        when d.km < 5 then 3
        when d.km <= 30 then greatest(5, (round(d.km / 5) * 5))::int
        when d.km <= 100 then (round(d.km / 10) * 10)::int
        else 110
      end from d)::int
    from profile_locations l
    join profiles p on p.id = l.user_id
    where l.user_id = any(p_user_ids)
      and l.user_id <> uid
      and p.status = 'active'
      and p.gender is distinct from my_gender
      and not public.is_blocked_between(uid, l.user_id);
end;
$$;


ALTER FUNCTION "public"."get_profile_distances"("p_user_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_suppression_list"() RETURNS TABLE("email_hash" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select l.email_hash from identity_ledger l where l.suppressed or l.banned;
$$;


ALTER FUNCTION "public"."get_suppression_list"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_message_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update matches set message_count = message_count + 1 where id = new.match_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."increment_message_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_blocked_between"("a" "uuid", "b" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from blocks
    where (blocker = a and blocked = b) or (blocker = b and blocked = a)
  );
$$;


ALTER FUNCTION "public"."is_blocked_between"("a" "uuid", "b" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_caller_active"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from profiles where id = auth.uid() and status = 'active'
  );
$$;


ALTER FUNCTION "public"."is_caller_active"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_match_blocked"("target_match" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from matches m
    where m.id = target_match
      and public.is_blocked_between(m.user_a, m.user_b)
  );
$$;


ALTER FUNCTION "public"."is_match_blocked"("target_match" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_match_participant"("target_match" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from matches
    where id = target_match
      and (user_a = auth.uid() or user_b = auth.uid())
  );
$$;


ALTER FUNCTION "public"."is_match_participant"("target_match" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_photo_approved"("p_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from photo_reviews pr where pr.path = p_path and pr.status = 'approved'
  );
$$;


ALTER FUNCTION "public"."is_photo_approved"("p_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_photo_of_profile"("p_path" "text", "p_owner" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from photo_reviews pr
    join profiles owner on owner.id = pr.user_id
    where pr.path = p_path
      and pr.user_id = p_owner            -- 所有者の一致（なりすまし防止の本体）
      and pr.status = 'approved'
      and owner.status = 'active'
      and not public.is_blocked_between(auth.uid(), pr.user_id)
  );
$$;


ALTER FUNCTION "public"."is_photo_of_profile"("p_path" "text", "p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_photo_visible_to"("p_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from photo_reviews pr
    join profiles owner on owner.id = pr.user_id
    where pr.path = p_path
      and pr.status = 'approved'
      and owner.status = 'active'
      and not public.is_blocked_between(auth.uid(), pr.user_id)
  );
$$;


ALTER FUNCTION "public"."is_photo_visible_to"("p_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_subscription_active"("p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select (auth.uid() is null or p_user = auth.uid())
     and exists (
       select 1 from subscriptions s
       where s.user_id = p_user
         and s.status in ('active', 'trialing')
         and s.current_period_end is not null
         and s.current_period_end > now()
     );
$$;


ALTER FUNCTION "public"."is_subscription_active"("p_user" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_subscription_active"("p_user" "uuid") IS '課金判定の単一関数。ログイン利用者は自分の分しか true を得られない（他会員の課金状態は照会不可）';



CREATE OR REPLACE FUNCTION "public"."log_user_event"("p_event_type" "text", "p_target_user_id" "uuid" DEFAULT NULL::"uuid", "p_props" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  if p_event_type not in ('profile_view', 'discover_impression', 'filter_applied') then
    raise exception 'invalid_event_type';
  end if;
  -- 付帯情報のサイズ制限（肥大化防止）
  if length(p_props::text) > 2000 then
    raise exception 'props_too_large';
  end if;
  perform public._log_event(auth.uid(), p_event_type, p_target_user_id, null, p_props);
end $$;


ALTER FUNCTION "public"."log_user_event"("p_event_type" "text", "p_target_user_id" "uuid", "p_props" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_file_deleted"("p_bucket" "text", "p_path" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update file_deletion_queue set deleted_at = now()
  where bucket_id = p_bucket and path = p_path;
$$;


ALTER FUNCTION "public"."mark_file_deleted"("p_bucket" "text", "p_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."propose_date_slot"("p_match_id" "uuid", "p_slot" "jsonb", "p_area" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  m matches;
  d date_proposals;
  uid uuid := auth.uid();
  slot jsonb;
begin
  m := public._date_get_match(p_match_id);

  select * into d from date_proposals
  where match_id = p_match_id and status not in ('done','cancelled')
  order by created_at desc limit 1;

  if d.id is null or d.status not in ('matched','scheduling') then
    raise exception 'invalid_status';
  end if;
  if not (coalesce(d.intent_a, false) and coalesce(d.intent_b, false)) then
    raise exception 'not_agreed';
  end if;

  -- 入力検証: 日付は明日以降・時間帯は4種のみ・ラベルは40文字以内
  if (p_slot ->> 'date') is null
     or (p_slot ->> 'date')::date <= (now() at time zone 'Asia/Tokyo')::date then
    raise exception 'invalid_slot_date';
  end if;
  if (p_slot ->> 'time_range') not in ('weekday_lunch','weekend_am','weekend_pm','weekday_night') then
    raise exception 'invalid_slot_time';
  end if;
  if (p_slot ->> 'label') is null or char_length(p_slot ->> 'label') > 40 then
    raise exception 'invalid_slot_label';
  end if;
  -- エリア名: 40文字以内 + NGワード（いいねの一言と同じ扱い。相手に届く文字列）
  if char_length(coalesce(p_area, '')) > 40 then
    raise exception 'invalid_area';
  end if;
  if public._contains_fraud_word(p_area) or public._contains_fraud_word(p_slot ->> 'label') then
    raise exception 'fraud_words_in_proposal';
  end if;

  slot := jsonb_build_object(
    'date', p_slot ->> 'date',
    'time_range', p_slot ->> 'time_range',
    'label', p_slot ->> 'label',
    'proposed_by', uid);

  update date_proposals set
    proposed_slots = coalesce(proposed_slots, '[]'::jsonb) || jsonb_build_array(slot),
    status = 'scheduling',
    area_suggestion = coalesce(nullif(trim(coalesce(p_area, '')), ''), area_suggestion)
  where id = d.id;

  return public.get_date_status(p_match_id);
end $$;


ALTER FUNCTION "public"."propose_date_slot"("p_match_id" "uuid", "p_slot" "jsonb", "p_area" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_photo_for_review"("p_path" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  if position(auth.uid()::text || '/' in p_path) <> 1 then
    raise exception 'invalid_path';
  end if;
  insert into photo_reviews (path, user_id) values (p_path, auth.uid())
  on conflict (path) do update set
    status = 'pending',
    reviewed_at = null,
    ai_verdict = null,
    ai_detail = null;
end;
$$;


ALTER FUNCTION "public"."register_photo_for_review"("p_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."respond_date_slot"("p_match_id" "uuid", "p_accept" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  m matches;
  d date_proposals;
  uid uuid := auth.uid();
  pending jsonb;
begin
  m := public._date_get_match(p_match_id);

  select * into d from date_proposals
  where match_id = p_match_id and status not in ('done','cancelled')
  order by created_at desc limit 1;

  if d.id is null or d.status <> 'scheduling'
     or jsonb_array_length(coalesce(d.proposed_slots, '[]'::jsonb)) = 0 then
    raise exception 'invalid_status';
  end if;

  pending := d.proposed_slots -> (jsonb_array_length(d.proposed_slots) - 1);

  if p_accept then
    if (pending ->> 'proposed_by')::uuid = uid then
      raise exception 'proposer_cannot_accept';
    end if;
    update date_proposals set confirmed_slot = pending, status = 'confirmed' where id = d.id;
    insert into messages (match_id, sender, body, kind) values
      (p_match_id, uid,
       '📅 デートの日程が決まりました: ' || (pending ->> 'label')
       || coalesce('（' || d.area_suggestion || '）', ''),
       'system');
  else
    -- 提案者の取り下げ・相手の見送りのどちらも候補選びからやり直し（通知なし）
    update date_proposals set status = 'matched' where id = d.id;
  end if;

  return public.get_date_status(p_match_id);
end $$;


ALTER FUNCTION "public"."respond_date_slot"("p_match_id" "uuid", "p_accept" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_verification"("verification_id" "uuid", "approve" boolean, "reason" "text" DEFAULT NULL::"text", "p_reviewer" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v verifications;
begin
  -- 行ロック + 審査済みガード（M2版から復元。並行審査・二重審査を防ぐ）
  select * into v from verifications where id = verification_id for update;
  if v.id is null then
    raise exception 'verification_not_found';
  end if;
  if v.status <> 'pending' then
    raise exception 'already_reviewed';
  end if;

  update verifications
  set status = case when approve then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = p_reviewer,
      reject_reason = case when approve then null else reason end
  where id = verification_id;

  if approve then
    update profiles set
      is_verified = case when v.kind = 'identity' then true else is_verified end,
      income_verified = case when v.kind = 'income' then true else income_verified end,
      single_cert_verified = case when v.kind = 'single_cert' then true else single_cert_verified end
    where id = v.user_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."review_verification"("verification_id" "uuid", "approve" boolean, "reason" "text", "p_reviewer" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_retention_job"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  target uuid;
  n int := 0;
begin
  for target in
    select id from profiles
    where status = 'withdrawn'
      and anonymized_at is null
      and withdrawn_at is not null
      and withdrawn_at < now() - interval '90 days'
  loop
    perform public.anonymize_profile(target);
    n := n + 1;
  end loop;
  return jsonb_build_object('anonymized', n, 'ran_at', now());
end $$;


ALTER FUNCTION "public"."run_retention_job"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_date_intent"("p_match_id" "uuid", "p_intent" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  m matches;
  d date_proposals;
  uid uuid := auth.uid();
  is_a boolean;
  both_now boolean;
begin
  m := public._date_get_match(p_match_id);
  is_a := (m.user_a = uid);

  -- 2026-07-12: 「message_count >= 20」の条件は撤廃（マッチ直後から利用可）

  select * into d from date_proposals
  where match_id = p_match_id and status not in ('done','cancelled')
  order by created_at desc limit 1;

  if d.id is null then
    insert into date_proposals (match_id, intent_a, intent_b)
    values (p_match_id,
            case when is_a then p_intent else null end,
            case when is_a then null else p_intent end)
    returning * into d;
  else
    if d.status not in ('collecting','matched') then
      raise exception 'invalid_status';
    end if;
    if is_a then
      update date_proposals set intent_a = p_intent where id = d.id returning * into d;
    else
      update date_proposals set intent_b = p_intent where id = d.id returning * into d;
    end if;
  end if;

  both_now := coalesce(d.intent_a, false) and coalesce(d.intent_b, false);

  if both_now and d.status = 'collecting' then
    update date_proposals set status = 'matched' where id = d.id;
    insert into messages (match_id, sender, body, kind) values
      (p_match_id, uid, '🎉 お二人とも「会ってみたい」が一致しました。「デートの相談」から日程を選んでみましょう。', 'system');
  elsif not both_now and d.status = 'matched' then
    update date_proposals set status = 'collecting' where id = d.id;
  end if;

  return public.get_date_status(p_match_id);
end;
$$;


ALTER FUNCTION "public"."set_date_intent"("p_match_id" "uuid", "p_intent" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_location"("p_lat" double precision, "p_lng" double precision) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  cur profile_locations;
  today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;

  -- 行ロック（並列リクエストによる回数制限の回避を防ぐ）
  select * into cur from profile_locations where user_id = uid for update;

  if cur.user_id is not null then
    if cur.updated_at > now() - interval '30 minutes' then
      raise exception 'too_frequent';
    end if;
    if cur.daily_date = today and cur.daily_count >= 8 then
      raise exception 'daily_limit';
    end if;
  end if;

  insert into profile_locations (user_id, loc_lat, loc_lng, daily_count, daily_date)
  values (
    uid,
    round(p_lat::numeric, 2)::double precision,
    round(p_lng::numeric, 2)::double precision,
    1,
    today
  )
  on conflict (user_id) do update set
    loc_lat = excluded.loc_lat,
    loc_lng = excluded.loc_lng,
    updated_at = now(),
    daily_count = case when profile_locations.daily_date = today
                       then profile_locations.daily_count + 1 else 1 end,
    daily_date = today;
end;
$$;


ALTER FUNCTION "public"."set_my_location"("p_lat" double precision, "p_lng" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_date_feedback"("p_match_id" "uuid", "p_feedback" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  m matches;
  d date_proposals;
  uid uuid := auth.uid();
  is_a boolean;
begin
  m := public._date_get_match(p_match_id);
  is_a := (m.user_a = uid);

  if p_feedback not in ('again','end') then
    raise exception 'invalid_feedback';
  end if;

  select * into d from date_proposals
  where match_id = p_match_id and status not in ('done','cancelled')
  order by created_at desc limit 1;

  if d.id is null or d.status <> 'confirmed' or d.confirmed_slot is null then
    raise exception 'invalid_status';
  end if;
  if (d.confirmed_slot ->> 'date')::date >= (now() at time zone 'Asia/Tokyo')::date then
    raise exception 'too_early'; -- デート当日までは入力不可（翌日から）
  end if;

  if is_a then
    update date_proposals set feedback_a = p_feedback where id = d.id returning * into d;
  else
    update date_proposals set feedback_b = p_feedback where id = d.id returning * into d;
  end if;

  if d.feedback_a is not null and d.feedback_b is not null then
    update date_proposals set status = 'done' where id = d.id;
  end if;

  return public.get_date_status(p_match_id);
end $$;


ALTER FUNCTION "public"."submit_date_feedback"("p_match_id" "uuid", "p_feedback" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."withdraw_account"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update profiles set status = 'withdrawn', withdrawn_at = now()
  where id = auth.uid() and status <> 'withdrawn';
  if not found then
    raise exception 'not_registered';
  end if;
  perform public._record_withdrawal(auth.uid(), false, null);
  return jsonb_build_object('ok', true);
end;
$$;


ALTER FUNCTION "public"."withdraw_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "storage"."allow_any_operation"("expected_operations" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


ALTER FUNCTION "storage"."allow_any_operation"("expected_operations" "text"[]) OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."allow_only_operation"("expected_operation" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


ALTER FUNCTION "storage"."allow_only_operation"("expected_operation" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."can_insert_object"("bucketid" "text", "name" "text", "owner" "uuid", "metadata" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


ALTER FUNCTION "storage"."can_insert_object"("bucketid" "text", "name" "text", "owner" "uuid", "metadata" "jsonb") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."enforce_bucket_name_length"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


ALTER FUNCTION "storage"."enforce_bucket_name_length"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."extension"("name" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


ALTER FUNCTION "storage"."extension"("name" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."filename"("name" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


ALTER FUNCTION "storage"."filename"("name" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."foldername"("name" "text") RETURNS "text"[]
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


ALTER FUNCTION "storage"."foldername"("name" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."get_common_prefix"("p_key" "text", "p_prefix" "text", "p_delimiter" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


ALTER FUNCTION "storage"."get_common_prefix"("p_key" "text", "p_prefix" "text", "p_delimiter" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."get_size_by_bucket"() RETURNS TABLE("size" bigint, "bucket_id" "text")
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


ALTER FUNCTION "storage"."get_size_by_bucket"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."list_multipart_uploads_with_delimiter"("bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer DEFAULT 100, "next_key_token" "text" DEFAULT ''::"text", "next_upload_token" "text" DEFAULT ''::"text") RETURNS TABLE("key" "text", "id" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


ALTER FUNCTION "storage"."list_multipart_uploads_with_delimiter"("bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer, "next_key_token" "text", "next_upload_token" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."list_objects_with_delimiter"("_bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer DEFAULT 100, "start_after" "text" DEFAULT ''::"text", "next_token" "text" DEFAULT ''::"text", "sort_order" "text" DEFAULT 'asc'::"text") RETURNS TABLE("name" "text", "id" "uuid", "metadata" "jsonb", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION "storage"."list_objects_with_delimiter"("_bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer, "start_after" "text", "next_token" "text", "sort_order" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."operation"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


ALTER FUNCTION "storage"."operation"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."protect_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION "storage"."protect_delete"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."search"("prefix" "text", "bucketname" "text", "limits" integer DEFAULT 100, "levels" integer DEFAULT 1, "offsets" integer DEFAULT 0, "search" "text" DEFAULT ''::"text", "sortcolumn" "text" DEFAULT 'name'::"text", "sortorder" "text" DEFAULT 'asc'::"text") RETURNS TABLE("name" "text", "id" "uuid", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "metadata" "jsonb")
    LANGUAGE "plpgsql" STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION "storage"."search"("prefix" "text", "bucketname" "text", "limits" integer, "levels" integer, "offsets" integer, "search" "text", "sortcolumn" "text", "sortorder" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."search_by_timestamp"("p_prefix" "text", "p_bucket_id" "text", "p_limit" integer, "p_level" integer, "p_start_after" "text", "p_sort_order" "text", "p_sort_column" "text", "p_sort_column_after" "text") RETURNS TABLE("key" "text", "name" "text", "id" "uuid", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "metadata" "jsonb")
    LANGUAGE "plpgsql" STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


ALTER FUNCTION "storage"."search_by_timestamp"("p_prefix" "text", "p_bucket_id" "text", "p_limit" integer, "p_level" integer, "p_start_after" "text", "p_sort_order" "text", "p_sort_column" "text", "p_sort_column_after" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."search_v2"("prefix" "text", "bucket_name" "text", "limits" integer DEFAULT 100, "levels" integer DEFAULT 1, "start_after" "text" DEFAULT ''::"text", "sort_order" "text" DEFAULT 'asc'::"text", "sort_column" "text" DEFAULT 'name'::"text", "sort_column_after" "text" DEFAULT ''::"text") RETURNS TABLE("key" "text", "name" "text", "id" "uuid", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "metadata" "jsonb")
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


ALTER FUNCTION "storage"."search_v2"("prefix" "text", "bucket_name" "text", "limits" integer, "levels" integer, "start_after" "text", "sort_order" "text", "sort_column" "text", "sort_column_after" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


ALTER FUNCTION "storage"."update_updated_at_column"() OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "public"."available_time_master" (
    "value" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer NOT NULL
);


ALTER TABLE "public"."available_time_master" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."block_carryover" (
    "blocker_hash" "text" NOT NULL,
    "blocked_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."block_carryover" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "blocker" "uuid" NOT NULL,
    "blocked" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "blocks_check" CHECK (("blocker" <> "blocked"))
);


ALTER TABLE "public"."blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_id" "uuid" NOT NULL,
    "started_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "duration_seconds" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."calls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_stats" (
    "date" "date" NOT NULL,
    "active_male" integer,
    "active_female" integer,
    "new_matches" integer,
    "dates_confirmed" integer,
    "forced_withdrawals" integer
);


ALTER TABLE "public"."daily_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."date_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_id" "uuid" NOT NULL,
    "intent_a" boolean,
    "intent_b" boolean,
    "status" "text" DEFAULT 'collecting'::"text" NOT NULL,
    "proposed_slots" "jsonb",
    "confirmed_slot" "jsonb",
    "area_suggestion" "text",
    "feedback_a" "text",
    "feedback_b" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "intent_matched_at" timestamp with time zone,
    "first_proposed_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone,
    "date_on" "date",
    "cancelled_at" timestamp with time zone,
    "done_at" timestamp with time zone,
    CONSTRAINT "date_proposals_feedback_a_check" CHECK (("feedback_a" = ANY (ARRAY['again'::"text", 'end'::"text"]))),
    CONSTRAINT "date_proposals_feedback_b_check" CHECK (("feedback_b" = ANY (ARRAY['again'::"text", 'end'::"text"]))),
    CONSTRAINT "date_proposals_status_check" CHECK (("status" = ANY (ARRAY['collecting'::"text", 'matched'::"text", 'scheduling'::"text", 'confirmed'::"text", 'done'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."date_proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."file_deletion_queue" (
    "bucket_id" "text" NOT NULL,
    "path" "text" NOT NULL,
    "enqueued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."file_deletion_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fraud_words" (
    "word" "text" NOT NULL
);


ALTER TABLE "public"."fraud_words" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."identity_ledger" (
    "email_hash" "text" NOT NULL,
    "banned" boolean DEFAULT false NOT NULL,
    "ban_reason" "text",
    "suppressed" boolean DEFAULT false NOT NULL,
    "report_count" integer DEFAULT 0 NOT NULL,
    "last_withdrawn_at" timestamp with time zone,
    "withdrawal_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."identity_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "from_user" "uuid" NOT NULL,
    "to_user" "uuid" NOT NULL,
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "likes_message_check" CHECK (("char_length"("message") <= 200))
);


ALTER TABLE "public"."likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_id" "uuid" NOT NULL,
    "sender" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "flagged" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "kind" "text" DEFAULT 'user'::"text" NOT NULL,
    CONSTRAINT "messages_body_check" CHECK (("char_length"("body") <= 2000)),
    CONSTRAINT "messages_kind_check" CHECK (("kind" = ANY (ARRAY['user'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."messages"."kind" IS '自動メッセージ判定の正。user=会員の発言 / system=運営の自動メッセージ。利用者はINSERT列GRANT外のため常にuser';



CREATE TABLE IF NOT EXISTS "public"."photo_reviews" (
    "path" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "ai_verdict" "text",
    "ai_detail" "text",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "photo_reviews_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."photo_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_locations" (
    "user_id" "uuid" NOT NULL,
    "loc_lat" double precision NOT NULL,
    "loc_lng" double precision NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "daily_count" integer DEFAULT 1 NOT NULL,
    "daily_date" "date" DEFAULT (("now"() AT TIME ZONE 'Asia/Tokyo'::"text"))::"date" NOT NULL
);


ALTER TABLE "public"."profile_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "nickname" "text" NOT NULL,
    "gender" "text" NOT NULL,
    "birth_date" "date" NOT NULL,
    "prefecture" "text" NOT NULL,
    "city" "text",
    "marital_history" "text" NOT NULL,
    "has_children" boolean DEFAULT false NOT NULL,
    "children_living_together" boolean,
    "ok_child_date" boolean,
    "marriage_intent" "text",
    "cohabit_view" "text",
    "money_view" "text",
    "bio" "text",
    "available_times" "text"[] DEFAULT '{}'::"text"[],
    "understands_children" boolean DEFAULT false NOT NULL,
    "understands_remarriage" boolean DEFAULT false NOT NULL,
    "photo_urls" "text"[] DEFAULT '{}'::"text"[],
    "voice_profile_url" "text",
    "is_verified" boolean DEFAULT false NOT NULL,
    "income_verified" boolean DEFAULT false NOT NULL,
    "single_cert_verified" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "value_tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "subscription_active" boolean DEFAULT false NOT NULL,
    "email_bounced" boolean DEFAULT false NOT NULL,
    "withdrawn_at" timestamp with time zone,
    "anonymized_at" timestamp with time zone,
    "age_band" "text",
    "region_block" "text",
    "bio_features" "jsonb",
    "prior_report_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "profiles_bio_check" CHECK (("char_length"("bio") <= 1000)),
    CONSTRAINT "profiles_gender_check" CHECK (("gender" = ANY (ARRAY['male'::"text", 'female'::"text"]))),
    CONSTRAINT "profiles_marital_history_check" CHECK (("marital_history" = ANY (ARRAY['unmarried'::"text", 'divorced'::"text", 'widowed'::"text"]))),
    CONSTRAINT "profiles_marriage_intent_check" CHECK (("marriage_intent" = ANY (ARRAY['asap'::"text", 'within_2y'::"text", 'someday'::"text", 'partner_only'::"text"]))),
    CONSTRAINT "profiles_min_age_check" CHECK ((("anonymized_at" IS NOT NULL) OR ("birth_date" <= (CURRENT_DATE - '35 years'::interval)))),
    CONSTRAINT "profiles_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'withdrawn'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."age_band" IS '匿名化後の学習用。生年月日は削除される';



COMMENT ON COLUMN "public"."profiles"."bio_features" IS '文字数・記号率など、原文に戻せない派生値のみ';



CREATE OR REPLACE VIEW "public"."profiles_public" AS
 SELECT "id",
    "nickname",
    "gender",
    ("date_part"('year'::"text", "age"(("birth_date")::timestamp with time zone)))::integer AS "age",
    "prefecture",
    "city",
    "marital_history",
    "marriage_intent",
    "cohabit_view",
    "money_view",
    "bio",
    "available_times",
    "value_tags",
        CASE
            WHEN ("id" = "auth"."uid"()) THEN "photo_urls"
            ELSE COALESCE(( SELECT "array_agg"("t"."u" ORDER BY "t"."ord") AS "array_agg"
               FROM "unnest"("profiles"."photo_urls") WITH ORDINALITY "t"("u", "ord")
              WHERE "public"."is_photo_of_profile"("t"."u", "profiles"."id")), '{}'::"text"[])
        END AS "photo_urls",
    "is_verified",
    "income_verified",
    "single_cert_verified",
    "status",
    "created_at"
   FROM "public"."profiles"
  WHERE (("id" = "auth"."uid"()) OR ("public"."is_caller_active"() AND ("status" = 'active'::"text") AND (NOT "public"."is_blocked_between"("auth"."uid"(), "id"))));


ALTER VIEW "public"."profiles_public" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter" "uuid" NOT NULL,
    "reported" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "detail" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reports_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'actioned'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_events" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."stripe_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "user_id" "uuid" NOT NULL,
    "stripe_customer_id" "text" NOT NULL,
    "stripe_subscription_id" "text",
    "plan" "text" NOT NULL,
    "status" "text" DEFAULT 'incomplete'::"text" NOT NULL,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscriptions_plan_check" CHECK (("plan" = ANY (ARRAY['male_1m'::"text", 'male_3m'::"text", 'male_6m'::"text"]))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['incomplete'::"text", 'incomplete_expired'::"text", 'trialing'::"text", 'active'::"text", 'past_due'::"text", 'canceled'::"text", 'unpaid'::"text", 'paused'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscriptions" IS '課金の唯一の正。書き込みは Stripe Webhook（service_role）のみ。profiles.subscription_active はここからの派生値';



COMMENT ON COLUMN "public"."subscriptions"."current_period_end" IS 'この日時までは有料機能を利用できる。解約予約時もこの日時までは利用可';



CREATE TABLE IF NOT EXISTS "public"."user_events" (
    "id" bigint NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_id" "uuid",
    "event_type" "text" NOT NULL,
    "target_user_id" "uuid",
    "match_id" "uuid",
    "props" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "user_events_type_check" CHECK (("event_type" = ANY (ARRAY['profile_view'::"text", 'discover_impression'::"text", 'filter_applied'::"text", 'like_sent'::"text", 'match_created'::"text", 'message_sent'::"text", 'call_logged'::"text", 'date_started'::"text", 'date_status_changed'::"text", 'report_created'::"text", 'block_created'::"text"])))
);


ALTER TABLE "public"."user_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."user_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."user_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."user_events_id_seq" OWNED BY "public"."user_events"."id";



CREATE TABLE IF NOT EXISTS "public"."value_tag_master" (
    "id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "category" "text" NOT NULL,
    "sort_order" integer NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."value_tag_master" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "document_url" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "reject_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "verifications_kind_check" CHECK (("kind" = ANY (ARRAY['identity'::"text", 'income'::"text", 'single_cert'::"text"]))),
    CONSTRAINT "verifications_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."verifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "storage"."buckets" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "owner" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "public" boolean DEFAULT false,
    "avif_autodetection" boolean DEFAULT false,
    "file_size_limit" bigint,
    "allowed_mime_types" "text"[],
    "owner_id" "text",
    "type" "storage"."buckettype" DEFAULT 'STANDARD'::"storage"."buckettype" NOT NULL
);


ALTER TABLE "storage"."buckets" OWNER TO "supabase_storage_admin";


COMMENT ON COLUMN "storage"."buckets"."owner" IS 'Field is deprecated, use owner_id instead';



CREATE TABLE IF NOT EXISTS "storage"."buckets_analytics" (
    "name" "text" NOT NULL,
    "type" "storage"."buckettype" DEFAULT 'ANALYTICS'::"storage"."buckettype" NOT NULL,
    "format" "text" DEFAULT 'ICEBERG'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "storage"."buckets_analytics" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."buckets_vectors" (
    "id" "text" NOT NULL,
    "type" "storage"."buckettype" DEFAULT 'VECTOR'::"storage"."buckettype" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "storage"."buckets_vectors" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."iceberg_namespaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bucket_name" "text" NOT NULL,
    "name" "text" NOT NULL COLLATE "pg_catalog"."C",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "catalog_id" "uuid" NOT NULL
);


ALTER TABLE "storage"."iceberg_namespaces" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."iceberg_tables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "namespace_id" "uuid" NOT NULL,
    "bucket_name" "text" NOT NULL,
    "name" "text" NOT NULL COLLATE "pg_catalog"."C",
    "location" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "remote_table_id" "text",
    "shard_key" "text",
    "shard_id" "text",
    "catalog_id" "uuid" NOT NULL
);


ALTER TABLE "storage"."iceberg_tables" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."migrations" (
    "id" integer NOT NULL,
    "name" character varying(100) NOT NULL,
    "hash" character varying(40) NOT NULL,
    "executed_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "storage"."migrations" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bucket_id" "text",
    "name" "text",
    "owner" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_accessed_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb",
    "path_tokens" "text"[] GENERATED ALWAYS AS ("string_to_array"("name", '/'::"text")) STORED,
    "version" "text",
    "owner_id" "text",
    "user_metadata" "jsonb"
);


ALTER TABLE "storage"."objects" OWNER TO "supabase_storage_admin";


COMMENT ON COLUMN "storage"."objects"."owner" IS 'Field is deprecated, use owner_id instead';



CREATE TABLE IF NOT EXISTS "storage"."s3_multipart_uploads" (
    "id" "text" NOT NULL,
    "in_progress_size" bigint DEFAULT 0 NOT NULL,
    "upload_signature" "text" NOT NULL,
    "bucket_id" "text" NOT NULL,
    "key" "text" NOT NULL COLLATE "pg_catalog"."C",
    "version" "text" NOT NULL,
    "owner_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_metadata" "jsonb",
    "metadata" "jsonb"
);


ALTER TABLE "storage"."s3_multipart_uploads" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."s3_multipart_uploads_parts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "upload_id" "text" NOT NULL,
    "size" bigint DEFAULT 0 NOT NULL,
    "part_number" integer NOT NULL,
    "bucket_id" "text" NOT NULL,
    "key" "text" NOT NULL COLLATE "pg_catalog"."C",
    "etag" "text" NOT NULL,
    "owner_id" "text",
    "version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "storage"."s3_multipart_uploads_parts" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."vector_indexes" (
    "id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL COLLATE "pg_catalog"."C",
    "bucket_id" "text" NOT NULL,
    "data_type" "text" NOT NULL,
    "dimension" integer NOT NULL,
    "distance_metric" "text" NOT NULL,
    "metadata_configuration" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "storage"."vector_indexes" OWNER TO "supabase_storage_admin";


ALTER TABLE ONLY "public"."user_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."available_time_master"
    ADD CONSTRAINT "available_time_master_pkey" PRIMARY KEY ("value");



ALTER TABLE ONLY "public"."block_carryover"
    ADD CONSTRAINT "block_carryover_pkey" PRIMARY KEY ("blocker_hash", "blocked_hash");



ALTER TABLE ONLY "public"."blocks"
    ADD CONSTRAINT "blocks_blocker_blocked_key" UNIQUE ("blocker", "blocked");



ALTER TABLE ONLY "public"."blocks"
    ADD CONSTRAINT "blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_stats"
    ADD CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("date");



ALTER TABLE ONLY "public"."date_proposals"
    ADD CONSTRAINT "date_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."file_deletion_queue"
    ADD CONSTRAINT "file_deletion_queue_pkey" PRIMARY KEY ("bucket_id", "path");



ALTER TABLE ONLY "public"."fraud_words"
    ADD CONSTRAINT "fraud_words_pkey" PRIMARY KEY ("word");



ALTER TABLE ONLY "public"."identity_ledger"
    ADD CONSTRAINT "identity_ledger_pkey" PRIMARY KEY ("email_hash");



ALTER TABLE ONLY "public"."likes"
    ADD CONSTRAINT "likes_from_user_to_user_key" UNIQUE ("from_user", "to_user");



ALTER TABLE ONLY "public"."likes"
    ADD CONSTRAINT "likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_user_a_user_b_key" UNIQUE ("user_a", "user_b");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_reviews"
    ADD CONSTRAINT "photo_reviews_pkey" PRIMARY KEY ("path");



ALTER TABLE ONLY "public"."profile_locations"
    ADD CONSTRAINT "profile_locations_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_events"
    ADD CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."value_tag_master"
    ADD CONSTRAINT "value_tag_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verifications"
    ADD CONSTRAINT "verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."buckets_analytics"
    ADD CONSTRAINT "buckets_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."buckets"
    ADD CONSTRAINT "buckets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."buckets_vectors"
    ADD CONSTRAINT "buckets_vectors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."iceberg_namespaces"
    ADD CONSTRAINT "iceberg_namespaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."iceberg_tables"
    ADD CONSTRAINT "iceberg_tables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."migrations"
    ADD CONSTRAINT "migrations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "storage"."migrations"
    ADD CONSTRAINT "migrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."objects"
    ADD CONSTRAINT "objects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads_parts"
    ADD CONSTRAINT "s3_multipart_uploads_parts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads"
    ADD CONSTRAINT "s3_multipart_uploads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."vector_indexes"
    ADD CONSTRAINT "vector_indexes_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_blocks_blocked" ON "public"."blocks" USING "btree" ("blocked");



CREATE INDEX "idx_date_proposals_date_on" ON "public"."date_proposals" USING "btree" ("date_on");



CREATE INDEX "idx_likes_from_user_created" ON "public"."likes" USING "btree" ("from_user", "created_at");



CREATE INDEX "idx_likes_to_user_created" ON "public"."likes" USING "btree" ("to_user", "created_at");



CREATE INDEX "idx_matches_user_a" ON "public"."matches" USING "btree" ("user_a");



CREATE INDEX "idx_matches_user_b" ON "public"."matches" USING "btree" ("user_b");



CREATE INDEX "idx_messages_match_created" ON "public"."messages" USING "btree" ("match_id", "created_at");



CREATE INDEX "idx_profiles_available_times" ON "public"."profiles" USING "gin" ("available_times");



CREATE INDEX "idx_profiles_status_gender_birth" ON "public"."profiles" USING "btree" ("status", "gender", "birth_date");



CREATE INDEX "idx_profiles_value_tags" ON "public"."profiles" USING "gin" ("value_tags");



CREATE INDEX "idx_reports_reported_status" ON "public"."reports" USING "btree" ("reported", "status");



CREATE INDEX "idx_user_events_actor" ON "public"."user_events" USING "btree" ("actor_id", "occurred_at");



CREATE INDEX "idx_user_events_occurred" ON "public"."user_events" USING "btree" ("occurred_at");



CREATE INDEX "idx_user_events_type" ON "public"."user_events" USING "btree" ("event_type", "occurred_at");



CREATE INDEX "idx_verifications_status" ON "public"."verifications" USING "btree" ("status", "created_at");



CREATE UNIQUE INDEX "subscriptions_stripe_customer_id_key" ON "public"."subscriptions" USING "btree" ("stripe_customer_id");



CREATE UNIQUE INDEX "uniq_active_date_proposal" ON "public"."date_proposals" USING "btree" ("match_id") WHERE ("status" <> ALL (ARRAY['done'::"text", 'cancelled'::"text"]));



CREATE UNIQUE INDEX "bname" ON "storage"."buckets" USING "btree" ("name");



CREATE UNIQUE INDEX "bucketid_objname" ON "storage"."objects" USING "btree" ("bucket_id", "name");



CREATE UNIQUE INDEX "buckets_analytics_unique_name_idx" ON "storage"."buckets_analytics" USING "btree" ("name") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_iceberg_namespaces_bucket_id" ON "storage"."iceberg_namespaces" USING "btree" ("catalog_id", "name");



CREATE UNIQUE INDEX "idx_iceberg_tables_location" ON "storage"."iceberg_tables" USING "btree" ("location");



CREATE UNIQUE INDEX "idx_iceberg_tables_namespace_id" ON "storage"."iceberg_tables" USING "btree" ("catalog_id", "namespace_id", "name");



CREATE INDEX "idx_multipart_uploads_list" ON "storage"."s3_multipart_uploads" USING "btree" ("bucket_id", "key", "created_at");



CREATE INDEX "idx_objects_bucket_id_name" ON "storage"."objects" USING "btree" ("bucket_id", "name" COLLATE "C");



CREATE INDEX "idx_objects_bucket_id_name_lower" ON "storage"."objects" USING "btree" ("bucket_id", "lower"("name") COLLATE "C");



CREATE INDEX "name_prefix_search" ON "storage"."objects" USING "btree" ("name" "text_pattern_ops");



CREATE UNIQUE INDEX "vector_indexes_name_bucket_id_idx" ON "storage"."vector_indexes" USING "btree" ("name", "bucket_id");



CREATE OR REPLACE TRIGGER "trg_enforce_message_entitlement" BEFORE INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."_enforce_message_entitlement"();



CREATE OR REPLACE TRIGGER "trg_enforce_registration_eligibility" BEFORE INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."_enforce_registration_eligibility"();



CREATE OR REPLACE TRIGGER "trg_ev_block" AFTER INSERT ON "public"."blocks" FOR EACH ROW EXECUTE FUNCTION "public"."_ev_block"();



CREATE OR REPLACE TRIGGER "trg_ev_call" AFTER INSERT ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."_ev_call"();



CREATE OR REPLACE TRIGGER "trg_ev_date" AFTER INSERT OR UPDATE ON "public"."date_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."_ev_date"();



CREATE OR REPLACE TRIGGER "trg_ev_like" AFTER INSERT ON "public"."likes" FOR EACH ROW EXECUTE FUNCTION "public"."_ev_like"();



CREATE OR REPLACE TRIGGER "trg_ev_match" AFTER INSERT ON "public"."matches" FOR EACH ROW EXECUTE FUNCTION "public"."_ev_match"();



CREATE OR REPLACE TRIGGER "trg_ev_message" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."_ev_message"();



CREATE OR REPLACE TRIGGER "trg_ev_report" AFTER INSERT ON "public"."reports" FOR EACH ROW EXECUTE FUNCTION "public"."_ev_report"();



CREATE OR REPLACE TRIGGER "trg_likes_mutual_match" AFTER INSERT ON "public"."likes" FOR EACH ROW EXECUTE FUNCTION "public"."create_match_on_mutual_like"();



CREATE OR REPLACE TRIGGER "trg_messages_fraud" BEFORE INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."flag_fraud_message"();



CREATE OR REPLACE TRIGGER "trg_messages_increment_count" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."increment_message_count"();



CREATE OR REPLACE TRIGGER "trg_restore_after_reregistration" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."_restore_after_reregistration"();



CREATE OR REPLACE TRIGGER "trg_stamp_date_transitions" BEFORE UPDATE ON "public"."date_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."_stamp_date_transitions"();



CREATE OR REPLACE TRIGGER "trg_sync_subscription_flag" AFTER INSERT OR DELETE OR UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."_sync_subscription_flag"();



CREATE OR REPLACE TRIGGER "trg_validate_photo_ownership" BEFORE INSERT OR UPDATE OF "photo_urls" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."_validate_photo_ownership"();



CREATE OR REPLACE TRIGGER "trg_validate_profile_arrays" BEFORE INSERT OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."_validate_profile_arrays"();



CREATE OR REPLACE TRIGGER "enforce_bucket_name_length_trigger" BEFORE INSERT OR UPDATE OF "name" ON "storage"."buckets" FOR EACH ROW EXECUTE FUNCTION "storage"."enforce_bucket_name_length"();



CREATE OR REPLACE TRIGGER "protect_buckets_delete" BEFORE DELETE ON "storage"."buckets" FOR EACH STATEMENT EXECUTE FUNCTION "storage"."protect_delete"();



CREATE OR REPLACE TRIGGER "protect_objects_delete" BEFORE DELETE ON "storage"."objects" FOR EACH STATEMENT EXECUTE FUNCTION "storage"."protect_delete"();



CREATE OR REPLACE TRIGGER "update_objects_updated_at" BEFORE UPDATE ON "storage"."objects" FOR EACH ROW EXECUTE FUNCTION "storage"."update_updated_at_column"();



ALTER TABLE ONLY "public"."blocks"
    ADD CONSTRAINT "blocks_blocked_fkey" FOREIGN KEY ("blocked") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."blocks"
    ADD CONSTRAINT "blocks_blocker_fkey" FOREIGN KEY ("blocker") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id");



ALTER TABLE ONLY "public"."date_proposals"
    ADD CONSTRAINT "date_proposals_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id");



ALTER TABLE ONLY "public"."likes"
    ADD CONSTRAINT "likes_from_user_fkey" FOREIGN KEY ("from_user") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."likes"
    ADD CONSTRAINT "likes_to_user_fkey" FOREIGN KEY ("to_user") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_user_a_fkey" FOREIGN KEY ("user_a") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_user_b_fkey" FOREIGN KEY ("user_b") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_fkey" FOREIGN KEY ("sender") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."photo_reviews"
    ADD CONSTRAINT "photo_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_locations"
    ADD CONSTRAINT "profile_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_reported_fkey" FOREIGN KEY ("reported") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_reporter_fkey" FOREIGN KEY ("reporter") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id");



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."verifications"
    ADD CONSTRAINT "verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "storage"."iceberg_namespaces"
    ADD CONSTRAINT "iceberg_namespaces_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "storage"."buckets_analytics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "storage"."iceberg_tables"
    ADD CONSTRAINT "iceberg_tables_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "storage"."buckets_analytics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "storage"."iceberg_tables"
    ADD CONSTRAINT "iceberg_tables_namespace_id_fkey" FOREIGN KEY ("namespace_id") REFERENCES "storage"."iceberg_namespaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "storage"."objects"
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads"
    ADD CONSTRAINT "s3_multipart_uploads_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads_parts"
    ADD CONSTRAINT "s3_multipart_uploads_parts_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads_parts"
    ADD CONSTRAINT "s3_multipart_uploads_parts_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "storage"."s3_multipart_uploads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "storage"."vector_indexes"
    ADD CONSTRAINT "vector_indexes_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets_vectors"("id");



ALTER TABLE "public"."available_time_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."block_carryover" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."date_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."file_deletion_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fraud_words" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."identity_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."matches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."value_tag_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."verifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "当事者のみ更新可" ON "public"."calls" FOR UPDATE TO "authenticated" USING ("public"."is_match_participant"("match_id")) WITH CHECK ("public"."is_match_participant"("match_id"));



CREATE POLICY "当事者のみ閲覧可" ON "public"."calls" FOR SELECT TO "authenticated" USING ("public"."is_match_participant"("match_id"));



CREATE POLICY "当事者のみ閲覧可" ON "public"."matches" FOR SELECT TO "authenticated" USING ((("user_a" = "auth"."uid"()) OR ("user_b" = "auth"."uid"())));



CREATE POLICY "当事者のみ閲覧可" ON "public"."messages" FOR SELECT TO "authenticated" USING ("public"."is_match_participant"("match_id"));



CREATE POLICY "当事者・active・非ブロックのみ記録作成可" ON "public"."calls" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_match_participant"("match_id") AND (NOT "public"."is_match_blocked"("match_id")) AND "public"."is_caller_active"()));



CREATE POLICY "当事者・非ブロック・送信資格ありのみ送信可" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK ((("sender" = "auth"."uid"()) AND "public"."is_match_participant"("match_id") AND (NOT "public"."is_match_blocked"("match_id")) AND "public"."can_caller_message"()));



CREATE POLICY "本人のみ作成可" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "本人のみ更新可" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "本人のみ申請作成可" ON "public"."verifications" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "本人のみ自分の契約を閲覧可" ON "public"."subscriptions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "本人のみ自分の審査状況を閲覧可" ON "public"."photo_reviews" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "本人のみ閲覧可" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "本人のブロックのみ全操作可" ON "public"."blocks" TO "authenticated" USING (("blocker" = "auth"."uid"())) WITH CHECK (("blocker" = "auth"."uid"()));



CREATE POLICY "本人は自分の申請を閲覧可" ON "public"."verifications" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "本人名義の通報のみ作成可" ON "public"."reports" FOR INSERT TO "authenticated" WITH CHECK (("reporter" = "auth"."uid"()));



CREATE POLICY "自分が送った/もらったいいねを閲覧可" ON "public"."likes" FOR SELECT TO "authenticated" USING ((("from_user" = "auth"."uid"()) OR ("to_user" = "auth"."uid"())));



CREATE POLICY "誰でも辞書を閲覧可" ON "public"."available_time_master" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "誰でも辞書を閲覧可" ON "public"."value_tag_master" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "storage"."buckets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."buckets_analytics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."buckets_vectors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."iceberg_namespaces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."iceberg_tables" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."migrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."objects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "photos_本人または可視な承認済みのみ読み取り" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'photos'::"text") AND ((("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text") OR "public"."is_photo_visible_to"("name"))));



CREATE POLICY "photos_本人フォルダのみアップロード可" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'photos'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



ALTER TABLE "storage"."s3_multipart_uploads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."s3_multipart_uploads_parts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."vector_indexes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "verifications_本人フォルダのみアップロード可" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'verifications'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT USAGE ON SCHEMA "storage" TO "postgres" WITH GRANT OPTION;
GRANT USAGE ON SCHEMA "storage" TO "anon";
GRANT USAGE ON SCHEMA "storage" TO "authenticated";
GRANT USAGE ON SCHEMA "storage" TO "service_role";
GRANT ALL ON SCHEMA "storage" TO "supabase_storage_admin" WITH GRANT OPTION;
GRANT ALL ON SCHEMA "storage" TO "dashboard_user";



REVOKE ALL ON FUNCTION "public"."_age_band"("p_birth" "date") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_bio_features"("p_bio" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_contains_fraud_word"("p_text" "text") FROM PUBLIC;



GRANT MAINTAIN ON TABLE "public"."matches" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."matches" TO "authenticated";
GRANT ALL ON TABLE "public"."matches" TO "service_role";



REVOKE ALL ON FUNCTION "public"."_date_get_match"("p_match_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_distance_km"("lat1" double precision, "lng1" double precision, "lat2" double precision, "lng2" double precision) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_email_hash"("p_email" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_email_hash_of"("p_user" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_enforce_message_entitlement"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_enforce_registration_eligibility"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_ev_block"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_ev_call"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_ev_date"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_ev_like"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_ev_match"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_ev_message"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_ev_report"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_log_event"("p_actor" "uuid", "p_type" "text", "p_target" "uuid", "p_match" "uuid", "p_props" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_record_withdrawal"("p_user" "uuid", "p_banned" boolean, "p_reason" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_region_block"("p_pref" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_restore_after_reregistration"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_snap_lat"("p_lat" double precision) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_snap_lng"("p_lng" double precision) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_stamp_date_transitions"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_sync_subscription_flag"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_validate_photo_ownership"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_validate_profile_arrays"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."anonymize_profile"("p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."anonymize_profile"("p_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ban_account"("p_user" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ban_account"("p_user" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_caller_message"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_caller_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_caller_message"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_date"("p_match_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_date"("p_match_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_date"("p_match_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_daily_stats"("p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_daily_stats"("p_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_match_on_mutual_like"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."expire_stale_subscriptions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_stale_subscriptions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."flag_fraud_message"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."get_approved_photo_paths"("p_paths" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_approved_photo_paths"("p_paths" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_date_status"("p_match_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_date_status"("p_match_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_date_status"("p_match_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_pending_file_deletions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_pending_file_deletions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_profile_distances"("p_user_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_profile_distances"("p_user_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_profile_distances"("p_user_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_suppression_list"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_suppression_list"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."increment_message_count"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."is_blocked_between"("a" "uuid", "b" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_blocked_between"("a" "uuid", "b" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_blocked_between"("a" "uuid", "b" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_caller_active"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_caller_active"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_caller_active"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_match_blocked"("target_match" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_match_blocked"("target_match" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_match_blocked"("target_match" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_match_participant"("target_match" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_match_participant"("target_match" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_match_participant"("target_match" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_photo_approved"("p_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_photo_approved"("p_path" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_photo_of_profile"("p_path" "text", "p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_photo_of_profile"("p_path" "text", "p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_photo_of_profile"("p_path" "text", "p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_photo_visible_to"("p_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_photo_visible_to"("p_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_photo_visible_to"("p_path" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_subscription_active"("p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_subscription_active"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_subscription_active"("p_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_user_event"("p_event_type" "text", "p_target_user_id" "uuid", "p_props" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_user_event"("p_event_type" "text", "p_target_user_id" "uuid", "p_props" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_user_event"("p_event_type" "text", "p_target_user_id" "uuid", "p_props" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_file_deleted"("p_bucket" "text", "p_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_file_deleted"("p_bucket" "text", "p_path" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."propose_date_slot"("p_match_id" "uuid", "p_slot" "jsonb", "p_area" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."propose_date_slot"("p_match_id" "uuid", "p_slot" "jsonb", "p_area" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."propose_date_slot"("p_match_id" "uuid", "p_slot" "jsonb", "p_area" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_photo_for_review"("p_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_photo_for_review"("p_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_photo_for_review"("p_path" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."respond_date_slot"("p_match_id" "uuid", "p_accept" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."respond_date_slot"("p_match_id" "uuid", "p_accept" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."respond_date_slot"("p_match_id" "uuid", "p_accept" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_verification"("verification_id" "uuid", "approve" boolean, "reason" "text", "p_reviewer" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_verification"("verification_id" "uuid", "approve" boolean, "reason" "text", "p_reviewer" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_retention_job"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_retention_job"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_date_intent"("p_match_id" "uuid", "p_intent" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_date_intent"("p_match_id" "uuid", "p_intent" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_date_intent"("p_match_id" "uuid", "p_intent" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_my_location"("p_lat" double precision, "p_lng" double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_location"("p_lat" double precision, "p_lng" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_my_location"("p_lat" double precision, "p_lng" double precision) TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_date_feedback"("p_match_id" "uuid", "p_feedback" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_date_feedback"("p_match_id" "uuid", "p_feedback" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_date_feedback"("p_match_id" "uuid", "p_feedback" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."withdraw_account"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."withdraw_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."withdraw_account"() TO "service_role";



GRANT MAINTAIN ON TABLE "public"."available_time_master" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."available_time_master" TO "authenticated";
GRANT ALL ON TABLE "public"."available_time_master" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."block_carryover" TO "anon";
GRANT MAINTAIN ON TABLE "public"."block_carryover" TO "authenticated";
GRANT ALL ON TABLE "public"."block_carryover" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."blocks" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."blocks" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."calls" TO "anon";
GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."calls" TO "authenticated";
GRANT ALL ON TABLE "public"."calls" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."daily_stats" TO "anon";
GRANT MAINTAIN ON TABLE "public"."daily_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_stats" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."date_proposals" TO "anon";
GRANT MAINTAIN ON TABLE "public"."date_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."date_proposals" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."file_deletion_queue" TO "anon";
GRANT MAINTAIN ON TABLE "public"."file_deletion_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."file_deletion_queue" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."fraud_words" TO "anon";
GRANT MAINTAIN ON TABLE "public"."fraud_words" TO "authenticated";
GRANT ALL ON TABLE "public"."fraud_words" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."identity_ledger" TO "anon";
GRANT MAINTAIN ON TABLE "public"."identity_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."identity_ledger" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."likes" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."likes" TO "authenticated";
GRANT ALL ON TABLE "public"."likes" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."messages" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT INSERT("match_id") ON TABLE "public"."messages" TO "authenticated";



GRANT INSERT("sender") ON TABLE "public"."messages" TO "authenticated";



GRANT INSERT("body") ON TABLE "public"."messages" TO "authenticated";



GRANT MAINTAIN ON TABLE "public"."photo_reviews" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."photo_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_reviews" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."profile_locations" TO "anon";
GRANT MAINTAIN ON TABLE "public"."profile_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_locations" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("id"),INSERT("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("nickname"),INSERT("nickname"),UPDATE("nickname") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("gender"),INSERT("gender") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("birth_date"),INSERT("birth_date") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("prefecture"),INSERT("prefecture"),UPDATE("prefecture") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("city"),INSERT("city"),UPDATE("city") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("marital_history"),INSERT("marital_history"),UPDATE("marital_history") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("has_children"),INSERT("has_children"),UPDATE("has_children") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("children_living_together"),INSERT("children_living_together"),UPDATE("children_living_together") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("ok_child_date"),INSERT("ok_child_date"),UPDATE("ok_child_date") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("marriage_intent"),INSERT("marriage_intent"),UPDATE("marriage_intent") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("cohabit_view"),INSERT("cohabit_view"),UPDATE("cohabit_view") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("money_view"),INSERT("money_view"),UPDATE("money_view") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("bio"),INSERT("bio"),UPDATE("bio") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("available_times"),INSERT("available_times"),UPDATE("available_times") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("understands_children"),INSERT("understands_children"),UPDATE("understands_children") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("understands_remarriage"),INSERT("understands_remarriage"),UPDATE("understands_remarriage") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("photo_urls"),INSERT("photo_urls"),UPDATE("photo_urls") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("voice_profile_url") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("is_verified") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("income_verified") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("single_cert_verified") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("value_tags"),INSERT("value_tags"),UPDATE("value_tags") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("subscription_active") ON TABLE "public"."profiles" TO "authenticated";



GRANT MAINTAIN ON TABLE "public"."profiles_public" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."profiles_public" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles_public" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."reports" TO "anon";
GRANT MAINTAIN ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT INSERT("reporter") ON TABLE "public"."reports" TO "authenticated";



GRANT INSERT("reported") ON TABLE "public"."reports" TO "authenticated";



GRANT INSERT("reason") ON TABLE "public"."reports" TO "authenticated";



GRANT INSERT("detail") ON TABLE "public"."reports" TO "authenticated";



GRANT ALL ON TABLE "public"."stripe_events" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT SELECT("user_id") ON TABLE "public"."subscriptions" TO "authenticated";



GRANT SELECT("plan") ON TABLE "public"."subscriptions" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."subscriptions" TO "authenticated";



GRANT SELECT("current_period_end") ON TABLE "public"."subscriptions" TO "authenticated";



GRANT SELECT("cancel_at_period_end") ON TABLE "public"."subscriptions" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."subscriptions" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."subscriptions" TO "authenticated";



GRANT MAINTAIN ON TABLE "public"."user_events" TO "anon";
GRANT MAINTAIN ON TABLE "public"."user_events" TO "authenticated";
GRANT ALL ON TABLE "public"."user_events" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."user_events_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."user_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_events_id_seq" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."value_tag_master" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."value_tag_master" TO "authenticated";
GRANT ALL ON TABLE "public"."value_tag_master" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."verifications" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."verifications" TO "service_role";



GRANT INSERT("user_id") ON TABLE "public"."verifications" TO "authenticated";



GRANT INSERT("kind") ON TABLE "public"."verifications" TO "authenticated";



GRANT INSERT("document_url") ON TABLE "public"."verifications" TO "authenticated";



GRANT ALL ON TABLE "storage"."buckets" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "storage"."buckets" TO "service_role";
GRANT ALL ON TABLE "storage"."buckets" TO "authenticated";
GRANT ALL ON TABLE "storage"."buckets" TO "anon";



GRANT ALL ON TABLE "storage"."buckets_analytics" TO "service_role";
GRANT ALL ON TABLE "storage"."buckets_analytics" TO "authenticated";
GRANT ALL ON TABLE "storage"."buckets_analytics" TO "anon";



GRANT SELECT ON TABLE "storage"."buckets_vectors" TO "service_role";
GRANT SELECT ON TABLE "storage"."buckets_vectors" TO "authenticated";
GRANT SELECT ON TABLE "storage"."buckets_vectors" TO "anon";



GRANT ALL ON TABLE "storage"."iceberg_namespaces" TO "service_role";
GRANT SELECT ON TABLE "storage"."iceberg_namespaces" TO "authenticated";
GRANT SELECT ON TABLE "storage"."iceberg_namespaces" TO "anon";



GRANT ALL ON TABLE "storage"."iceberg_tables" TO "service_role";
GRANT SELECT ON TABLE "storage"."iceberg_tables" TO "authenticated";
GRANT SELECT ON TABLE "storage"."iceberg_tables" TO "anon";



GRANT ALL ON TABLE "storage"."objects" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "storage"."objects" TO "service_role";
GRANT ALL ON TABLE "storage"."objects" TO "authenticated";
GRANT ALL ON TABLE "storage"."objects" TO "anon";



GRANT ALL ON TABLE "storage"."s3_multipart_uploads" TO "service_role";
GRANT SELECT ON TABLE "storage"."s3_multipart_uploads" TO "authenticated";
GRANT SELECT ON TABLE "storage"."s3_multipart_uploads" TO "anon";



GRANT ALL ON TABLE "storage"."s3_multipart_uploads_parts" TO "service_role";
GRANT SELECT ON TABLE "storage"."s3_multipart_uploads_parts" TO "authenticated";
GRANT SELECT ON TABLE "storage"."s3_multipart_uploads_parts" TO "anon";



GRANT SELECT ON TABLE "storage"."vector_indexes" TO "service_role";
GRANT SELECT ON TABLE "storage"."vector_indexes" TO "authenticated";
GRANT SELECT ON TABLE "storage"."vector_indexes" TO "anon";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON FUNCTIONS TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON TABLES TO "service_role";




