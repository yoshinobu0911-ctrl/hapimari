#!/usr/bin/env bash
# 全SQL攻撃再現テストの一括実行（レビュアー向け・コピペ1発で再現できるようにする）
# 前提: supabase start 済み（コンテナ名 supabase_db_hapimari）
# 実行: bash scripts/run_sql_tests.sh
#   → 各スイートの PASS/FAIL 行と、スイートごとの件数チェックを表示する。全文が見たい場合は
#     docker exec supabase_db_hapimari psql -U postgres -d postgres -f /tmp/<file>.sql
# 並列競合（行ロック・アドバイザリロック）は別スクリプト:
#   bash scripts/test_review2_concurrency.sh
#
# 2026-09-20 改訂（PR#1 指摘 4055523941）:
#   旧版は「行頭FAIL」だけを数えていたため、psqlのERRORでアサーションが1件も走らなくても
#   「全スイート PASS（FAIL 0件）」と表示していた（実測: ERROR 74件・PASS 0件でも緑）。
#   次の4点を追加した。
#     (a) psql に ON_ERROR_STOP=1 を渡し、終了コードを判定する
#         ※ ON_ERROR_STOP が無いと psql は ERROR が何件出ても終了コード0を返す（実測確認済み）
#     (b) ERROR 行数を失敗として計上する
#     (c) スイートごとの期待PASS件数と突合する（アサーションが減っても気づけるようにする）
#     (d) docker cp / docker exec 自体の失敗も失敗として計上する
set -u
CONTAINER=supabase_db_hapimari

# 「スイート名:期待PASS件数」
#   アサーションを増減させたら必ずこの期待値も更新すること。
#   更新し忘れた場合はここが赤くなる（＝テストが静かに減っていたことに気づける）。
SUITES=(
  "test_m65_p1:18"
  "test_m66_audit_fixes:17"
  "test_m67_retention:28"
  "test_review2_fixes:23"
  "test_m73_payment_reconciliation:9"
  "test_i08_latest_messages:11"
)
FAIL_TOTAL=0

for entry in "${SUITES[@]}"; do
  f="${entry%%:*}"
  expected="${entry##*:}"
  echo "########## $f ##########"

  if ! MSYS_NO_PATHCONV=1 docker cp "scripts/$f.sql" "$CONTAINER:/tmp/" >/dev/null 2>&1; then
    echo "FAIL: docker cp に失敗しました（コンテナ $CONTAINER は起動していますか？）"
    FAIL_TOTAL=$((FAIL_TOTAL + 1))
    echo ""
    continue
  fi

  OUT=$(MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" \
          psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "/tmp/$f.sql" 2>&1)
  RC=$?

  echo "$OUT" | grep -E "PASS|FAIL|NOTE|ERROR" | sed 's/^psql:[^ ]* *//'

  # 実際の失敗行のみ数える（行頭のFAIL / NOTICE: FAIL）。説明文中の"FAIL"は除外
  N_FAIL=$(echo "$OUT"  | grep -cE "^[[:space:]]*FAIL|NOTICE:[[:space:]]+FAIL")
  N_ERROR=$(echo "$OUT" | grep -cE "ERROR:")
  N_PASS=$(echo "$OUT"  | grep -cE "PASS")
  SUITE_FAIL=$((N_FAIL + N_ERROR))

  if [ "$RC" -ne 0 ]; then
    echo "FAIL: psql が異常終了しました（終了コード $RC）"
    SUITE_FAIL=$((SUITE_FAIL + 1))
  fi
  if [ "$N_PASS" -ne "$expected" ]; then
    echo "FAIL: PASS件数が想定と違います（実測 ${N_PASS}件 / 期待 ${expected}件）"
    echo "      アサーションを増減させた場合は scripts/run_sql_tests.sh の期待値を更新してください"
    SUITE_FAIL=$((SUITE_FAIL + 1))
  fi
  if [ "$SUITE_FAIL" -eq 0 ]; then
    echo "  --> [$f] 合格: PASS ${N_PASS}件（期待 ${expected}件と一致）/ 失敗0件 / ERROR 0件"
  else
    echo "  --> [$f] 不合格: 失敗${N_FAIL}件 / ERROR ${N_ERROR}件 / PASS ${N_PASS}件（期待 ${expected}件）"
  fi

  FAIL_TOTAL=$((FAIL_TOTAL + SUITE_FAIL))
  echo ""
done

echo "=================================================="
if [ "$FAIL_TOTAL" -eq 0 ]; then
  echo "結果: 全スイート合格（失敗0件・ERROR 0件・PASS件数はすべて期待どおり）"
else
  echo "結果: 失敗 ${FAIL_TOTAL}件（上の出力を確認してください）"
fi
exit $((FAIL_TOTAL > 0))
