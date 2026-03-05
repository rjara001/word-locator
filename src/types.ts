export interface Match {
  id: string;
  text: string;
  context: string;
  selector: string;
  index: number;
}

export interface TargetWord {
  text: string;
  enabled: boolean;
  color: string;
}

export interface AppState {
  targetWords: TargetWord[];
  isHighlightEnabled: boolean;
  highlightColor: string;
}

export const DEFAULT_STATE: AppState = {
  targetWords: [],
  isHighlightEnabled: true,
  highlightColor: '#ffff00',
};
