export interface EngineConfig {
  canvas: HTMLCanvasElement;
  pixelSize?: number;
  // Backbuffer multiplier. Defaults to min(devicePixelRatio, 1) because the
  // edge-detection output is pixelated anyway — DPR > 1 just burns fill rate.
  pixelRatio?: number;
  depthEdgeStrength?: number;
  normalEdgeStrength?: number;
  lineHighlight?: number;
  lineShadow?: number;
  depthThreshold?: [number, number];
  normalThreshold?: number;
  backgroundColor?: number;
  antialias?: boolean;
}

export interface EngineUpdate {
  (dt: number, elapsed: number): void;
}
