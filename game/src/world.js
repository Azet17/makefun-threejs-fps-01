// FERRO YARD — original industrial rail-yard map (40 x 60 m), built from boxes
// and cylinders. One job: map geometry, collision, line of sight, waypoints.
import * as THREE from 'three';

// Palette: dusk amber accent on slate, rust containers, teal hazard trim.
export const PALETTE = {
  ground: 0x23262b, groundLine: 0x2c3036, wall: 0x2e3238, wallTop: 0x3a3f46,
  crate: 0x4a4036, crateDark: 0x3a322a, rust: 0x8a4a2a, rustDark: 0x6e3a20,
  teal: 0x1f6f66, amber: 0xb07f24, hazard: 0xd8a020, tank: 0x5c6670,
  rail: 0x4d4a45, sky: 0x1a2028, fog: 0x1a2028, siteA: 0xf0a830, siteB: 0x2fb3a3,
};

// A collider box: centre x/z, width/depth, height, colour. y0 = base height.
function B(cx, cz, w, d, h, color, y0 = 0) {
  return { cx, cz, w, d, h, y0, color, minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 };
}

// The map. x in [-20, 20], z in [-30, 30]. Vanguard spawns south (+z),
// Sentinel north (-z). Site A = loading dock (west), Site B = fuel depot (east).
export const MAP = {
  bounds: { minX: -20, maxX: 20, minZ: -30, maxZ: 30 },
  sites: {
    A: { x: -14.5, z: -19, r: 4.5, name: 'A — LOADING DOCK' },
    B: { x: 14.5, z: -19, r: 4.5, name: 'B — FUEL DEPOT' },
  },
  spawns: {
    vanguard: [
      { x: -4, z: 26 }, { x: -2, z: 27 }, { x: 0, z: 26 }, { x: 2, z: 27 }, { x: 4, z: 26 },
    ],
    sentinel: [
      { x: -6, z: -26 }, { x: -3, z: -27 }, { x: 0, z: -26 }, { x: 3, z: -27 }, { x: 6, z: -26 },
    ],
  },
  boxes: [
    // Perimeter walls (tall, block sight + movement).
    B(0, -30, 42, 1.2, 4.5, PALETTE.wall), B(0, 30, 42, 1.2, 4.5, PALETTE.wall),
    B(-20, 0, 1.2, 62, 4.5, PALETTE.wall), B(20, 0, 1.2, 62, 4.5, PALETTE.wall),
    // Mid lane: two container walls forming the corridor, with a gap at centre.
    B(-5.5, -2, 5, 1.2, 2.6, PALETTE.rust), B(5.5, -2, 5, 1.2, 2.6, PALETTE.teal),
    B(-5.5, 6, 5, 1.2, 2.6, PALETTE.teal), B(5.5, 6, 5, 1.2, 2.6, PALETTE.rust),
    B(0, -12, 2.4, 2.4, 1.2, PALETTE.crate), // mid block, low cover
    B(0, 12, 3, 1.4, 1.2, PALETTE.crate),
    // A-long (west lane): warehouse crates, staggered for corners.
    B(-14, -8, 4, 2, 2.4, PALETTE.rust), B(-16.5, 0, 2, 4, 2.4, PALETTE.crate),
    B(-12, 6, 3, 2, 1.2, PALETTE.crate), B(-16, 12, 4, 2, 2.6, PALETTE.teal),
    B(-12, -14, 2.4, 2.4, 1.2, PALETTE.crate),
    // A site: dock platform crates + a tall stack (sightline blocker).
    B(-17, -19, 2, 6, 2.6, PALETTE.rust), B(-11, -23, 4, 2, 2.6, PALETTE.crate),
    B(-14, -23.5, 2.2, 2.2, 3.4, PALETTE.rustDark),
    // B-short (east lane): fuel tanks + crates.
    B(14, -8, 4, 2, 2.4, PALETTE.teal), B(16.5, 0, 2, 4, 2.4, PALETTE.crate),
    B(12, 6, 3, 2, 1.2, PALETTE.crate), B(16, 12, 4, 2, 2.6, PALETTE.rust),
    B(12, -14, 2.4, 2.4, 1.2, PALETTE.crate),
    // B site: two fuel tanks (cylinders, colliders approximated as boxes) + crates.
    B(17, -19, 2.6, 2.6, 3.2, PALETTE.tank), B(12, -23, 2.6, 2.6, 3.2, PALETTE.tank),
    B(15, -15, 3, 1.6, 1.2, PALETTE.crate),
    // South yard (Vanguard side): scattered cover + rail sleepers.
    B(-9, 18, 4, 1.6, 1.2, PALETTE.crate), B(9, 18, 4, 1.6, 1.2, PALETTE.crate),
    B(0, 21, 2.4, 2.4, 1.2, PALETTE.crate), B(-13, 22, 3, 2, 2.4, PALETTE.rust),
    B(13, 22, 3, 2, 2.4, PALETTE.teal),
    // North yard (Sentinel side): cover in front of the sites.
    B(-6, -16, 3, 1.6, 1.2, PALETTE.crate), B(6, -16, 3, 1.6, 1.2, PALETTE.crate),
    B(0, -22, 2, 2, 1.2, PALETTE.crate),
    // Central plaza pillar.
    B(0, 0, 1.6, 1.6, 3.6, PALETTE.wallTop),
  ],
  // Cylinders drawn on top of their box colliders (fuel tanks at B, silo at A).
  cylinders: [
    { x: 17, z: -19, r: 1.3, h: 3.2, color: PALETTE.tank },
    { x: 12, z: -23, r: 1.3, h: 3.2, color: PALETTE.tank },
    { x: -14, z: -23.5, r: 1.1, h: 3.4, color: PALETTE.rustDark },
  ],
  // Waypoint graph: corners, cover spots, site entries, mid. Edges are built
  // at load by line-of-sight within 16 m.
  waypoints: [
    { x: 0, z: 26 }, { x: -4, z: 22 }, { x: 4, z: 22 }, { x: -9, z: 16 }, { x: 9, z: 16 },
    { x: 0, z: 15 }, { x: -4, z: 10 }, { x: 4, z: 10 }, { x: -12, z: 8 }, { x: 12, z: 8 },
    { x: 0, z: 4 }, { x: -8, z: -2 }, { x: 8, z: -2 }, { x: 0, z: -6 }, { x: -14, z: -6 },
    { x: 14, z: -6 }, { x: -12, z: -12 }, { x: 12, z: -12 }, { x: -14, z: -19 }, { x: 14, z: -19 },
    { x: -9, z: -21 }, { x: 9, z: -21 }, { x: 0, z: -26 }, { x: -6, z: -26 }, { x: 6, z: -26 },
    { x: -17, z: -14 }, { x: 17, z: -14 }, { x: 0, z: -14 }, { x: -4, z: -18 }, { x: 4, z: -18 },
  ],
  // Defender hold spots (waypoint index + facing yaw).
  holds: [
    { wp: 18, yaw: Math.PI }, { wp: 19, yaw: Math.PI }, { wp: 26, yaw: Math.PI * 0.5 },
    { wp: 13, yaw: Math.PI }, { wp: 16, yaw: Math.PI * 0.75 }, { wp: 27, yaw: Math.PI * 0.25 },
  ],
};

