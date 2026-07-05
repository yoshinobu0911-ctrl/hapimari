-- ============================================================
-- Seedデータ（SPEC §7）
--   男性12名・女性8名（東京・埼玉・千葉）
--   女性のうち5名は35〜45歳バツイチ子持ち
--   全員 is_verified=true、写真はプレースホルダ画像
--   マッチ済みペア2組（うち1組は message_count=22 でデート打診可能）
--   ログイン: seed01@hapimari.test 〜 seed20@hapimari.test / password123
-- ============================================================

-- ---- auth.users / auth.identities（ローカル開発用・パスワードは全員 password123） ----
do $$
declare
  i int;
  uid uuid;
  mail text;
begin
  for i in 1..20 loop
    uid := ('00000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid;
    mail := 'seed' || lpad(i::text, 2, '0') || '@hapimari.test';

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      mail, crypt('password123', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;
end $$;

-- ---- profiles: 男性12名（45歳以上） ----
insert into profiles (
  id, nickname, gender, birth_date, prefecture, city, marital_history,
  has_children, children_living_together, ok_child_date, marriage_intent,
  cohabit_view, money_view, bio, available_times,
  understands_children, understands_remarriage, photo_urls, is_verified
) values
('00000000-0000-0000-0000-000000000001', 'たかし', 'male', '1978-04-12', '東京都', '世田谷区', 'divorced',
 false, null, true, 'within_2y',
 'こだわりません', '生活費は分担したい', '離婚を経験し、今度こそ穏やかな家庭を築きたいと思っています。休日は料理と散歩が趣味です。', '{weekday_lunch,weekend_am}',
 true, true, '{https://picsum.photos/seed/hapimari01/600/800}', true),
('00000000-0000-0000-0000-000000000002', 'けんじ', 'male', '1975-11-03', '東京都', '練馬区', 'divorced',
 true, false, true, 'someday',
 '相手に合わせたい', '無理のない範囲で', '子どもは元妻と暮らしています。同じ境遇の方の気持ちがわかると思います。', '{weekend_am,weekend_pm}',
 true, true, '{https://picsum.photos/seed/hapimari02/600/800}', true),
('00000000-0000-0000-0000-000000000003', 'ひろし', 'male', '1980-08-21', '埼玉県', 'さいたま市', 'unmarried',
 false, null, true, 'asap',
 '一緒に住みたい', '共働き希望', '仕事一筋で来ましたが、人生の後半を一緒に歩める方に出会いたいです。', '{weekday_lunch,weekday_night}',
 true, true, '{https://picsum.photos/seed/hapimari03/600/800}', true),
('00000000-0000-0000-0000-000000000004', 'まさお', 'male', '1968-02-14', '千葉県', '船橋市', 'widowed',
 true, false, true, 'partner_only',
 '近居でもよい', 'お互い自立した関係がよい', '妻に先立たれて5年になります。籍にはこだわらず、支え合える伴侶を探しています。', '{weekend_am,weekend_pm}',
 true, true, '{https://picsum.photos/seed/hapimari04/600/800}', true),
('00000000-0000-0000-0000-000000000005', 'しんじ', 'male', '1979-06-30', '東京都', '大田区', 'divorced',
 false, null, false, 'within_2y',
 '一緒に住みたい', '折半希望', '再婚に向けて真剣に活動しています。まずは気軽にお話しできれば嬉しいです。', '{weekday_night}',
 false, true, '{https://picsum.photos/seed/hapimari05/600/800}', true),
('00000000-0000-0000-0000-000000000006', 'さとる', 'male', '1972-09-18', '埼玉県', '川口市', 'divorced',
 false, null, true, 'someday',
 'こだわりません', '生活費は多めに負担できます', '子ども好きです。お子さんがいる方も大歓迎です。焦らずゆっくり関係を築きたいです。', '{weekday_lunch,weekend_am,weekend_pm}',
 true, true, '{https://picsum.photos/seed/hapimari06/600/800}', true),
('00000000-0000-0000-0000-000000000007', 'のぼる', 'male', '1965-12-05', '千葉県', '柏市', 'widowed',
 true, false, true, 'partner_only',
 '近居でもよい', '年金と貯蓄で安定しています', '穏やかな時間を一緒に過ごせる方と出会えたら幸いです。畑仕事と読書が趣味です。', '{weekday_lunch,weekend_am}',
 true, true, '{https://picsum.photos/seed/hapimari07/600/800}', true),
('00000000-0000-0000-0000-000000000008', 'おさむ', 'male', '1976-03-27', '東京都', '杉並区', 'unmarried',
 false, null, false, 'within_2y',
 '一緒に住みたい', '共働き希望', '初婚です。年齢を重ねたからこそわかる思いやりを大切にしたいです。', '{weekday_night,weekend_pm}',
 false, true, '{https://picsum.photos/seed/hapimari08/600/800}', true),
('00000000-0000-0000-0000-000000000009', 'ゆうじ', 'male', '1981-01-15', '埼玉県', '所沢市', 'divorced',
 false, null, true, 'asap',
 'こだわりません', '無理のない範囲で', 'バツイチです。同じ経験をした方と、今度こそ長く続く関係を築きたいです。', '{weekday_lunch,weekend_am}',
 true, true, '{https://picsum.photos/seed/hapimari09/600/800}', true),
('00000000-0000-0000-0000-000000000010', 'かずお', 'male', '1958-07-22', '千葉県', '市川市', 'widowed',
 true, false, true, 'partner_only',
 '近居でもよい', '安定した生活基盤があります', '定年後の人生を一緒に楽しめる方を探しています。旅行と囲碁が趣味です。', '{weekday_lunch,weekend_am,weekend_pm}',
 true, true, '{https://picsum.photos/seed/hapimari10/600/800}', true),
('00000000-0000-0000-0000-000000000011', 'てつや', 'male', '1974-05-09', '東京都', '江東区', 'divorced',
 false, null, true, 'someday',
 '相手に合わせたい', '折半希望', '離婚後、仕事に打ち込んできましたが、そろそろ人生を共にする方に出会いたいです。', '{weekend_pm,weekday_night}',
 true, true, '{https://picsum.photos/seed/hapimari11/600/800}', true),
('00000000-0000-0000-0000-000000000012', 'まこと', 'male', '1970-10-31', '埼玉県', '越谷市', 'unmarried',
 false, null, false, 'someday',
 'こだわりません', '無理のない範囲で', '晩婚ですが真剣です。映画と美味しいものめぐりが好きです。', '{weekend_am,weekend_pm}',
 false, true, '{https://picsum.photos/seed/hapimari12/600/800}', true);

-- ---- profiles: 女性8名（35歳以上・うち5名は35〜45歳バツイチ子持ち） ----
insert into profiles (
  id, nickname, gender, birth_date, prefecture, city, marital_history,
  has_children, children_living_together, ok_child_date, marriage_intent,
  cohabit_view, money_view, bio, available_times,
  understands_children, understands_remarriage, photo_urls, is_verified
) values
('00000000-0000-0000-0000-000000000013', 'ようこ', 'female', '1988-03-15', '東京都', '足立区', 'divorced',
 true, true, true, 'within_2y',
 '子どもが慣れてから', '教育費を最優先にしています', '小学生の子どもと二人暮らしです。子どもを理解してくださる方と出会えたら嬉しいです。', '{weekday_lunch,weekend_am}',
 true, true, '{https://picsum.photos/seed/hapimari13/600/800}', true),
('00000000-0000-0000-0000-000000000014', 'さちこ', 'female', '1985-09-02', '埼玉県', '川越市', 'divorced',
 true, true, true, 'someday',
 '子ども優先で考えたい', '無理のない範囲で', '中学生の娘がいます。焦らず、まずはお友達からお願いします。', '{weekday_lunch,weekend_am}',
 true, true, '{https://picsum.photos/seed/hapimari14/600/800}', true),
('00000000-0000-0000-0000-000000000015', 'みほ', 'female', '1990-12-20', '千葉県', '千葉市', 'divorced',
 true, true, false, 'within_2y',
 '子どもが慣れてから', '共働き希望', '保育園児の息子がいます。平日ランチなら時間が作りやすいです。', '{weekday_lunch}',
 true, true, '{https://picsum.photos/seed/hapimari15/600/800}', true),
('00000000-0000-0000-0000-000000000016', 'えみ', 'female', '1983-06-08', '東京都', '北区', 'divorced',
 true, false, true, 'asap',
 '一緒に住みたい', '生活費は分担したい', '子どもは元夫のもとにいます。再婚に前向きで、真剣な出会いを探しています。', '{weekend_am,weekend_pm}',
 true, true, '{https://picsum.photos/seed/hapimari16/600/800}', true),
('00000000-0000-0000-0000-000000000017', 'かおり', 'female', '1981-08-25', '埼玉県', '春日部市', 'divorced',
 true, true, true, 'someday',
 '子ども優先で考えたい', '教育費を最優先にしています', '高校生の息子がいます。同じ子育て経験のある方だと話が合いそうです。', '{weekday_lunch,weekend_pm}',
 true, true, '{https://picsum.photos/seed/hapimari17/600/800}', true),
('00000000-0000-0000-0000-000000000018', 'なおみ', 'female', '1979-04-17', '東京都', '八王子市', 'widowed',
 true, true, true, 'partner_only',
 '近居でもよい', 'お互い自立した関係がよい', '夫と死別して3年。籍にはこだわらず、穏やかに支え合える方と出会いたいです。', '{weekday_lunch,weekend_am}',
 true, true, '{https://picsum.photos/seed/hapimari18/600/800}', true),
('00000000-0000-0000-0000-000000000019', 'ゆみこ', 'female', '1973-11-11', '千葉県', '松戸市', 'unmarried',
 false, null, true, 'someday',
 'こだわりません', '無理のない範囲で', '独身を通してきましたが、これからの人生を一緒に歩める方がいたらと思い登録しました。', '{weekend_am,weekend_pm}',
 true, true, '{https://picsum.photos/seed/hapimari19/600/800}', true),
('00000000-0000-0000-0000-000000000020', 'りえ', 'female', '1976-02-28', '埼玉県', '上尾市', 'divorced',
 false, null, true, 'within_2y',
 '一緒に住みたい', '共働き希望', 'バツイチ・子どもなしです。週末に一緒にお出かけできる方を探しています。', '{weekend_am,weekend_pm,weekday_night}',
 true, true, '{https://picsum.photos/seed/hapimari20/600/800}', true);

-- ---- いいね（マッチ2組ぶんの相互いいね + 片思いいくつか） ----
-- R3整合: 子持ち女性へのいいねは understands_children=true の男性のみ
insert into likes (from_user, to_user, message) values
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000013', 'はじめまして。プロフィールを読んで、お子さん想いなところが素敵だと思いました。'),
('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', null),
('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000014', '同じ境遇なので、お話が合いそうだと思いました。'),
('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000002', null),
('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000015', '平日ランチ、私も行きやすいです。よろしくお願いします。'),
('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000016', null),
('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000017', null),
('00000000-0000-0000-0000-000000000019', '00000000-0000-0000-0000-000000000007', 'ご趣味が近そうだと思い、いいねしました。');

-- ---- マッチ2組 ----
insert into matches (id, user_a, user_b) values
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000013'),
('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000014');

-- ---- メッセージ ----
-- ペア1（たかし×ようこ）: 22通 → トリガで message_count=22 になり、
-- 通話解禁(>=10)・デート打診バナー(>=20)の両方が立つ（§7: デート打診可能状態）
do $$
declare
  bodies text[] := array[
    'はじめまして、たかしです。マッチありがとうございます。',
    'こちらこそ、ようこです。よろしくお願いします。',
    'プロフィール拝見しました。お子さんは小学生なんですね。',
    'はい、小学3年生の男の子です。毎日にぎやかです。',
    '元気いっぱいですね。私は休日によく料理をします。',
    '素敵ですね。得意料理は何ですか？',
    '肉じゃがと麻婆豆腐です。和食が多めですね。',
    '麻婆豆腐、息子も大好きです。',
    'それは嬉しいです。ようこさんはお休みの日は何を？',
    '子どもと公園に行くことが多いです。あとはパン作りも。',
    '手作りパン、いいですね。売り物より美味しそうです。',
    'ふふ、形は不格好ですけど味は自信あります。',
    '今度ぜひ感想を言わせてください。',
    'ぜひ。たかしさんは平日ランチ派なんですね。',
    'はい、職場が都心なので平日昼が動きやすいです。',
    '私も子どもが学校の間が一番動きやすいです。',
    '生活リズムが合いそうですね。',
    '本当ですね。なんだか安心してお話しできます。',
    'そう言っていただけて嬉しいです。',
    '私もです。毎日のやりとりが楽しみになっています。',
    'よかったら、一度ランチでもいかがですか？',
    'はい、ぜひ。日程を相談しましょう。'
  ];
  i int;
begin
  for i in 1..array_length(bodies, 1) loop
    insert into messages (match_id, sender, body, created_at) values (
      '10000000-0000-0000-0000-000000000001',
      case when i % 2 = 1
        then '00000000-0000-0000-0000-000000000001'::uuid
        else '00000000-0000-0000-0000-000000000013'::uuid
      end,
      bodies[i],
      now() - interval '3 days' + make_interval(mins => i * 30)
    );
  end loop;
end $$;

-- ペア2（けんじ×さちこ）: 4通（チャット開始直後の状態）
insert into messages (match_id, sender, body, created_at) values
('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'はじめまして。マッチありがとうございます。', now() - interval '1 day'),
('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000014', 'こちらこそ、よろしくお願いします。', now() - interval '1 day' + interval '20 minutes'),
('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'お嬢さん、中学生なんですね。私の子と同じ年頃です。', now() - interval '1 day' + interval '45 minutes'),
('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000014', 'そうなんです。同じ子育て世代で心強いです。', now() - interval '1 day' + interval '60 minutes');
