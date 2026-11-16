// Bots: 4 Vanguard teammates + 5 Sentinel defenders. Waypoint routing, FOV +
// line-of-sight perception, hearing, burst fire with aim error, bomb rotate /
// plant / defuse. One job: bot brains. Movement + shooting reuse player code.
import * as THREE from 'three';
import { collideCircle, losClear, nearestWaypoint, findPath, MAP } from './world.js';
import { tryFire, startReload, WEAPONS } from './weapons.js';

export const BOT_NAMES = {
  v: ['Rook', 'Havoc', 'Mira', 'Sable'],
  s: ['Bastion', 'Warden', 'Ferro', 'Grit', 'Latch'],
};
const TEAM_COLOR = { v: 0xf0a830, s: 0x2fb3a3 };
const BOT_SPEED = 3.3;
const EYE = 1.5;

const _boxGeo = new THREE.BoxGeometry(1, 1, 1);
const _mats = {};
function botMat(color) {
  if (!_mats[color]) _mats[color] = new THREE.MeshLambertMaterial({ color });
  return _mats[color];
}

export function makeBotMesh(team) {
  const g = new THREE.Group();
  const color = TEAM_COLOR[team];
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });
  const body = new THREE.Mesh(_boxGeo, botMat(color));
  body.scale.set(0.52, 0.62, 0.3);
  body.position.y = 0.95;
  body.userData.part = 'body';
  const head = new THREE.Mesh(_boxGeo, botMat(color));
  head.scale.set(0.34, 0.34, 0.34);
  head.position.y = 1.5;
  head.userData.part = 'head';
  const visor = new THREE.Mesh(_boxGeo, dark);
  visor.scale.set(0.3, 0.1, 0.05);
  visor.position.set(0, 1.52, -0.17);
  const legs = new THREE.Mesh(_boxGeo, dark);
  legs.scale.set(0.44, 0.62, 0.26);
  legs.position.y = 0.31;
  legs.userData.part = 'body';
  const gun = new THREE.Mesh(_boxGeo, dark);
  gun.scale.set(0.09, 0.09, 0.7);
  gun.position.set(0.2, 1.15, -0.3);
  g.add(body, head, visor, legs, gun);
  g.userData.head = head;
  return { group: g, hitMeshes: [body, head, legs] };
}

export function makeBot(G, team, name, idx) {
  const { group, hitMeshes } = makeBotMesh(team);
  G.scene.add(group);
  const f = {
    id: `${team}${idx}`, name, team, isPlayer: false, isBot: true,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, eyeH: EYE, hp: 100, armor: 0, alive: true,
    radius: 0.4, speed: 0, grounded: true, crouching: false,
    weapon: 'rifle', weapons: { pistol: { mag: 12, reserve: Infinity }, rifle: { mag: 30, reserve: 90 } },
    grenades: 0, bloom: 0, lastShot: -9, reloading: false, reloadEnd: 0, scoped: false,
    mesh: group, hitMeshes, hasBomb: false,
    bot: {
      state: 'route', path: [], pathIdx: 0, target: null,
      lastSeenPos: null, lastSeenAt: -99, think: G.rng.range(0, 0.2),
      burstLeft: 0, burstPause: 0, aimErr: 0.4, site: 'A',
      holdWp: 0, holdYaw: 0, hear: null, channel: 0, channelKind: null,
      stuck: 0, lastX: 0, lastZ: 0,
    },
  };
  for (const m of hitMeshes) m.userData.fighter = f;
  return f;
}

// ---- round setup ----

