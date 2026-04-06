export type CardColor = 'red' | 'yellow' | 'green' | 'blue';
export type WildColor = CardColor | 'wild';
export type CardValue = '0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'skip'|'reverse'|'draw2'|'wild'|'wild4';
export type Ruleset = 'beginner' | 'intermediate';
export type Theme = 'classic' | 'emoji';

export interface UnoCard {
  id: number;
  color: WildColor;
  value: CardValue;
  emoji?: string;
}

export interface UnoPlayer {
  name: string;
  hand: UnoCard[];
  isHuman: boolean;
  calledUno: boolean;
}

export const COLORS: CardColor[] = ['red', 'yellow', 'green', 'blue'];
export const NUMBER_VALUES: CardValue[] = ['0','1','2','3','4','5','6','7','8','9'];
export const ACTION_VALUES: CardValue[] = ['skip', 'reverse', 'draw2'];

export const UNO_TIMER_MS = 3000;
export const AI_THINK_MS = 800;
export const ANIM_MS = 350;

export const CARD_DISPLAY: Record<string, string> = {
  skip: '⊘', reverse: '⟲', draw2: '+2', wild: '★', wild4: '+4',
};

export const COLOR_HEX: Record<string, string> = {
  red: '#e53e3e', yellow: '#ecc94b', green: '#38a169', blue: '#3182ce',
};

export const AI_NAMES = ['Bot A', 'Bot B', 'Bot C'];

export function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