// ---- collision / ray helpers (pure math, no allocations in hot paths) ----

export function pointInBoxXZ(x, z, b) {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

// Push a circle (x, z, radius) out of every box it overlaps; returns true if moved.
export function collideCircle(pos, radius, boxes) {
  let hit = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.h <= 0.2) continue; // step-over low trim, not used here
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * radius;
      pos.z = cz + (dz / d) * radius;
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const px = Math.min(pos.x - b.minX, b.maxX - pos.x);
      const pz = Math.min(pos.z - b.minZ, b.maxZ - pos.z);
      if (px < pz) pos.x = pos.x - b.minX < b.maxX - pos.x ? b.minX - radius : b.maxX + radius;
      else pos.z = pos.z - b.minZ < b.maxZ - pos.z ? b.minZ - radius : b.maxZ + radius;
    }
  }
  // Clamp to map bounds.
  const m = MAP.bounds;
  pos.x = Math.max(m.minX + radius, Math.min(m.maxX - radius, pos.x));
  pos.z = Math.max(m.minZ + radius, Math.min(m.maxZ - radius, pos.z));
  return hit;
}

// Ray vs AABB (slab test) in 3D. Returns nearest t in [0, maxDist] or Infinity.
const _t = { tmin: 0, tmax: 0 };
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxDist) {
  let tmin = 0, tmax = maxDist;
  // X
  if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) return Infinity; }
  else {
    let a = (b.minX - ox) / dx, c = (b.maxX - ox) / dx;
    if (a > c) { const t = a; a = c; c = t; }
    tmin = Math.max(tmin, a); tmax = Math.min(tmax, c);
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) return Infinity; }
  else {
    let a = (b.minZ - oz) / dz, c = (b.maxZ - oz) / dz;
    if (a > c) { const t = a; a = c; c = t; }
    tmin = Math.max(tmin, a); tmax = Math.min(tmax, c);
    if (tmin > tmax) return Infinity;
  }
  // Y: box spans y0..y0+h
  if (Math.abs(dy) < 1e-9) { if (oy < b.y0 || oy > b.y0 + b.h) return Infinity; }
  else {
    let a = (b.y0 - oy) / dy, c = (b.y0 + b.h - oy) / dy;
    if (a > c) { const t = a; a = c; c = t; }
    tmin = Math.max(tmin, a); tmax = Math.min(tmax, c);
    if (tmin > tmax) return Infinity;
  }
  _t.tmin = tmin; _t.tmax = tmax;
  return tmin;
}

// Nearest wall distance along a ray, or Infinity.
export function rayWalls(ox, oy, oz, dx, dy, dz, boxes, maxDist) {
  let best = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, boxes[i], maxDist);
    if (t < best) best = t;
  }
  return best;
}

