export interface Match {
  id: string;
  text: string;
  context: string;
  selector: string;
  index: number;
}

export interface AppState {
  targetWords: string[];
  isHighlightEnabled: boolean;
  highlightColor: string;
}

export const DEFAULT_STATE: AppState = {
  targetWords: [],
  isHighlightEnabled: true,
  highlightColor: '#ffff00',
};
