import {
  NearestFilter,
  Vector4,
  TempNode,
  NodeUpdateType,
  PassNode,
  type Scene,
  type Camera,
} from 'three/webgpu';
import {
  Fn,
  float,
  uv,
  uniform,
  convertToTexture,
  vec2,
  vec3,
  vec4,
  clamp,
  dot,
  smoothstep,
  sign,
  step,
  mrt,
  output,
  normalView,
  property,
} from 'three/tsl';

// TSL nodes aren't fully typed in Three.js 0.184; `any` here keeps the
// shader code readable without a layer of casts on every chained call.
type N = any;

// TSL port of the Godot "3DPixelArt_Tutorial/edge_detection.gdshader" (same
// lineage as Kody King's threejs pixel example). Differences vs Three's stock
// PixelationPassNode:
//  - uses linearized depth so thresholds are resolution/near-far-ratio stable
//  - separates line highlight (additive on normal edges) from line shadow
//    (multiplicative darken on depth edges) for the chunky pixel-art look
class EdgeDetectionNode extends TempNode {
  static get type(): string {
    return 'EdgeDetectionNode';
  }

  textureNode: N;
  depthNode: N;
  normalNode: N;
  depthEdgeStrength: N;
  normalEdgeStrength: N;
  lineHighlight: N;
  lineShadow: N;
  depthThresholdLo: N;
  depthThresholdHi: N;
  normalThreshold: N;
  private _resolution: N;

  constructor(
    textureNode: N,
    depthNode: N,
    normalNode: N,
    depthEdgeStrength: N,
    normalEdgeStrength: N,
    lineHighlight: N,
    lineShadow: N,
    depthThresholdLo: N,
    depthThresholdHi: N,
    normalThreshold: N,
  ) {
    super('vec4');
    this.textureNode = textureNode;
    this.depthNode = depthNode;
    this.normalNode = normalNode;
    this.depthEdgeStrength = depthEdgeStrength;
    this.normalEdgeStrength = normalEdgeStrength;
    this.lineHighlight = lineHighlight;
    this.lineShadow = lineShadow;
    this.depthThresholdLo = depthThresholdLo;
    this.depthThresholdHi = depthThresholdHi;
    this.normalThreshold = normalThreshold;
    this._resolution = uniform(new Vector4());
    this.updateType = NodeUpdateType.FRAME;
  }

  update(): boolean {
    const map = (this.textureNode as any).value;
    const width = map.image.width;
    const height = map.image.height;
    this._resolution.value.set(width, height, 1 / width, 1 / height);
    return true;
  }

  setup(): N {
    const { textureNode, depthNode, normalNode } = this;
    const uvNodeTexture = (textureNode as any).uvNode || uv();
    const uvNodeDepth = (depthNode as any).uvNode || uv();
    const uvNodeNormal = (normalNode as any).uvNode || uv();

    const sampleColor = (): N => (textureNode as any).sample(uvNodeTexture);
    const sampleDepth = (x: number, y: number): N =>
      (depthNode as any).sample(uvNodeDepth.add(vec2(x, y).mul(this._resolution.zw))).r;
    const sampleNormal = (x: number, y: number): N =>
      (normalNode as any).sample(uvNodeNormal.add(vec2(x, y).mul(this._resolution.zw)))
        .rgb.normalize();

    const depthEdgeIndicator = (depth: N): N => {
      const diff = property('float', 'diff');
      diff.addAssign(clamp(sampleDepth(1, 0).sub(depth), 0.0, 1.0));
      diff.addAssign(clamp(sampleDepth(-1, 0).sub(depth), 0.0, 1.0));
      diff.addAssign(clamp(sampleDepth(0, 1).sub(depth), 0.0, 1.0));
      diff.addAssign(clamp(sampleDepth(0, -1).sub(depth), 0.0, 1.0));
      return smoothstep(this.depthThresholdLo, this.depthThresholdHi, diff);
    };

    const neighborNormalEdgeIndicator = (x: number, y: number, depth: N, normal: N): N => {
      const depthDiff = sampleDepth(x, y).sub(depth);
      const neighborNormal = sampleNormal(x, y);
      const normalEdgeBias = vec3(1, 1, 1);
      const normalDiff = dot(normal.sub(neighborNormal), normalEdgeBias);
      const normalIndicator = clamp(smoothstep(-0.01, 0.01, normalDiff), 0.0, 1.0);
      const depthIndicator = clamp(sign(depthDiff.mul(0.25).add(0.0025)), 0.0, 1.0);
      return float(1.0).sub(dot(normal, neighborNormal)).mul(depthIndicator).mul(normalIndicator);
    };

    const normalEdgeIndicator = (depth: N, normal: N): N => {
      const indicator = property('float', 'nIndicator');
      indicator.addAssign(neighborNormalEdgeIndicator(0, -1, depth, normal));
      indicator.addAssign(neighborNormalEdgeIndicator(0, 1, depth, normal));
      indicator.addAssign(neighborNormalEdgeIndicator(-1, 0, depth, normal));
      indicator.addAssign(neighborNormalEdgeIndicator(1, 0, depth, normal));
      return step(this.normalThreshold, indicator);
    };

    const combined = Fn(() => {
      const colorSample = sampleColor();
      const depth = sampleDepth(0, 0);
      const normal = sampleNormal(0, 0);

      const dei = depthEdgeIndicator(depth).mul(this.depthEdgeStrength);
      const nei = normalEdgeIndicator(depth, normal).mul(this.normalEdgeStrength);

      // Godot blend: additive highlight on normal edges, multiplicative darken on depth edges.
      const highlight = clamp(nei.sub(dei), 0.0, 1.0).mul(this.lineHighlight);
      const shaded = colorSample.rgb.sub(colorSample.rgb.mul(dei).mul(this.lineShadow));
      const final = shaded.add(vec3(highlight));
      return vec4(final, colorSample.a);
    });

    return combined() as N;
  }
}

