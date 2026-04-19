import { PerspectiveCamera, Scene, Color } from 'three';
import { WebGPURenderer, RenderPipeline } from 'three/webgpu';
import type { EngineConfig, EngineUpdate } from './types';
import { edgeDetectionPass, type EdgeDetectionPassNode, DEFAULT_EDGE_PARAMS } from './post/edge-detection';

// High-level engine wrapper: owns the WebGPU renderer, one active scene and
// camera, and a post-processing chain that ends in the pixel-art edge pass.
// Games construct their content inside `engine.scene`; engine drives rAF.
export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGPURenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly pipeline: RenderPipeline;
  readonly edgePass: EdgeDetectionPassNode;

  private _running = false;
  private _rafId = 0;
  private _lastFrame = 0;
  private _startTime = 0;
  private _updates: EngineUpdate[] = [];
  private _ready: Promise<unknown>;

  constructor(config: EngineConfig) {
    this.canvas = config.canvas;

    this.renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: config.antialias ?? false,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.canvas.clientWidth || 800, this.canvas.clientHeight || 600, false);

    this.scene = new Scene();
    this.scene.background = new Color(config.backgroundColor ?? 0x1a1a2e);

    this.camera = new PerspectiveCamera(
      60,
      (this.canvas.clientWidth || 800) / (this.canvas.clientHeight || 600),
      0.1,
      100,
    );
    this.camera.position.set(5, 5, 5);
    this.camera.lookAt(0, 0, 0);

    this.edgePass = edgeDetectionPass(this.scene, this.camera, {
      pixelSize: config.pixelSize ?? DEFAULT_EDGE_PARAMS.pixelSize,
      depthEdgeStrength: config.depthEdgeStrength ?? DEFAULT_EDGE_PARAMS.depthEdgeStrength,
      normalEdgeStrength: config.normalEdgeStrength ?? DEFAULT_EDGE_PARAMS.normalEdgeStrength,
      lineHighlight: config.lineHighlight ?? DEFAULT_EDGE_PARAMS.lineHighlight,
      lineShadow: config.lineShadow ?? DEFAULT_EDGE_PARAMS.lineShadow,
      depthThreshold: config.depthThreshold ?? DEFAULT_EDGE_PARAMS.depthThreshold,
      normalThreshold: config.normalThreshold ?? DEFAULT_EDGE_PARAMS.normalThreshold,
    });

    this.pipeline = new RenderPipeline(this.renderer);
    this.pipeline.outputNode = this.edgePass as any;

    this._ready = this.renderer.init();
    window.addEventListener('resize', this._onResize);
    this._onResize();
  }

  ready(): Promise<unknown> {
    return this._ready;
  }

  onUpdate(fn: EngineUpdate): void {
    this._updates.push(fn);
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._startTime = performance.now();
    this._lastFrame = this._startTime;
    this._rafId = requestAnimationFrame(this._loop);
  }

  stop(): void {
    this._running = false;
    cancelAnimationFrame(this._rafId);
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }

  private _onResize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private _loop = (now: number): void => {
    if (!this._running) return;
    const dt = Math.min(0.05, (now - this._lastFrame) / 1000);
    const elapsed = (now - this._startTime) / 1000;
    this._lastFrame = now;
    for (const fn of this._updates) fn(dt, elapsed);
    this.pipeline.render();
    this._rafId = requestAnimationFrame(this._loop);
  };
}
