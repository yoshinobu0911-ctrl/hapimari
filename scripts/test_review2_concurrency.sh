#!/usr/bin/env bash
# レビュー第2弾（2026-09-02）並列競合の攻撃再現テスト
#   C1: #4  位置更新の回数制限を並列リクエストで回避できないこと（行ロック）
#   C2: #10 相互いいねの同時挿入でマッチが欠落しないこと（アドバイザリロック）
# 実行: bash scripts/test_review2_concurrency.sh
# 方式: 2本のpsqlセッションを重ねて実行し、後発が先発のコミットを待つこと
#       （所要時間）と最終状態の両方を検証する。テストデータは終了時に削除する。
set -u
DB="docker exec -i supabase_db_hapimari psql -U postgres -d postgres -Atq"
MALE="00000000-0000-0000-0000-000000000003"   # seed03（男性）
FEMALE="00000000-0000-0000-0000-000000000020" # seed20（女性）
CLAIMS_MALE="{\"sub\": \"$MALE\", \"role\": \"authenticated\"}"

echo "=== C1: 位置更新の並列リクエスト（#4） ==="
# 前提: 2時間前に更新済みの行（30分制限の対象外＝どちらか1回だけ通るはず）
$DB <<SQL
delete from profile_locations where user_id = '$MALE';
insert into profile_locations (user_id, loc_lat, loc_lng, updated_at, daily_count, daily_date)
values ('$MALE', 35.68, 139.76, now() - interval '2 hours', 1, (now() at time zone 'Asia/Tokyo')::date);
SQL

# セッションA: 更新して3秒保持してからコミット（行ロックを握り続ける）
$DB > /tmp/c1_a.log 2>&1 <<SQL &
select set_config('request.jwt.claims', '$CLAIMS_MALE', false);
set role authenticated;
begin;
select set_my_location(35.70, 139.70);
select pg_sleep(3);
commit;
select 'A: committed';
SQL
A_PID=$!
sleep 1
# セッションB: Aの保持中に同じ更新を試みる（修正前は即成功=制限回避が成立していた）
B_START=$(date +%s%N)
$DB > /tmp/c1_b.log 2>&1 <<SQL
select set_config('request.jwt.claims', '$CLAIMS_MALE', false);
set role authenticated;
select set_my_location(35.71, 139.71);
SQL
B_END=$(date +%s%N)
wait $A_PID
B_MS=$(( (B_END - B_START) / 1000000 ))

echo "--- セッションA出力 ---"; cat /tmp/c1_a.log
echo "--- セッションB出力（所要 ${B_MS}ms） ---"; cat /tmp/c1_b.log
if grep -q "too_frequent" /tmp/c1_b.log && [ "$B_MS" -ge 1500 ]; then
  echo "PASS: 後発はロック解放を待った上で too_frequent（並列でも1回しか通らない）"
else
  echo "FAIL: 並列リクエストが制限を回避できた可能性（B所要 ${B_MS}ms / ログ確認）"
fi
FINAL=$($DB -c "select daily_count || '/' || to_char(updated_at, 'HH24:MI:SS') from profile_locations where user_id = '$MALE';")
echo "最終状態 daily_count/updated_at: $FINAL（daily_countが1回分だけ増えて2なら正常）"
$DB -c "delete from profile_locations where user_id = '$MALE';" > /dev/null

echo ""
echo "=== C2: 相互いいねの同時挿入（#10） ==="
# 前提: ペア間に既存のいいね・マッチがない状態
$DB <<SQL
delete from user_events where match_id in (select id from matches where user_a = least('$MALE'::uuid,'$FEMALE'::uuid) and user_b = greatest('$MALE'::uuid,'$FEMALE'::uuid));
delete from matches where user_a = least('$MALE'::uuid,'$FEMALE'::uuid) and user_b = greatest('$MALE'::uuid,'$FEMALE'::uuid);
delete from user_events where (actor_id = '$MALE' and target_user_id = '$FEMALE') or (actor_id = '$FEMALE' and target_user_id = '$MALE');
delete from likes where (from_user = '$MALE' and to_user = '$FEMALE') or (from_user = '$FEMALE' and to_user = '$MALE');
SQL

# セッションA: いいね(M→F)を挿入したまま3秒コミットしない
$DB > /tmp/c2_a.log 2>&1 <<SQL &
begin;
insert into likes (from_user, to_user) values ('$MALE', '$FEMALE');
select pg_sleep(3);
commit;
select 'A: committed';
SQL
A_PID=$!
sleep 1
# セッションB: 逆方向のいいね(F→M)。修正前はAの行が見えず両者マッチ無しで終わる
B_START=$(date +%s%N)
$DB > /tmp/c2_b.log 2>&1 <<SQL
insert into likes (from_user, to_user) values ('$FEMALE', '$MALE');
select 'B: inserted';
SQL
B_END=$(date +%s%N)
wait $A_PID
B_MS=$(( (B_END - B_START) / 1000000 ))

echo "--- セッションA出力 ---"; cat /tmp/c2_a.log
echo "--- セッションB出力（所要 ${B_MS}ms） ---"; cat /tmp/c2_b.log
MATCHES=$($DB -c "select count(*) from matches where user_a = least('$MALE'::uuid,'$FEMALE'::uuid) and user_b = greatest('$MALE'::uuid,'$FEMALE'::uuid);")
echo "マッチ件数: $MATCHES"
if [ "$MATCHES" = "1" ] && [ "$B_MS" -ge 1500 ]; then
  echo "PASS: 後発がロックで直列化され、同時相互いいねでもマッチが1件成立"
else
  echo "FAIL: マッチ件数=$MATCHES / B所要 ${B_MS}ms（欠落または直列化されていない）"
fi
# 後片付け（作成したテストデータを削除）
$DB > /dev/null <<SQL
delete from user_events where match_id in (select id from matches where user_a = least('$MALE'::uuid,'$FEMALE'::uuid) and user_b = greatest('$MALE'::uuid,'$FEMALE'::uuid));
delete from matches where user_a = least('$MALE'::uuid,'$FEMALE'::uuid) and user_b = greatest('$MALE'::uuid,'$FEMALE'::uuid);
delete from user_events where (actor_id = '$MALE' and target_user_id = '$FEMALE') or (actor_id = '$FEMALE' and target_user_id = '$MALE');
delete from likes where (from_user = '$MALE' and to_user = '$FEMALE') or (from_user = '$FEMALE' and to_user = '$MALE');
SQL
echo "（テストデータは削除済み）"
