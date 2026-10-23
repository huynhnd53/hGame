import * as THREE from 'three';

export interface BillboardItem {
  pos: THREE.Vector3;
  /** Horizontal direction the image's right side should point to (e.g. a lamp arm towards the road); zero to never mirror. */
  out?: THREE.Vector3;
  /** Baked light level multiplier for this item. */
  light?: number;
}

export interface BillboardOptions {
  width: number;
  height: number;
  /** Horizontal position of the image's ground contact point, 0 = left edge, 1 = right edge. */
  anchorX: number;
  /** Extra offset of the quad centre in metres (x along the image, y up), for glows placed relative to a pole. */
  offset?: THREE.Vector2;
  additive?: boolean;
  /** Overall brightness of the photo at night. */
  brightness?: number;
  tint?: THREE.Color;
  /** Positions, facing and light will be rewritten every frame (moving people). */
  dynamic?: boolean;
}

/**
 * One instanced draw call for many copies of a cut-out photo. Each copy turns around its vertical axis to face
 * the camera, and mirrors itself so asymmetric objects (a lamp arm) point the right way.
 */
export function billboards(texture: THREE.Texture, items: BillboardItem[], o: BillboardOptions): THREE.Mesh {
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0.5, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('uv', base.getAttribute('uv'));
  g.instanceCount = items.length;
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(items.flatMap((i) => [i.pos.x, i.pos.y, i.pos.z])), 3));
  g.setAttribute(
    'aOut',
    new THREE.InstancedBufferAttribute(new Float32Array(items.flatMap((i) => [i.out?.x ?? 0, i.out?.z ?? 0])), 2),
  );
  g.setAttribute('aLight', new THREE.InstancedBufferAttribute(new Float32Array(items.map((i) => i.light ?? 1)), 1));
  if (o.dynamic) for (const a of ['aPos', 'aOut', 'aLight']) (g.getAttribute(a) as THREE.InstancedBufferAttribute).setUsage(THREE.DynamicDrawUsage);

  const tint = o.tint ?? new THREE.Color(1, 1, 1);
  const m = new THREE.ShaderMaterial({
    fog: true,
    transparent: !!o.additive,
    depthWrite: !o.additive,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSize: { value: new THREE.Vector2(o.width, o.height) },
        uAnchor: { value: o.anchorX },
        uOffset: { value: o.offset ?? new THREE.Vector2(0, 0) },
        uTint: { value: new THREE.Vector3(tint.r, tint.g, tint.b).multiplyScalar(o.brightness ?? 1) },
        uAdditive: { value: o.additive ? 1 : 0 },
      },
    ]),
    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute vec2 aOut;
      attribute float aLight;
      uniform vec2 uSize;
      uniform float uAnchor;
      uniform vec2 uOffset;
      varying vec2 vUv;
      varying float vLight;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vLight = aLight;
        vec2 toCam = cameraPosition.xz - aPos.xz;
        vec2 d = toCam / max(length(toCam), 0.001);
        vec2 right = vec2(d.y, -d.x);
        float flip = (dot(aOut, aOut) > 0.0 && dot(aOut, right) < 0.0) ? -1.0 : 1.0;
        float x = ((position.x - uAnchor) * uSize.x + uOffset.x) * flip;
        float y = position.y * uSize.y + uOffset.y;
        vec3 world = aPos + vec3(right.x * x, y, right.y * x);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 uTint;
      uniform float uAdditive;
      varying vec2 vUv;
      varying float vLight;
      #include <fog_pars_fragment>
      void main() {
        vec4 c = texture2D(map, vUv);
        if (uAdditive < 0.5 && c.a < 0.5) discard;
        gl_FragColor = vec4(c.rgb * uTint * vLight * (uAdditive > 0.5 ? c.a : 1.0), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  // Set after merge: UniformsUtils.merge would clone the texture before its image has loaded.
  m.uniforms.map = { value: texture };
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

export function loadTexture(url: string): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
