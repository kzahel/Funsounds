// Barrel Hop — per-level visual themes (season + time of day).
//
// Levels cycle through these so the world keeps changing as you climb: the sky,
// sun/moon, hills, ground and ambient weather all re-skin. Barrels and the
// character stay constant so they're always easy to read.

export interface Theme {
  name: string;
  emoji: string;
  skyTop: string;
  skyBottom: string;
  cloud: string; // rgba string
  celestial: 'sun' | 'moon';
  celestialColor: string;
  stars: boolean;
  hillFar: string;
  hillNear: string;
  grass: string;
  grassDark: string;
  dirt: string;
  dirtDark: string;
  weather: 'none' | 'leaves' | 'snow' | 'petals';
}

export const THEMES: Theme[] = [
  {
    name: 'Summer',
    emoji: '☀️',
    skyTop: '#8fd6ff',
    skyBottom: '#dff4ff',
    cloud: 'rgba(255,255,255,0.92)',
    celestial: 'sun',
    celestialColor: '#fff4b0',
    stars: false,
    hillFar: '#bfe89a',
    hillNear: '#9bdc79',
    grass: '#5fbe4a',
    grassDark: '#43a233',
    dirt: '#9c6a3c',
    dirtDark: '#7c5230',
    weather: 'none',
  },
  {
    name: 'Autumn',
    emoji: '🍂',
    skyTop: '#8fc7e6',
    skyBottom: '#ffe9c2',
    cloud: 'rgba(255,250,240,0.9)',
    celestial: 'sun',
    celestialColor: '#ffe3a0',
    stars: false,
    hillFar: '#e7b15a',
    hillNear: '#d2863c',
    grass: '#c39a3e',
    grassDark: '#9a7329',
    dirt: '#8a5a33',
    dirtDark: '#6d4526',
    weather: 'leaves',
  },
  {
    name: 'Winter',
    emoji: '❄️',
    skyTop: '#cfe8f7',
    skyBottom: '#eef7ff',
    cloud: 'rgba(255,255,255,0.95)',
    celestial: 'sun',
    celestialColor: '#fdf6d8',
    stars: false,
    hillFar: '#dcebf3',
    hillNear: '#c2dceb',
    grass: '#f4fbff',
    grassDark: '#d4e6f0',
    dirt: '#a7b0b8',
    dirtDark: '#878f96',
    weather: 'snow',
  },
  {
    name: 'Sunset',
    emoji: '🌇',
    skyTop: '#6a5b9a',
    skyBottom: '#ffa57c',
    cloud: 'rgba(255,200,170,0.85)',
    celestial: 'sun',
    celestialColor: '#ff8c42',
    stars: false,
    hillFar: '#7e6fa0',
    hillNear: '#5d5286',
    grass: '#5a8f4a',
    grassDark: '#3f6f33',
    dirt: '#6e4a30',
    dirtDark: '#553a26',
    weather: 'none',
  },
  {
    name: 'Night',
    emoji: '🌙',
    skyTop: '#10183a',
    skyBottom: '#2a3566',
    cloud: 'rgba(200,210,240,0.16)',
    celestial: 'moon',
    celestialColor: '#f4f3d0',
    stars: true,
    hillFar: '#26305c',
    hillNear: '#1c2548',
    grass: '#3a8a45',
    grassDark: '#2c6a36',
    dirt: '#5a3f2a',
    dirtDark: '#46301f',
    weather: 'none',
  },
  {
    name: 'Spring',
    emoji: '🌸',
    skyTop: '#9fdcff',
    skyBottom: '#e9fbe7',
    cloud: 'rgba(255,255,255,0.92)',
    celestial: 'sun',
    celestialColor: '#fff4b0',
    stars: false,
    hillFar: '#c4ee9e',
    hillNear: '#a3e07d',
    grass: '#6fd05a',
    grassDark: '#4cae3a',
    dirt: '#a06f43',
    dirtDark: '#7e5532',
    weather: 'petals',
  },
];

/** Theme for a 1-based level number (cycles). Level 1 = Summer, Level 2 = Autumn… */
export function themeForLevel(levelNum: number): Theme {
  const i = ((levelNum - 1) % THEMES.length + THEMES.length) % THEMES.length;
  return THEMES[i];
}
