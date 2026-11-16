// Weapons: definitions, hitscan firing, recoil/spread, reload, HE grenades.
// Hitscan raycast runs against wall AABBs (world.rayWalls) and fighter body
// capsules (three Raycaster against bot meshes). One job: gunplay.
import * as THREE from 'three';
import { rayWalls, rayBox, collideCircle } from './world.js';

export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 PISTOL', kind: 'pistol', dmg: 22, headMult: 4, mag: 12, reserve: Infinity, rate: 0.22, auto: false, spread: 0.012, moveSpread: 0.02, bloom: 0.012, kick: 0.011, price: 300, range: 60 },
  rifle: { id: 'rifle', name: 'VK-47 RIFLE', kind: 'rifle', dmg: 27, headMult: 4, mag: 30, reserve: 90, rate: 0.115, auto: true, spread: 0.016, moveSpread: 0.03, bloom: 0.016, kick: 0.016, price: 2700, range: 80 },
  smg: { id: 'smg', name: 'HORNET-9 SMG', kind: 'smg', dmg: 18, headMult: 4, mag: 32, reserve: 96, rate: 0.075, auto: true, spread: 0.02, moveSpread: 0.045, bloom: 0.014, kick: 0.01, price: 1500, range: 50 },
  sniper: { id: 'sniper', name: 'LONGBOW .50', kind: 'sniper', dmg: 90, headMult: 4, mag: 5, reserve: 15, rate: 1.15, auto: false, spread: 0.004, moveSpread: 0.05, bloom: 0.03, kick: 0.05, price: 4750, range: 120 },
};

// A fighter's owned weapons: { id: { mag, reserve } }.
export function freshLoadout() {
  return { pistol: { mag: 12, reserve: Infinity } };
}

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _target = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
// Temp AABB for the player's body/head (the player has no mesh — first person).
const _pbox = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: 0, h: 0 };

// Where a fighter's gun tip is (for tracers + muzzle origin).
export function muzzlePos(f, out) {
  const yaw = f.yaw;
  out.set(
    f.pos.x - Math.sin(yaw) * 0.35 + Math.cos(yaw) * 0.18,
    f.pos.y + f.eyeH - 0.12,
    f.pos.z - Math.cos(yaw) * 0.35 - Math.sin(yaw) * 0.18,
  );
  return out;
}

// Aim direction with spread applied (rng-driven, deterministic per seed).
export function aimDir(f, w, rng, moving, airborne, scoped) {
  const spread = (scoped ? w.spread * 0.25 : w.spread)
    + (moving ? w.moveSpread : 0) + (airborne ? 0.03 : 0) + f.bloom;
  const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
  const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
  // Forward: yaw 0 faces -z.
  _dir.set(-sy * cp, sp, -cy * cp);
  // Perturb by a small random cone (x/y offsets, re-normalised).
  const a = rng.next() * Math.PI * 2;
  const r = rng.next() * spread;
  _dir.x += Math.cos(a) * r;
  _dir.y += Math.sin(a) * r;
  _dir.normalize();
  return _dir;
}

