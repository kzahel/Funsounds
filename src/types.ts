export interface SoundEntry {
  name: string;
  emoji: string;
  filename: string;
  duration?: number;
}

export interface SoundsData {
  sounds: SoundEntry[];
}

export interface ColorItem {
  key: string;
  name: string;
  css: string;
}