const edgeDetect = (
  color: N,
  depth: N,
  normal: N,
  depthEdgeStrength: N,
  normalEdgeStrength: N,
  lineHighlight: N,
  lineShadow: N,
  depthThresholdLo: N,
  depthThresholdHi: N,
  normalThreshold: N,
): EdgeDetectionNode =>
  new EdgeDetectionNode(
    convertToTexture(color),
    convertToTexture(depth),
    convertToTexture(normal),
    depthEdgeStrength,
    normalEdgeStrength,
    lineHighlight,
    lineShadow,
    depthThresholdLo,
    depthThresholdHi,
    normalThreshold,
  );

export interface EdgeDetectionParams {
  pixelSize: number;
  depthEdgeStrength: number;
  normalEdgeStrength: number;
  lineHighlight: number;
  lineShadow: number;
  depthThreshold: [number, number];
  normalThreshold: number;
}

export const DEFAULT_EDGE_PARAMS: EdgeDetectionParams = {
  pixelSize: 4,
  depthEdgeStrength: 1.0,
  normalEdgeStrength: 1.0,
  lineHighlight: 0.2,
  lineShadow: 0.55,
  depthThreshold: [0.001, 0.003],
  normalThreshold: 0.1,
};

export class EdgeDetectionPassNode extends PassNode {
  static get type(): string {
    return 'EdgeDetectionPassNode';
  }

  pixelSize: number;
  params: {
    depthEdgeStrength: N;
    normalEdgeStrength: N;
    lineHighlight: N;
    lineShadow: N;
    depthThresholdLo: N;
    depthThresholdHi: N;
    normalThreshold: N;
  };

  constructor(scene: Scene, camera: Camera, params: EdgeDetectionParams = DEFAULT_EDGE_PARAMS) {
    super(PassNode.COLOR, scene, camera, { minFilter: NearestFilter, magFilter: NearestFilter });
    this.pixelSize = params.pixelSize;
    this.params = {
      depthEdgeStrength: uniform(params.depthEdgeStrength),
      normalEdgeStrength: uniform(params.normalEdgeStrength),
      lineHighlight: uniform(params.lineHighlight),
      lineShadow: uniform(params.lineShadow),
      depthThresholdLo: uniform(params.depthThreshold[0]),
      depthThresholdHi: uniform(params.depthThreshold[1]),
      normalThreshold: uniform(params.normalThreshold),
    };
    // MRT: color → 'output', view-space normal → 'normal' (depth auto-exposed by PassNode).
    (this as any)._mrt = mrt({ output, normal: normalView });
  }

  setSize(width: number, height: number): void {
    const adjustedWidth = Math.max(1, Math.floor(width / this.pixelSize));
    const adjustedHeight = Math.max(1, Math.floor(height / this.pixelSize));
    super.setSize(adjustedWidth, adjustedHeight);
  }

  setup(_builder: any): any {
    const color = super.getTextureNode('output') as N;
    const normal = super.getTextureNode('normal') as N;
    // Raw depth texture (0..1 non-linear). Thresholds are tuned for this.
    const depth = super.getTextureNode('depth') as N;
    return edgeDetect(
      color,
      depth,
      normal,
      this.params.depthEdgeStrength,
      this.params.normalEdgeStrength,
      this.params.lineHighlight,
      this.params.lineShadow,
      this.params.depthThresholdLo,
      this.params.depthThresholdHi,
      this.params.normalThreshold,
    );
  }
}

export const edgeDetectionPass = (
  scene: Scene,
  camera: Camera,
  params?: Partial<EdgeDetectionParams>,
): EdgeDetectionPassNode =>
  new EdgeDetectionPassNode(scene, camera, { ...DEFAULT_EDGE_PARAMS, ...params });