// Hitscan: nearest wall vs nearest fighter body/head. Returns hit or null.
export function raycastShot(G, origin, dir, shooter, maxDist) {
  const wallT = rayWalls(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, G.world.colliders, maxDist);
  // Fighter hit: ray vs each alive fighter's head + body meshes.
  let bestT = wallT, bestF = null, bestPart = null;
  _raycaster.set(origin, dir);
  _raycaster.far = Math.min(maxDist, wallT);
  for (const f of G.fighters) {
    if (!f.alive || f === shooter) continue;
    if (f.isPlayer) {
      // The player has no mesh: test body + head boxes directly.
      const p = f.pos;
      _pbox.minX = p.x - 0.26; _pbox.maxX = p.x + 0.26;
      _pbox.minZ = p.z - 0.26; _pbox.maxZ = p.z + 0.26;
      _pbox.y0 = p.y + 0.15; _pbox.h = 1.2;
      const tb = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, _pbox, Math.min(maxDist, wallT));
      _pbox.y0 = p.y + 1.35; _pbox.h = 0.35;
      const th = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, _pbox, Math.min(maxDist, wallT));
      if (th < bestT) { bestT = th; bestF = f; bestPart = 'head'; }
      else if (tb < bestT) { bestT = tb; bestF = f; bestPart = 'body'; }
      continue;
    }
    const hits = _raycaster.intersectObjects(f.hitMeshes, false);
    if (hits.length > 0 && hits[0].distance < bestT) {
      bestT = hits[0].distance;
      bestF = f;
      bestPart = hits[0].object.userData.part || 'body';
    }
  }
  if (bestF) {
    _target.copy(origin).addScaledVector(dir, bestT);
    return { fighter: bestF, part: bestPart, dist: bestT, point: _target.clone() };
  }
  _target.copy(origin).addScaledVector(dir, Math.min(wallT, maxDist));
  return { fighter: null, part: null, dist: Math.min(wallT, maxDist), point: _target.clone(), wall: wallT !== Infinity };
}

// Apply damage with armor (50% absorbed) and headshot multiplier.
export function damageFighter(G, target, amount, attacker, part, point) {
  if (!target.alive) return 0;
  const dealt = Math.round(amount * (part === 'head' ? 4 : 1));
  let left = dealt;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, Math.ceil(left * 0.5));
    target.armor -= absorbed;
    left -= absorbed;
  }
  target.hp -= left;
  target.lastHitBy = attacker;
  target.lastHitPart = part;
  if (target.isPlayer) {
    G.audio.hurt();
    G.hud.flashDamage();
  } else if (attacker && attacker.isPlayer) {
    G.audio.hit();
    G.hud.showHitmarker(part === 'head');
    G.hud.damageNumber(point, dealt);
  }
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    killFighter(G, target, attacker, part);
  }
  return dealt;
}

export function killFighter(G, target, attacker, part) {
  if (target.mesh) target.mesh.visible = false;
  if (target.isPlayer) G.playerDied = true;
  if (attacker) {
    G.addKillfeed(attacker, target, part === 'head');
    if (attacker.isPlayer) {
      G.audio.kill();
      G.economy.addKillReward(attacker);
    }
  }
  // Bots near the death hear it.
  G.onNoise(target.pos.x, target.pos.z, 14, target);
}

// Fire one shot from fighter f (checks ammo, rate, auto). Returns 'shot'|'dry'|'wait'.
export function tryFire(G, f, now, opts = {}) {
  const w = WEAPONS[f.weapon];
  const slot = f.weapons[f.weapon];
  if (!f.alive || f.reloading) return 'wait';
  if (now - f.lastShot < w.rate) return 'wait';
  if (slot.mag <= 0) {
    if (f.isPlayer) { G.audio.dryFire(); startReload(G, f); }
    else startReload(G, f);
    return 'dry';
  }
  slot.mag -= 1;
  f.lastShot = now;
  f.bloom = Math.min(0.09, f.bloom + w.bloom);
  f.pitch += w.kick * (f.isPlayer ? 1 : 0.4); // recoil kicks the aim up
  f.yaw += (G.rng.next() - 0.5) * w.kick * 0.4;

  const origin = muzzlePos(f, _origin);
  const scoped = f.isPlayer && f.weapon === 'sniper' && f.scoped;
  const dir = aimDir(f, w, G.rng, f.speed > 1.5, !f.grounded, scoped).clone();
  const hit = raycastShot(G, origin, dir, f, w.range);
  G.spawnTracer(origin, hit.point, f.team);
  if (hit.fighter) {
    damageFighter(G, hit.fighter, w.dmg, f, hit.part, hit.point);
  }
  G.audio.shot(f.isPlayer ? w.kind : 'distant');
  if (f.isPlayer) G.onNoise(f.pos.x, f.pos.z, 25, f); // gunfire is loud
  return 'shot';
}

