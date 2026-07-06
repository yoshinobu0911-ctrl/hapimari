import { DEFAULT_DISCOVER_FILTER, type DiscoverFilter } from '@hapimari/shared';
import { create } from 'zustand';

/**
 * discover の検索フィルタ（docs/design/M3_design.md §5.3）
 * 既定値 = R10 状態（自県+隣接県・他の条件なし）。リセットで既定に戻せる。
 */
interface FilterState {
  filter: DiscoverFilter;
  setFilter: (filter: DiscoverFilter) => void;
  reset: () => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  filter: DEFAULT_DISCOVER_FILTER,
  setFilter: (filter) => set({ filter }),
  reset: () => set({ filter: DEFAULT_DISCOVER_FILTER }),
}));
