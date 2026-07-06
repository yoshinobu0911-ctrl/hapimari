import type { AvailableTime, MaritalHistory, MarriageIntent, Prefecture } from '@hapimari/shared';
import { create } from 'zustand';

export interface OnboardingDraft {
  // step1: 基本情報
  nickname: string;
  gender: 'male' | 'female' | null;
  birthYear: string;
  birthMonth: string;
  birthDay: string;
  prefecture: Prefecture | null;
  city: string;
  // step2: 結婚歴・子ども
  maritalHistory: MaritalHistory | null;
  hasChildren: boolean | null;
  childrenLivingTogether: boolean | null;
  okChildDate: boolean | null;
  understandsChildren: boolean;
  understandsRemarriage: boolean;
  // step3: 価値観
  valueTags: string[];
  marriageIntent: MarriageIntent | null;
  cohabitView: string;
  moneyView: string;
  availableTimes: AvailableTime[];
  bio: string;
}

interface OnboardingState extends OnboardingDraft {
  set: (partial: Partial<OnboardingDraft>) => void;
  reset: () => void;
}

const initialDraft: OnboardingDraft = {
  nickname: '',
  gender: null,
  birthYear: '',
  birthMonth: '',
  birthDay: '',
  prefecture: null,
  city: '',
  maritalHistory: null,
  hasChildren: null,
  childrenLivingTogether: null,
  okChildDate: null,
  understandsChildren: false,
  understandsRemarriage: false,
  valueTags: [],
  marriageIntent: null,
  cohabitView: '',
  moneyView: '',
  availableTimes: [],
  bio: '',
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  ...initialDraft,
  set: (partial) => set(partial),
  reset: () => set(initialDraft),
}));

/** step1 の入力から YYYY-MM-DD を組み立てる。数値として不正なら null */
export function draftBirthDate(draft: OnboardingDraft): string | null {
  const y = Number(draft.birthYear);
  const m = Number(draft.birthMonth);
  const d = Number(draft.birthDay);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // 2月30日のような不正日付を弾く
  const parsed = new Date(`${iso}T00:00:00`);
  if (parsed.getMonth() + 1 !== m || parsed.getDate() !== d) return null;
  return iso;
}
