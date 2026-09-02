#!/usr/bin/env bash
# 全SQL攻撃再現テストの一括実行（レビュアー向け・コピペ1発で再現できるようにする）
# 前提: supabase start 済み（コンテナ名 supabase_db_hapimari）
# 実行: bash scripts/run_sql_tests.sh
#   → 各スイートの PASS/FAIL 行だけを表示する。全文が見たい場合は個別に
#     docker exec supabase_db_hapimari psql -U postgres -d postgres -f /tmp/<file>.sql
# 並列競合（行ロック・アドバイザリロック）は別スクリプト:
#   bash scripts/test_review2_concurrency.sh
set -u
SUITES=(test_m65_p1 test_m66_audit_fixes test_m67_retention test_review2_fixes)
FAIL_TOTAL=0
for f in "${SUITES[@]}"; do
  echo "########## $f ##########"
  MSYS_NO_PATHCONV=1 docker cp "scripts/$f.sql" supabase_db_hapimari:/tmp/ >/dev/null
  OUT=$(MSYS_NO_PATHCONV=1 docker exec supabase_db_hapimari psql -U postgres -d postgres -f "/tmp/$f.sql" 2>&1)
  echo "$OUT" | grep -E "PASS|FAIL|NOTE|ERROR" | sed 's/^psql:[^ ]* *//'
  # 実際の失敗行のみ数える（行頭のFAIL / NOTICE: FAIL）。説明文中の"FAIL"は除外
  N=$(echo "$OUT" | grep -cE "^[[:space:]]*FAIL|NOTICE:[[:space:]]+FAIL")
  FAIL_TOTAL=$((FAIL_TOTAL + N))
  echo ""
done
echo "=================================================="
if [ "$FAIL_TOTAL" -eq 0 ]; then
  echo "結果: 全スイート PASS（FAIL 0件）"
else
  echo "結果: FAIL ${FAIL_TOTAL}件（上の出力を確認してください）"
fi
exit $((FAIL_TOTAL > 0))