export function resetBotsForRound(G) {
  const rng = G.rng;
  const planSite = rng.chance(0.5) ? 'A' : 'B';
  for (const f of G.fighters) {
    if (f.isPlayer) continue;
    const b = f.bot;
    const spawn = MAP.spawns[f.team === 'v' ? 'vanguard' : 'sentinel'][Number(f.id.slice(1)) % 5];
    f.pos.set(spawn.x, 0, spawn.z);
    f.vel.set(0, 0, 0);
    f.hp = 100; f.armor = 0; f.alive = true;
    f.weapon = 'rifle';
    f.hasBomb = false;
    f.weapons = { pistol: { mag: 12, reserve: Infinity }, rifle: { mag: 30, reserve: 90 } };
    f.grenades = 0; f.bloom = 0; f.reloading = false;
    f.mesh.visible = true;
    b.state = 'route'; b.path = []; b.pathIdx = 0; b.target = null;
    b.lastSeenPos = null; b.lastSeenAt = -99; b.think = rng.range(0, 0.2);
    b.burstLeft = 0; b.burstPause = 0; b.channel = 0; b.channelKind = null;
    b.hear = null; b.stuck = 0;
    b.site = f.team === 'v' ? planSite : (rng.chance(0.5) ? 'A' : 'B');
    if (f.team === 'v') {
      // Vanguard: route to the planned site via the matching lane.
      const goal = MAP.sites[b.site];
      const from = nearestWaypoint(f.pos.x, f.pos.z);
      const to = nearestWaypoint(goal.x, goal.z);
      b.path = findPath(G.graph, from, to);
      b.pathIdx = 0;
      f.yaw = f.pos.z > 0 ? 0 : Math.PI; // Vanguard face north, Sentinel face south
    } else {
      // Sentinel: hold a site/mid angle.
      const hold = MAP.holds[Number(f.id.slice(1)) % MAP.holds.length];
      b.holdWp = hold.wp; b.holdYaw = hold.yaw;
      const wp = MAP.waypoints[hold.wp];
      f.pos.set(wp.x + rng.range(-1, 1), 0, wp.z + rng.range(-1, 1));
      f.yaw = hold.yaw;
      b.state = 'hold';
    }
    f.mesh.position.copy(f.pos);
    f.mesh.rotation.y = f.yaw;
  }
}

// ---- perception ----

function canSee(G, bot, enemy) {
  const dx = enemy.pos.x - bot.pos.x;
  const dz = enemy.pos.z - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > 45) return false;
  // FOV 100°: forward is (-sin yaw, -cos yaw).
  const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
  if ((dx * fx + dz * fz) / Math.max(d, 0.01) < 0.35 && d > 3) return false;
  const eyeY = bot.pos.y + EYE;
  return losClear(bot.pos.x, bot.pos.z, enemy.pos.x, enemy.pos.z, G.world.colliders, eyeY);
}

function think(G, f, dt) {
  const b = f.bot;
  b.think -= dt;
  if (b.think > 0) return;
  b.think = 0.12 + G.rng.next() * 0.1;
  // Pick the nearest visible enemy.
  let best = null, bd = Infinity;
  for (const e of G.fighters) {
    if (!e.alive || e.team === f.team) continue;
    const d = Math.hypot(e.pos.x - f.pos.x, e.pos.z - f.pos.z);
    if (d < bd && canSee(G, f, e)) { best = e; bd = d; }
  }
  if (best) {
    b.target = best;
    b.lastSeenPos = { x: best.pos.x, z: best.pos.z };
    b.lastSeenAt = G.time;
    b.state = 'engage';
    // Aim error scales with distance + target speed.
    b.aimErr = 0.25 + bd * 0.012 + best.speed * 0.06;
  } else if (b.target) {
    // Lost sight: keep last known spot briefly, then resume route/hold.
    if (G.time - b.lastSeenAt > 2.5) {
      b.target = null;
      if (G.bomb.planted) b.state = 'rotate'; // bomb down: both teams converge on the site
      else if (f.team === 'v') b.state = 'route';
      else b.state = 'hold';
    }
  }
  // Hearing: investigate a recent noise when idle.
  if (!b.target && b.hear && G.time - b.hear.t < 3 && (b.state === 'hold' || b.state === 'route')) {
    const from = nearestWaypoint(f.pos.x, f.pos.z);
    const to = nearestWaypoint(b.hear.x, b.hear.z);
    b.path = findPath(G.graph, from, to);
    b.pathIdx = 0;
    b.state = 'route';
    b.hear = null;
  }
}

// ---- movement ----

function moveAlongPath(G, f, dt) {
  const b = f.bot;
  if (b.pathIdx >= b.path.length) return true;
  const wp = b.path[b.pathIdx];
  const dx = wp.x - f.pos.x, dz = wp.z - f.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.9) { b.pathIdx++; return b.pathIdx >= b.path.length; }
  const sp = BOT_SPEED;
  f.vel.x = (dx / d) * sp;
  f.vel.z = (dz / d) * sp;
  f.pos.x += f.vel.x * dt;
  f.pos.z += f.vel.z * dt;
  f.yaw = Math.atan2(-dx, -dz);
  f.speed = sp;
  return false;
}

