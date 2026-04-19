import { Color, DataTexture, NearestFilter, RedFormat } from 'three';
import { MeshToonNodeMaterial } from 'three/webgpu';

// Cel-shaded material whose diffuse response is quantized into `steps` bands.
// Implemented via a 1D gradient map (R8), sampled nearest, which is the
// standard way to drive MeshToonMaterial's ramp.
export function createToonMaterial(color: number | string, steps: number = 3): MeshToonNodeMaterial {
  const gradient = makeGradientTexture(Math.max(2, Math.floor(steps)));
  const mat = new MeshToonNodeMaterial({ color: new Color(color) });
  mat.gradientMap = gradient;
  return mat;
}

function makeGradientTexture(steps: number): DataTexture {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    data[i] = Math.round((i / (steps - 1)) * 255);
  }
  const tex = new DataTexture(data, steps, 1, RedFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