export function startReload(G, f) {
  const w = WEAPONS[f.weapon];
  const slot = f.weapons[f.weapon];
  if (f.reloading || slot.mag >= w.mag || (slot.reserve !== Infinity && slot.reserve <= 0)) return false;
  f.reloading = true;
  f.reloadEnd = G.time + (f.weapon === 'sniper' ? 2.4 : f.weapon === 'rifle' ? 2.1 : 1.6);
  if (f.isPlayer) G.audio.reload();
  return true;
}

export function finishReload(G, f) {
  const w = WEAPONS[f.weapon];
  const slot = f.weapons[f.weapon];
  const need = w.mag - slot.mag;
  const take = slot.reserve === Infinity ? need : Math.min(need, slot.reserve);
  slot.mag += take;
  if (slot.reserve !== Infinity) slot.reserve -= take;
  f.reloading = false;
}

export function switchWeapon(G, f, id) {
  if (!f.weapons[id] || f.weapon === id || f.reloading) return false;
  f.weapon = id;
  f.lastShot = 0;
  f.bloom = 0;
  if (f.isPlayer) { f.scoped = false; G.hud.setScoped(false); }
  return true;
}

// ---- HE grenades ----

export function throwGrenade(G, f) {
  if (!f.alive || f.grenades <= 0) return false;
  f.grenades -= 1;
  const g = G.grenadePool.find((x) => !x.active);
  if (!g) return false;
  const origin = muzzlePos(f, _origin);
  g.active = true;
  g.pos.copy(origin);
  const cp = Math.cos(f.pitch);
  g.vel.set(-Math.sin(f.yaw) * cp, Math.sin(f.pitch) + 0.35, -Math.cos(f.yaw) * cp).multiplyScalar(13);
  g.fuse = 1.6;
  g.owner = f;
  g.mesh.visible = true;
  g.mesh.position.copy(g.pos);
  G.audio.grenadePin();
  G.onNoise(f.pos.x, f.pos.z, 25, f);
  return true;
}

export function updateGrenades(G, dt) {
  for (const g of G.grenadePool) {
    if (!g.active) continue;
    g.fuse -= dt;
    g.vel.y -= 14 * dt;
    g.pos.addScaledVector(g.vel, dt);
    // Ground bounce.
    if (g.pos.y < 0.12) { g.pos.y = 0.12; g.vel.y = Math.abs(g.vel.y) * 0.45; g.vel.x *= 0.7; g.vel.z *= 0.7; G.audio.bounce(); }
    // Wall bounce: push out of boxes, reflect the velocity we lost.
    const px = g.pos.x, pz = g.pos.z;
    const p = { x: g.pos.x, z: g.pos.z };
    if (collideCircle(p, 0.12, G.world.colliders)) {
      if (Math.abs(p.x - px) > 1e-6) g.vel.x = -g.vel.x * 0.4;
      if (Math.abs(p.z - pz) > 1e-6) g.vel.z = -g.vel.z * 0.4;
      g.pos.x = p.x; g.pos.z = p.z;
      G.audio.bounce();
    }
    g.mesh.position.copy(g.pos);
    if (g.fuse <= 0) explodeGrenade(G, g);
  }
}

export function explodeGrenade(G, g) {
  g.active = false;
  g.mesh.visible = false;
  G.audio.explosion();
  G.flashExplosion(g.pos);
  for (const f of G.fighters) {
    if (!f.alive) continue;
    const d = Math.hypot(f.pos.x - g.pos.x, f.pos.z - g.pos.z);
    if (d < 4.5) {
      const dmg = Math.round(80 - (d / 4.5) * 60);
      damageFighter(G, f, dmg, g.owner, 'body', f.pos);
    }
  }
  G.onNoise(g.pos.x, g.pos.z, 30, null);
}