function stepMovement(G, f, dt) {
  const b = f.bot;
  f.speed = 0;
  if (b.state === 'route') {
    const arrived = moveAlongPath(G, f, dt);
    if (arrived) {
      if (f.team === 'v' && f.hasBomb && !G.bomb.planted && G.phase === 'live') {
        b.state = 'plant';
      } else if (f.team === 's' && G.bomb.planted) {
        b.state = 'defuse-approach';
      } else if (f.team === 'v') {
        // Reached the site: hold the angle, wait for the plant or the fight.
        b.state = 'hold-site';
        b.holdYaw = f.yaw;
      } else {
        b.state = 'hold';
      }
    }
  } else if (b.state === 'rotate' || b.state === 'defuse-approach') {
    // Move to the planted site.
    const site = MAP.sites[G.bomb.site];
    const from = nearestWaypoint(f.pos.x, f.pos.z);
    const to = nearestWaypoint(site.x, site.z);
    if (!b.path.length || b.pathIdx >= b.path.length) { b.path = findPath(G.graph, from, to); b.pathIdx = 0; }
    const arrived = moveAlongPath(G, f, dt);
    if (arrived) b.state = 'defuse';
  } else if (b.state === 'hold') {
    // Drift back to the hold spot, face the hold yaw.
    const wp = MAP.waypoints[b.holdWp];
    const dx = wp.x - f.pos.x, dz = wp.z - f.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.2) {
      f.vel.x = (dx / d) * BOT_SPEED * 0.6;
      f.vel.z = (dz / d) * BOT_SPEED * 0.6;
      f.pos.x += f.vel.x * dt; f.pos.z += f.vel.z * dt;
      f.speed = BOT_SPEED * 0.6;
    }
    f.yaw += (b.holdYaw - f.yaw) * Math.min(1, dt * 3);
  } else if (b.state === 'hold-site') {
    f.yaw += (b.holdYaw - f.yaw) * Math.min(1, dt * 2);
  }
  // Stuck detection: if barely moved while routing, re-path once.
  const moved = Math.hypot(f.pos.x - b.lastX, f.pos.z - b.lastZ);
  if (b.state === 'route' && f.speed > 0 && moved < 0.02) {
    b.stuck += dt;
    if (b.stuck > 1.2) {
      b.stuck = 0;
      const from = nearestWaypoint(f.pos.x, f.pos.z);
      const goal = MAP.sites[b.site];
      b.path = findPath(G.graph, from, nearestWaypoint(goal.x, goal.z));
      b.pathIdx = 0;
    }
  } else b.stuck = 0;
  b.lastX = f.pos.x; b.lastZ = f.pos.z;
  collideCircle(f.pos, f.radius, G.world.colliders);
  f.mesh.position.copy(f.pos);
  f.mesh.rotation.y = f.yaw;
}

// ---- combat ----

function aimAt(G, f, tx, ty, tz, err) {
  const dx = tx - f.pos.x, dy = ty - (f.pos.y + EYE), dz = tz - f.pos.z;
  const d = Math.hypot(dx, dz);
  const wantYaw = Math.atan2(-dx, -dz);
  const wantPitch = Math.atan2(dy, Math.max(d, 0.01));
  const e = err * (0.5 + G.rng.next());
  f.yaw = wantYaw + (G.rng.next() - 0.5) * e * 0.4;
  f.pitch = Math.max(-1.2, Math.min(1.2, wantPitch + (G.rng.next() - 0.5) * e * 0.4));
}

