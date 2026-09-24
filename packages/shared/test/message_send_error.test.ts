import { describe, expect, it } from 'vitest';
import { classifyMessageSendError, messageSendFailureText } from '../src/message_send_error';

// 2026-09-26 にローカル REST で実測した応答の形
const NOT_ENTITLED = { code: 'P0001', message: 'not_entitled' };
const RLS = {
  code: '42501',
  message: 'new row violates row-level security policy for table "messages"',
};
const TOO_LONG = {
  code: '23514',
  message: 'new row for relation "messages" violates check constraint "messages_body_check"',
};

describe('classifyMessageSendError（I33）', () => {
  it('実測した応答を原因ごとに分類する', () => {
    expect(classifyMessageSendError(NOT_ENTITLED)).toBe('not_entitled');
    expect(classifyMessageSendError(RLS)).toBe('rejected');
    expect(classifyMessageSendError(TOO_LONG)).toBe('too_long');
    expect(classifyMessageSendError({ code: '', message: 'TypeError: Failed to fetch' })).toBe(
      'network',
    );
  });

  it('判定できないものは unknown', () => {
    expect(classifyMessageSendError(null)).toBe('unknown');
    expect(classifyMessageSendError({ code: '500', message: 'x' })).toBe('unknown');
    expect(classifyMessageSendError({ code: '08006', message: 'fetch' })).toBe('unknown');
  });
});

describe('messageSendFailureText（I33）', () => {
  const ok = { isActive: true, isVerified: true, needsSubscription: false };

  it('送信資格なしは、問い合わせ直した本人の状態で案内を変える（非在籍→本人確認→課金の順）', () => {
    expect(messageSendFailureText('not_entitled', { ...ok, isActive: false })).toContain(
      'アカウントの状態',
    );
    expect(messageSendFailureText('not_entitled', { ...ok, isVerified: false })).toContain(
      '本人確認の完了後',
    );
    expect(messageSendFailureText('not_entitled', { ...ok, needsSubscription: true })).toContain(
      '有料プランの有効期限',
    );
    expect(
      messageSendFailureText('not_entitled', {
        isActive: false,
        isVerified: false,
        needsSubscription: true,
      }),
    ).toContain('アカウントの状態');
    expect(messageSendFailureText('not_entitled', ok)).toBe(
      '送信できませんでした。時間をおいてお試しください。',
    );
  });

  it('本人確認の案内は送信資格なしのときだけ出る（従来は全失敗で本人確認を案内していた）', () => {
    for (const kind of ['rejected', 'too_long', 'network', 'unknown'] as const) {
      expect(messageSendFailureText(kind)).not.toContain('本人確認');
    }
  });

  it('ブロック等は相手の事情を推測させない文言、超過は上限値、通信断は再試行を案内', () => {
    expect(messageSendFailureText('rejected')).toBe('このお相手には現在メッセージを送れません。');
    expect(messageSendFailureText('too_long')).toBe('メッセージは2000文字以内で入力してください。');
    expect(messageSendFailureText('network')).toContain('もう一度お試しください');
  });
});
