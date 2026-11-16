// Player movement: accel/decel, walk/crouch/jump, AABB collision, mouse look.
// The player is a fighter object; this module steps its motion each fixed tick.
import { collideCircle } from './world.js';

export const PLAYER = {
  radius: 0.4,
  eyeStand: 1.62,
  eyeCrouch: 1.1,
  walkSpeed: 4.2,
  crouchSpeed: 2.1,
  walkQuietSpeed: 2.6,
  accel: 42,
  friction: 30,
  jumpVel: 5.2,
  gravity: 14,
};

export function stepPlayer(G, f, input, dt) {
  if (!f.alive) return;
  // Mouse look.
  const sens = f.scoped ? 0.0009 : 0.0021;
  f.yaw -= input.mouseDX * sens;
  f.pitch -= input.mouseDY * sens;
  f.pitch = Math.max(-1.5, Math.min(1.5, f.pitch));

  // Crouch transitions.
  const wantCrouch = input.crouch;
  f.crouching = wantCrouch;
  const targetEye = wantCrouch ? PLAYER.eyeCrouch : PLAYER.eyeStand;
  f.eyeH += (targetEye - f.eyeH) * Math.min(1, dt * 12);

  // Wish direction from keys, in world space (yaw 0 faces -z).
  let wx = 0, wz = 0;
  if (input.down) { wx += -Math.sin(f.yaw); wz += -Math.cos(f.yaw); }
  if (input.back) { wx += Math.sin(f.yaw); wz += Math.cos(f.yaw); }
  if (input.left) { wx += -Math.cos(f.yaw); wz += Math.sin(f.yaw); }
  if (input.right) { wx += Math.cos(f.yaw); wz += -Math.sin(f.yaw); }
  const wlen = Math.hypot(wx, wz);
  if (wlen > 0) { wx /= wlen; wz /= wlen; }

  const speed = wantCrouch ? PLAYER.crouchSpeed : input.walk ? PLAYER.walkQuietSpeed : PLAYER.walkSpeed;
  f.vel.x += wx * PLAYER.accel * dt;
  f.vel.z += wz * PLAYER.accel * dt;
  // Friction when no input; clamp to max speed.
  if (wlen === 0) {
    const dec = Math.max(0, 1 - PLAYER.friction * dt / Math.max(0.01, Math.hypot(f.vel.x, f.vel.z)));
    f.vel.x *= dec; f.vel.z *= dec;
  }
  const hSpeed = Math.hypot(f.vel.x, f.vel.z);
  if (hSpeed > speed) { f.vel.x *= speed / hSpeed; f.vel.z *= speed / hSpeed; }
  f.speed = hSpeed;

  // Jump (grounded only) + gravity. No bunny-hop exploit: low air control.
  if (input.jump && f.grounded) { f.vel.y = PLAYER.jumpVel; f.grounded = false; }
  f.vel.y -= PLAYER.gravity * dt;
  f.pos.y += f.vel.y * dt;
  if (f.pos.y <= 0) { f.pos.y = 0; f.vel.y = 0; f.grounded = true; }

  // Horizontal move with AABB push-out.
  f.pos.x += f.vel.x * dt;
  f.pos.z += f.vel.z * dt;
  collideCircle(f.pos, PLAYER.radius, G.world.colliders);

  // Recoil + bloom recovery.
  f.bloom = Math.max(0, f.bloom - dt * 0.09);
  f.pitch = Math.max(-1.5, Math.min(1.5, f.pitch));

  // Camera follows the head.
  G.camera.position.set(f.pos.x, f.pos.y + f.eyeH, f.pos.z);
  G.camera.rotation.order = 'YXZ';
  G.camera.rotation.y = f.yaw;
  G.camera.rotation.x = f.pitch;
  G.camera.rotation.z = 0;
  G.camera.fov = f.scoped ? 22 : 75;
  G.camera.updateProjectionMatrix();
}