function stepCombat(G, f, dt) {
  const b = f.bot;
  if (!b.target || !b.target.alive) { b.target = null; return; }
  const t = b.target;
  const d = Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z);
  // Face the target; strafe a little while engaging.
  const ty = t.pos.y + (t.crouching ? 1.1 : 1.35);
  aimAt(G, f, t.pos.x, ty, t.pos.z, b.aimErr);
  // Burst fire with pauses — human-like, not an aimbot.
  if (b.burstPause > 0) { b.burstPause -= dt; return; }
  if (b.burstLeft <= 0) {
    if (d > 45) return; // out of effective range: close in instead
    b.burstLeft = 3 + Math.floor(G.rng.next() * 3);
    b.burstPause = 0.05;
    return;
  }
  const w = WEAPONS[f.weapon];
  if (G.time - f.lastShot >= w.rate) {
    const res = tryFire(G, f, G.time);
    if (res === 'shot') b.burstLeft -= 1;
    else if (res === 'dry') startReload(G, f);
  }
  if (b.burstLeft <= 0) b.burstPause = 0.45 + G.rng.next() * 0.6;
  // Close distance when the target is far.
  if (d > 26 && b.state === 'engage') {
    const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z;
    f.pos.x += (dx / d) * BOT_SPEED * 0.7 * dt;
    f.pos.z += (dz / d) * BOT_SPEED * 0.7 * dt;
    f.speed = BOT_SPEED * 0.7;
    collideCircle(f.pos, f.radius, G.world.colliders);
    f.mesh.position.copy(f.pos);
  }
}

// ---- bomb channels ----

function stepChannel(G, f, dt) {
  const b = f.bot;
  if (b.state === 'plant' && f.hasBomb && !G.bomb.planted) {
    const site = MAP.sites[b.site];
    const d = Math.hypot(f.pos.x - site.x, f.pos.z - site.z);
    if (d > site.r) { b.state = 'route'; b.channel = 0; return; }
    b.channel += dt;
    if (b.channel >= 3.5) {
      G.plantBomb(b.site, f);
      b.channel = 0;
      b.state = 'hold-site';
    }
  } else if (b.state === 'defuse' && G.bomb.planted) {
    const site = MAP.sites[G.bomb.site];
    const d = Math.hypot(f.pos.x - site.x, f.pos.z - site.z);
    // Out of the site ring: walk back in. A Vanguard nearby no longer cancels
    // the defuse outright — the old 12 m check made defuse impossible whenever
    // anyone defended the site, so the bomb always detonated. If the defuser
    // can actually see an enemy, think() switches it to 'engage' and the
    // channel resets there instead.
    if (d > site.r) { b.channel = 0; b.state = 'rotate'; return; }
    b.channel += dt;
    if (b.channel >= 5) {
      G.defuseBomb(f);
      b.channel = 0;
    }
  } else b.channel = 0;
}

// ---- main step ----

export function stepBots(G, dt) {
  for (const f of G.fighters) {
    if (!f.isBot || !f.alive) continue;
    if (G.phase !== 'live') {
      f.mesh.position.copy(f.pos);
      continue;
    }
    think(G, f, dt);
    stepChannel(G, f, dt);
    if (f.bot.state === 'plant' || f.bot.state === 'defuse') {
      f.speed = 0;
      f.mesh.position.copy(f.pos);
      f.mesh.rotation.y = f.yaw;
      continue; // channelling: stand still
    }
    stepMovement(G, f, dt);
    stepCombat(G, f, dt);
    // Reload when the mag is dry and no target.
    const slot = f.weapons[f.weapon];
    if (slot.mag === 0 && !f.reloading) startReload(G, f);
    if (f.reloading && G.time >= f.reloadEnd) {
      const w = WEAPONS[f.weapon];
      const need = w.mag - slot.mag;
      const take = slot.reserve === Infinity ? need : Math.min(need, slot.reserve);
      slot.mag += take;
      if (slot.reserve !== Infinity) slot.reserve -= take;
      f.reloading = false;
    }
  }
  // Separation: keep fighters from standing inside each other.
  const fs = G.fighters;
  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      const a = fs[i], c = fs[j];
      if (!a.alive || !c.alive) continue;
      const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.85 && d > 1e-4) {
        const push = (0.85 - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        c.pos.x += nx * push; c.pos.z += nz * push;
      }
    }
  }
}

// Noise event: bots in radius investigate (unless already engaging).
export function hearNoise(G, x, z, radius, source) {
  for (const f of G.fighters) {
    if (!f.isBot || !f.alive || f === source) continue;
    const d = Math.hypot(f.pos.x - x, f.pos.z - z);
    if (d < radius && !f.bot.target) f.bot.hear = { x, z, t: G.time };
  }
}
