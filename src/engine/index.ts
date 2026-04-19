export { Engine } from './renderer';
export type { EngineConfig, EngineUpdate } from './types';
export { createToonMaterial } from './materials/toon';
export {
  edgeDetectionPass,
  EdgeDetectionPassNode,
  DEFAULT_EDGE_PARAMS,
  type EdgeDetectionParams,
} from './post/edge-detection';
