-- ============================================================
-- M3: 検索・いいね・マッチ・メッセージ・通報ブロック
-- 設計書: docs/design/M3_design.md §3（オーナー承認済み）
--   3.1 blocks テーブル新設（2026-07-06 オーナー承認）
--   3.2 fraud_words テーブル（R8トリガ辞書。正は packages/shared/src/fraud_words.ts）
--   3.3 ブロックの両方向遮断（profiles 閲覧ポリシー差し替え）
--   3.4 相互いいね→マッチ成立トリガ
--   3.5 R8 詐欺ワード検知トリガ（messages.flagged）
--   3.6 likes の直接INSERT禁止（Edge Function 経由に一本化）
--   3.7 Realtime 配信追加（messages / matches / likes）
-- ============================================================

-- ------------------------------------------------------------
-- 3.1 blocks: ブロック（SPEC §3 に無い追加・承認済み）
-- ------------------------------------------------------------
create table blocks (
  id uuid primary key default gen_random_uuid(),
  blocker uuid references profiles(id) not null,
  blocked uuid references profiles(id) not null,
  created_at timestamptz default now(),
  unique (blocker, blocked),
  check (blocker <> blocked)
);

alter table blocks enable row level security;

create policy "本人のブロックのみ全操作可" on blocks
  for all to authenticated
  using (blocker = auth.uid())
  with check (blocker = auth.uid());

-- ⚠ このローカルスタックでは新規テーブルに既定GRANTが付かない（§1.2-3）
grant select, insert, delete on public.blocks to authenticated;
grant all on public.blocks to service_role;

-- ------------------------------------------------------------
-- 3.2 fraud_words: R8トリガ用辞書（authenticated からは不可視）
--   同期規約: 正は packages/shared/src/fraud_words.ts（50語）。
--   語を変更する場合は TS とこのテーブル（migration追加）を同時に更新する。
-- ------------------------------------------------------------
create table fraud_words (word text primary key);

alter table fraud_words enable row level security; -- ポリシーなし = authenticated から全拒否
grant all on public.fraud_words to service_role;

insert into fraud_words (word) values
  -- 投資・儲け話（ロマンス詐欺の典型導入）
  ('投資'), ('資産運用'), ('仮想通貨'), ('暗号資産'), ('ビットコイン'),
  ('fx'), ('バイナリーオプション'), ('先物取引'), ('元本保証'), ('必ず儲かる'),
  ('絶対儲かる'), ('儲かる話'), ('不労所得'), ('権利収入'), ('利回り'),
  ('配当金'), ('月収100万'), ('副業'), ('稼げる'), ('簡単に稼ぐ'),
  ('情報商材'), ('セミナーに来'), ('マルチ商法'), ('ネットワークビジネス'), ('ねずみ講'),
  ('代理店募集'),
  -- 金銭要求・送金
  ('振り込んで'), ('振込先'), ('送金'), ('口座番号'), ('銀行口座を教えて'),
  ('電子マネー'), ('プリペイドカード'), ('ギフトカード'), ('ギフト券'), ('アマギフ'),
  ('現金プレゼント'), ('お金を貸して'), ('お金に困って'), ('借金の返済'), ('融資'),
  ('立て替えて'),
  -- 外部誘導（サイト外へ連れ出す動線）
  ('別のサイト'), ('他のサイト'), ('こちらのurl'), ('このリンクに登録'), ('qrコードを読み'),
  ('直アド'), ('メアド交換'), ('退会するので連絡先');

-- ------------------------------------------------------------
-- 3.3 ブロックの両方向遮断
--   security definer: blocks の RLS（本人分のみ）を越えて双方向を判定するため
-- ------------------------------------------------------------
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from blocks
    where (blocker = a and blocked = b) or (blocker = b and blocked = a)
  );
$$;

-- profiles の閲覧ポリシーを差し替え（discover / 詳細 / likes 表示すべてに効く）
drop policy "認証ユーザーはactiveプロフィールと自分を閲覧可" on profiles;
create policy "認証ユーザーはactiveかつ非ブロックのプロフィールと自分を閲覧可" on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (status = 'active' and not public.is_blocked_between(auth.uid(), id))
  );

-- ------------------------------------------------------------
-- 3.4 マッチ成立トリガ（相互いいね→matches 作成。挿入経路に依存しない）
--   重複防止の正規化規約: user_a = least(uuid), user_b = greatest(uuid)
-- ------------------------------------------------------------
create or replace function public.create_match_on_mutual_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from likes where from_user = new.to_user and to_user = new.from_user) then
    insert into matches (user_a, user_b)
    values (least(new.from_user, new.to_user), greatest(new.from_user, new.to_user))
    on conflict (user_a, user_b) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_likes_mutual_match
after insert on likes
for each row execute function public.create_match_on_mutual_like();

-- ------------------------------------------------------------
-- 3.5 R8 検知トリガ（messages 挿入時に flagged 判定）
--   TS側 normalizeForFraudCheck と同等: 小文字化 + 全角英数字→半角
-- ------------------------------------------------------------
create or replace function public.flag_fraud_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

create trigger trg_messages_fraud
before insert on messages
for each row execute function public.flag_fraud_message();

-- ------------------------------------------------------------
-- 3.6 likes の直接INSERT禁止（R3/R4 検証を Edge Function に一本化）
--   ポリシー削除（RLS既定拒否）+ テーブル/カラム両レベルのGRANT剥奪
-- ------------------------------------------------------------
drop policy "自分名義のいいねのみ作成可" on likes;
revoke insert on table public.likes from authenticated;
revoke insert (from_user, to_user, message) on public.likes from authenticated;

-- ------------------------------------------------------------
-- 3.7 Realtime 配信の追加（RLSを尊重して当事者にのみ配信される）
-- ------------------------------------------------------------
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table likes;
