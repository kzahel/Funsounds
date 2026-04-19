export interface EngineConfig {
  canvas: HTMLCanvasElement;
  pixelSize?: number;
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