// 2D line of sight at eye height: true when no box blocks the segment.
export function losClear(ax, az, bx, bz, boxes, eyeY = 1.5) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const t = rayWalls(ax, eyeY, az, dx / len, 0, dz / len, boxes, len);
  return t === Infinity;
}

// Breadth-first path over the waypoint graph; returns array of {x, z}.
export function buildGraph(boxes) {
  const wps = MAP.waypoints;
  const edges = wps.map(() => []);
  for (let i = 0; i < wps.length; i++) {
    for (let j = i + 1; j < wps.length; j++) {
      const a = wps[i], b = wps[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d <= 16 && losClear(a.x, a.z, b.x, b.z, boxes)) {
        edges[i].push(j); edges[j].push(i);
      }
    }
  }
  return edges;
}

export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < MAP.waypoints.length; i++) {
    const w = MAP.waypoints[i];
    const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function findPath(edges, fromWp, toWp) {
  if (fromWp === toWp) return [MAP.waypoints[toWp]];
  const prev = new Int16Array(MAP.waypoints.length).fill(-1);
  const queue = [fromWp];
  prev[fromWp] = fromWp;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === toWp) break;
    for (const nb of edges[cur]) {
      if (prev[nb] === -1) { prev[nb] = cur; queue.push(nb); }
    }
  }
  if (prev[toWp] === -1) return [MAP.waypoints[toWp]];
  const path = [];
  let cur = toWp;
  while (cur !== fromWp) { path.push(MAP.waypoints[cur]); cur = prev[cur]; }
  path.reverse();
  return path;
}

// ---- scene construction ----

const _matCache = new Map();
function mat(color) {
  let m = _matCache.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); _matCache.set(color, m); }
  return m;
}

export function buildWorld(scene) {
  const group = new THREE.Group();
  group.name = 'ferro-yard';
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 20);

  // Ground: big slab + painted lane lines + site decals.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(42, 62), new THREE.MeshLambertMaterial({ color: PALETTE.ground }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  // Rail tracks down mid (two dark strips + sleepers).
  const railMat = mat(PALETTE.rail);
  for (const rx of [-1.1, 1.1]) {
    const rail = new THREE.Mesh(boxGeo, railMat);
    rail.scale.set(0.18, 0.08, 56); rail.position.set(rx, 0.04, 0); group.add(rail);
  }
  // Site decals: flat coloured rings marking A and B.
  for (const key of ['A', 'B']) {
    const s = MAP.sites[key];
    const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.35, s.r, 40),
      new THREE.MeshBasicMaterial({ color: PALETTE['site' + key], transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.03, s.z); group.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24),
      new THREE.MeshBasicMaterial({ color: PALETTE['site' + key], transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(s.x, 0.03, s.z); group.add(disc);
  }

  // Boxes: mesh + top trim for the tall ones.
  const meshes = [];
  for (const b of MAP.boxes) {
    const mesh = new THREE.Mesh(boxGeo, mat(b.color));
    mesh.scale.set(b.w, b.h, b.d);
    mesh.position.set(b.cx, b.y0 + b.h / 2, b.cz);
    mesh.castShadow = false; mesh.receiveShadow = true;
    group.add(mesh); meshes.push(mesh);
    if (b.h >= 3.4) {
      const trim = new THREE.Mesh(boxGeo, mat(PALETTE.hazard));
      trim.scale.set(b.w + 0.06, 0.12, b.d + 0.06);
      trim.position.set(b.cx, b.y0 + b.h - 0.15, b.cz);
      group.add(trim);
    }
  }
  for (const c of MAP.cylinders) {
    const mesh = new THREE.Mesh(cylGeo, mat(c.color));
    mesh.scale.set(c.r, c.h, c.r);
    mesh.position.set(c.x, c.h / 2, c.z);
    group.add(mesh); meshes.push(mesh);
  }

  // Dusk sky: big gradient dome (BackSide) + fog.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x2c3550) }, bottom: { value: new THREE.Color(0xd98a2b) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bottom; void main(){ float h = clamp(normalize(vP).y * 1.6 + 0.25, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
    }));
  group.add(sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 45, 110);

  // Lights: dusk hemisphere + low amber sun + site lamps.
  const hemi = new THREE.HemisphereLight(0x8a97b8, 0x2a2118, 0.85);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xf0a830, 1.6);
  sun.position.set(-30, 26, 18);
  group.add(sun);
  for (const key of ['A', 'B']) {
    const s = MAP.sites[key];
    const lamp = new THREE.PointLight(PALETTE['site' + key], 22, 22, 1.8);
    lamp.position.set(s.x, 5, s.z);
    group.add(lamp);
  }
  const midLamp = new THREE.PointLight(0xffc46b, 14, 18, 1.8);
  midLamp.position.set(0, 5, 0);
  group.add(midLamp);

  scene.add(group);
  return { group, colliders: MAP.boxes, meshes };
}
