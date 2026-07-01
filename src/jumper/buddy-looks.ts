export type BuddyMouth = 'smile' | 'grumpy' | 'toothy' | 'open' | 'sleepy';
export type BuddyEyes = 'normal' | 'wide' | 'sleepy' | 'grumpy';
export type BuddyHair = 'none' | 'tuft' | 'curls' | 'mohawk' | 'swoop' | 'sprout';
export type BuddyAccessory = 'none' | 'cap' | 'partyHat' | 'bow' | 'crown' | 'glasses' | 'propeller';

export interface BuddyLook {
  size: number;
  width: number;
  height: number;
  mouth: BuddyMouth;
  eyes: BuddyEyes;
  hair: BuddyHair;
  accessory: BuddyAccessory;
}

export const BUDDY_LOOKS: BuddyLook[] = [
  { size: 1.04, width: 1.18, height: 0.9, mouth: 'toothy', eyes: 'wide', hair: 'none', accessory: 'cap' },
  { size: 1.0, width: 0.86, height: 1.16, mouth: 'smile', eyes: 'normal', hair: 'tuft', accessory: 'none' },
  { size: 0.92, width: 0.96, height: 0.98, mouth: 'grumpy', eyes: 'grumpy', hair: 'mohawk', accessory: 'none' },
  { size: 1.06, width: 1.04, height: 1.02, mouth: 'smile', eyes: 'normal', hair: 'curls', accessory: 'crown' },
  { size: 0.9, width: 0.9, height: 1.06, mouth: 'sleepy', eyes: 'sleepy', hair: 'swoop', accessory: 'glasses' },
  { size: 1.08, width: 1.1, height: 0.95, mouth: 'open', eyes: 'wide', hair: 'none', accessory: 'partyHat' },
  { size: 0.96, width: 1.02, height: 1.04, mouth: 'toothy', eyes: 'normal', hair: 'sprout', accessory: 'bow' },
  { size: 1.14, width: 1.2, height: 0.88, mouth: 'smile', eyes: 'normal', hair: 'curls', accessory: 'none' },
  { size: 0.88, width: 0.84, height: 1.14, mouth: 'open', eyes: 'wide', hair: 'tuft', accessory: 'propeller' },
  { size: 1.0, width: 1.08, height: 0.98, mouth: 'grumpy', eyes: 'grumpy', hair: 'swoop', accessory: 'glasses' },
  { size: 0.94, width: 0.92, height: 1.0, mouth: 'smile', eyes: 'normal', hair: 'mohawk', accessory: 'bow' },
];

export function buddyVariantIndex(order: number): number {
  return (order * 7 + 3) % BUDDY_LOOKS.length;
}
