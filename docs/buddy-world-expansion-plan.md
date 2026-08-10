# Buddy World Expansion Plan

This document tracks the expansion of the Buddy and Wedding adventures into a
connected, discoverable world. It is updated in the same commit as each playable
slice so the design and implementation stay synchronized.

## Design goals

- Make exploration understandable and exciting for a six-year-old.
- Keep every challenge forgiving: falling changes worlds or returns Buddy to a
  safe platform rather than ending the run.
- Give every world a distinct sky, platforms, obstacles, ambient friend, snack,
  movement feel, and memorable route into it.
- Let the world map revisit only places Buddy has actually explored.
- Preserve discovered-world progress across Buddy and Wedding sessions.
- Keep Up/W as movement or jump, Space/EAT as the nearby action, and Down/S as
  the Wedding interaction or underwater descent.

## World map and progression

The map shows the entire world as a vertical journey. Unexplored destinations
remain visible but faded and padlocked. Entering a world through normal play
unlocks it permanently for direct map travel.

| World | Natural discovery route | Signature snack | Status |
| --- | --- | --- | --- |
| Moon Base | Rocket from Starry Sky | Moon cheese | Complete |
| Starry Sky | UFO from Candy Clouds | Croissant | Complete |
| Candy Clouds | Friendly bird from Surface | Gumdrop | Complete |
| Rainbow Dreamland | Rainbow gate after exploring every other world | Sprinkle cookie | Complete |
| Sunny Surface | Starting world | Seasonal fruit or cookie | Complete |
| Dinosaur Jungle | Giant vine from Surface | Banana | Complete |
| Giant Toy Room | Magic toy chest from Surface | Cracker | Complete |
| Crystal Cave | Fall below Surface | Cave cheese | Complete |
| Volcano World | Dragon door from Crystal Cave | Toasted marshmallow | Complete |
| Coral Reef | Fall below Crystal Cave | Crunchy kelp | Complete |
| Sunken Castle | Giant shell gate from Coral Reef | Pearl candy | Complete |
| Deep Sea | Fall below Coral Reef | Glowing starfruit | Complete |

## Planned world slices

### Moon Base

- Complete: low-gravity jumping with cratered moon platforms and moon cheese.
- Complete: friendly rovers, Earth on the horizon, satellites, and moon rocks.
- Complete: a Space/EAT rocket gateway in Starry Sky and soft falls back to
  Starry Sky.

### Dinosaur Jungle

- Complete: dense tropical scenery, mossy platforms, logs, and dinosaur eggs.
- Complete: friendly baby dinosaurs and a Space/EAT giant-vine gateway on the
  Surface.
- Complete: bananas as snacks and soft falls back to the Surface.

### Volcano World

- Complete: glowing lava horizon, black-rock platforms, embers, and obsidian
  obstacles.
- Complete: toasted marshmallows, a sleepy friendly dragon, and a Space/EAT
  dragon door in Crystal Cave.
- Complete: falls return Buddy to Crystal Cave rather than costing a life.

### Sunken Castle

- Complete: underwater swimming through castle-stone platforms, light shafts,
  and bubble columns.
- Complete: pearl candy, seahorses, distant towers, and a Space/EAT shell gate
  in Coral Reef.
- Complete: fish-family Wedding interactions and falls that drift Buddy back to
  Coral Reef.

### Rainbow Dreamland

- Complete: the final discovery world; its visible Surface gate unlocks only
  after every other world has been explored.
- Complete: bouncy movement, layered rainbows, unicorns, stars, and sprinkle
  cookies.
- Complete: falls return Buddy softly to the Surface.

### Giant Toy Room

- Complete: Buddy appears tiny among giant blocks, drums, teddy bears, and toy
  trains.
- Complete: block platforms, alphabet-block obstacles, and cheese crackers.
- Complete: a Space/EAT magic toy chest on the Surface provides entry; falls
  return to the Surface.

## Shared implementation work

- Expand `WorldLayer`, consumable generation, persistence, map cards, and render
  scene state for all planned worlds.
- Add reusable magical gateways with safe Space/EAT activation and clear locked
  feedback for Rainbow Dreamland.
- Keep follower buddies, Wedding progress, snack progress, respawns, and map
  discoveries intact across every transition.
- Add focused unit/browser coverage and a rendered visual QA artifact for each
  slice before marking it complete.

## Delivery checklist

- [x] Exploration-gated, persistent world map
- [x] Moon Base
- [x] Dinosaur Jungle
- [x] Volcano World
- [x] Sunken Castle
- [x] Rainbow Dreamland
- [x] Giant Toy Room
- [x] Final full regression and documentation audit

## Verification record

- TypeScript production build: passed.
- Unit tests: 133 passed.
- Buddy browser tests: 14 passed, including every new world, persistent map
  locking, Rainbow gate progression, phone layout, and the original smoke tests.
- Full repository browser run: 36 of 38 passed. The two remaining failures are
  outside Buddy and in unchanged areas: the Farm till-color assertion and the
  3D wheel demo's existing missing-resource console errors. Both Buddy and
  World Map suites remained fully green in that run.
- Visual QA screenshots were reviewed for Moon Base, Dinosaur Jungle, Volcano
  World, Sunken Castle, Rainbow Dreamland, Giant Toy Room, and the 12-world map.
