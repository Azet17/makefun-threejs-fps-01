// FERRO YARD — round-based tactical FPS. One Game object holds all sim state;
// rendering reads it, never the other way round. Fixed 60 Hz timestep.
import * as THREE from 'three';
import { buildWorld, buildGraph, MAP } from './world.js';
import { makeRng } from './rng.js';
import { AudioFX } from './audio.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Economy } from './economy.js';
import { stepPlayer } from './player.js';
import { makeBot, resetBotsForRound, stepBots, hearNoise, BOT_NAMES } from './bots.js';
import { WEAPONS, freshLoadout, tryFire, startReload, finishReload, switchWeapon, throwGrenade, updateGrenades } from './weapons.js';

const STEP = 1 / 60;
const ROUND_TIME = 100;
const BUY_TIME = 15;
const PLANT_TIME = 3.5;
const DETONATE_TIME = 35;
const DEFUSE_TIME = 5;
const WIN_ROUNDS = 8;
const MAX_ROUNDS = 15;

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') || '1') || 1;
const SHOT = params.get('shot') || '';

function makeFighter(G, isPlayer, name, team) {
  return {
    id: isPlayer ? 'you' : name, name, team, isPlayer, isBot: false,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, eyeH: 1.62, hp: 100, armor: 0, alive: true,
    radius: 0.4, speed: 0, grounded: true, crouching: false,
    weapon: 'pistol', weapons: freshLoadout(), grenades: 0,
    bloom: 0, lastShot: -9, reloading: false, reloadEnd: 0, scoped: false,
    mesh: null, hitMeshes: [], hasBomb: false, lastHitBy: null, lastHitPart: null,
    bot: null,
  };
}

class Game {
  constructor() {
    this.rng = makeRng(SEED);
    this.time = 0;
    this.audio = new AudioFX();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 220);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    document.getElementById('game').appendChild(this.renderer.domElement);

    this.world = buildWorld(this.scene);
    this.graph = buildGraph(this.world.colliders);
    this.economy = new Economy(this);
    this.hud = new Hud(this);
    this.input = new Input(this.renderer.domElement, () => {});
    this.score = { v: 0, s: 0 };
    this.round = 1;
    this.phase = 'menu';
    this.phaseTimeLeft = 0;
    this.bomb = { planted: false, site: 'A', detonateAt: 0, carrier: null, pos: null };
    this.playerDied = false;
    this.hintText = '';
    this.progress = null;
    this.buyOpen = false;
    this.matchWinner = null;

    // Fighters: the player + 4 Vanguard bots + 5 Sentinel bots.
    this.player = makeFighter(this, true, 'You', 'v');
    this.fighters = [this.player];
    BOT_NAMES.v.forEach((n, i) => this.fighters.push(makeBot(this, 'v', n, i)));
    BOT_NAMES.s.forEach((n, i) => this.fighters.push(makeBot(this, 's', n, i)));

    // Tracers: pooled lines, reused, never allocated per shot.
    this.tracers = [];
    const tracerGeo = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      return g;
    };
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.LineBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0 });
      const line = new THREE.Line(tracerGeo(), mat);
      line.visible = false; line.frustumCulled = false;
      this.scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this._tracerIdx = 0;

    // Grenades: pooled meshes.
    this.grenadePool = [];
    const gGeo = new THREE.SphereGeometry(0.12, 10, 8);
    const gMat = new THREE.MeshLambertMaterial({ color: 0x2a2d31 });
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(gGeo, gMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.grenadePool.push({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, owner: null, mesh });
    }
    // Explosion flash light (reused).
    this.boomLight = new THREE.PointLight(0xff8c2a, 0, 30, 1.6);
    this.scene.add(this.boomLight);
    this.boomLife = 0;

    // Bomb prop: small blinking box, hidden until planted.
    this.bombMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.3, 0.35),
      new THREE.MeshLambertMaterial({ color: 0xe0533d, emissive: 0x881111 }),
    );
    this.bombMesh.visible = false;
    this.scene.add(this.bombMesh);

    this._plantProgress = 0;
    this._acc = 0;
    this._last = performance.now();
    this._shotStaged = false;

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    document.getElementById('play').addEventListener('click', () => {
      this.audio.ensure();
      if (this.phase === 'menu') this.startMatch();
      else if (this.phase === 'matchEnd') this.resetMatch();
    });
    document.addEventListener('visibilitychange', () => { this._last = performance.now(); });
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ---- match / round flow ----

  startMatch() {
    this.hud.hideOverlay();
    this.hud.show();
    // No pointer lock here: the buy menu is open and must stay clickable.
    // The first click on the canvas locks the mouse (see Input).
    this.score = { v: 0, s: 0 };
    this.round = 1;
    this.economy.reset();
    this.player.weapons = freshLoadout();
    this.player.weapon = 'pistol';
    this.player.grenades = 0;
    this.player.armor = 0;
    this.startRound();
  }

  resetMatch() { this.startMatch(); }

  startRound() {
    const p = this.player;
    const spawn = MAP.spawns.vanguard[2];
    p.pos.set(spawn.x, 0, spawn.z);
    p.vel.set(0, 0, 0);
    p.yaw = 0; // face north, toward mid
    p.pitch = 0;
    p.hp = 100; p.alive = true; p.reloading = false; p.scoped = false;
    p.hasBomb = true;
    this.bomb = { planted: false, site: 'A', detonateAt: 0, carrier: p, pos: null };
    this.bombMesh.visible = false;
    this.playerDied = false;
    this._plantProgress = 0;
    this.progress = null;
    resetBotsForRound(this);
    // A random Vanguard bot also carries a spare plan: if the player dies,
    // the bomb passes to a living teammate (handled in killFighter path).
    this.phase = 'buy';
    this.phaseTimeLeft = BUY_TIME;
    this.buyOpen = true;
    this.hud.setBuy(true, this);
    this.hud.banner(`ROUND ${this.round}`, 'Buy phase — press [B] to close the shop', '');
  }

  endRound(winner, reason) {
    if (this.phase !== 'live') return;
    this.phase = 'roundEnd';
    this.phaseTimeLeft = 4;
    this.score[winner] += 1;
    const won = winner === 'v';
    this.economy.roundEnd(won);
    this.buyOpen = false;
    this.hud.setBuy(false, this);
    this.player.scoped = false;
    this.hud.setScoped(false);
    if (won) { this.audio.roundWin(); this.hud.banner('ROUND WON', reason, 'win'); }
    else { this.audio.roundLose(); this.hud.banner('ROUND LOST', reason, 'lose'); }
    // Bomb visual stays where it was planted until the next round.
  }

  endMatch() {
    this.phase = 'matchEnd';
    const won = this.score.v > this.score.s;
    const title = document.getElementById('overlay-title');
    const copy = document.getElementById('overlay-copy');
    const btn = document.getElementById('play');
    title.innerHTML = won ? '<span class="fy">YARD TAKEN</span>' : 'YARD HELD';
    copy.textContent = won
      ? `Vanguard takes Ferro Yard ${this.score.v}–${this.score.s}. The yard is yours — play again to defend it.`
      : `Sentinel holds Ferro Yard ${this.score.s}–${this.score.v}. Regroup and run it back.`;
    btn.textContent = 'Play again';
    this.hud.showOverlay();
    document.exitPointerLock?.();
  }

  // ---- bomb ----

  plantBomb(site, byFighter) {
    this.bomb.planted = true;
    this.bomb.site = site;
    this.bomb.detonateAt = this.time + DETONATE_TIME;
    const s = MAP.sites[site];
    this.bomb.pos = { x: s.x, z: s.z };
    this.bombMesh.position.set(s.x, 0.2, s.z);
    this.bombMesh.visible = true;
    this.audio.planted();
    this.hud.banner('BOMB PLANTED', `Site ${site} — detonation in ${DETONATE_TIME}s`, '');
    // Every Sentinel rotates to the site.
    for (const f of this.fighters) {
      if (f.isBot && f.team === 's' && f.alive) {
        f.bot.state = 'rotate';
        f.bot.path = []; f.bot.pathIdx = 0;
      }
    }
  }

  defuseBomb(byFighter) {
    this.bomb.planted = false;
    this.bombMesh.visible = false;
    this.audio.defuseBeep();
    this.endRound('s', `Bomb defused by ${byFighter.name}`);
  }

  detonateBomb() {
    this.boomLife = 1;
    this.boomLight.position.set(this.bomb.pos.x, 2, this.bomb.pos.z);
    this.audio.explosion();
    this.bombMesh.visible = false;
    // Blast kills anyone near the site.
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.pos.x - this.bomb.pos.x, f.pos.z - this.bomb.pos.z);
      if (d < 8) {
        f.hp = 0; f.alive = false;
        if (f.mesh) f.mesh.visible = false;
      }
    }
    this.endRound('v', 'Bomb detonated — site destroyed');
  }

  // ---- shared helpers used by weapons/bots ----

  onNoise(x, z, radius, source) { hearNoise(this, x, z, radius, source); }

  addKillfeed(attacker, target, headshot) {
    const cls = (f) => (f.team === 'v' ? 'v' : 's');
    const nm = (f) => f.isPlayer ? 'You' : f.name;
    this.hud.killfeedAdd(
      `<span class="${cls(attacker)}">${nm(attacker)}</span> <b>${headshot ? '☠ HEADSHOT ' : ''}▸</b> <span class="${cls(target)}">${nm(target)}</span>`,
    );
  }

  spawnTracer(origin, end, team) {
    const t = this.tracers[this._tracerIdx++ % this.tracers.length];
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = origin.x; pos[1] = origin.y; pos[2] = origin.z;
    pos[3] = end.x; pos[4] = end.y; pos[5] = end.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(team === 'v' ? 0xffc46b : 0x7fe0d4);
    t.line.material.opacity = 0.9;
    t.line.visible = true;
    t.life = 0.08;
  }

  flashExplosion(pos) {
    this.boomLife = 1;
    this.boomLight.position.set(pos.x, 1.5, pos.z);
  }

  bombText() {
    if (this.bomb.planted) {
      const t = Math.max(0, this.bomb.detonateAt - this.time);
      return `💣 BOMB PLANTED — SITE ${this.bomb.site} · ${t.toFixed(0)}s`;
    }
    if (this.phase === 'live' && this.player.alive && this.player.hasBomb) return '💣 YOU CARRY THE BOMB — plant at A or B [E]';
    if (this.phase === 'live') {
      const c = this.bomb.carrier;
      return c && c.alive ? `💣 BOMB WITH ${c.isPlayer ? 'YOU' : c.name.toUpperCase()}` : '💣 BOMB DROPPED';
    }
    return '';
  }

  tryBuy(id) {
    if (this.economy.buy(this.player, id)) {
      this.hud.renderShop(this);
      if (id === 'rifle' || id === 'smg' || id === 'sniper') switchWeapon(this, this.player, id);
    } else this.audio.denied();
  }

  // ---- per-step sim ----

  step(dt) {
    this.time += dt;
    const p = this.player;
    const input = this.input;

    // Phase timers.
    if (this.phase === 'buy') {
      this.phaseTimeLeft -= dt;
      this.hud.setBuyTimer(this.phaseTimeLeft);
      if (this.phaseTimeLeft <= 0) {
        this.phase = 'live';
        this.phaseTimeLeft = ROUND_TIME;
        this.buyOpen = false;
        this.hud.setBuy(false, this);
        this.hud.banner(`ROUND ${this.round} — GO`, 'Plant the bomb on A or B', '');
      }
    } else if (this.phase === 'live') {
      this.phaseTimeLeft -= dt;
      if (this.bomb.planted && this.time >= this.bomb.detonateAt) this.detonateBomb();
      if (this.phase === 'live' && this.phaseTimeLeft <= 0 && !this.bomb.planted) {
        this.endRound('s', 'Time expired — Sentinel holds the yard');
      }
    } else if (this.phase === 'roundEnd') {
      this.phaseTimeLeft -= dt;
      if (this.phaseTimeLeft <= 0) {
        if (this.score.v >= WIN_ROUNDS || this.score.s >= WIN_ROUNDS || this.round >= MAX_ROUNDS) this.endMatch();
        else { this.round += 1; this.startRound(); }
      }
    }

    if (this.phase === 'live' || this.phase === 'buy') {
      // Buy menu toggle (buy phase only).
      if (input.wasPressed('KeyB') && this.phase === 'buy') {
        this.buyOpen = !this.buyOpen;
        this.hud.setBuy(this.buyOpen, this);
        if (this.buyOpen) this.hud.renderShop(this);
      }
      if (input.wasPressed('Escape') && this.buyOpen) {
        this.buyOpen = false;
        this.hud.setBuy(false, this);
      }
      // Buy hotkeys 1-6 while the shop is open.
      if (this.buyOpen && this.phase === 'buy') {
        const items = this.economy.catalogue(p);
        for (const it of items) {
          if (input.wasPressed('Digit' + it.key)) this.tryBuy(it.id);
        }
      }
      // Weapon switching.
      const slotKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
      const slotIds = ['pistol', 'rifle', 'smg', 'sniper'];
      for (let i = 0; i < 4; i++) {
        if (input.wasPressed(slotKeys[i]) && !this.buyOpen) switchWeapon(this, p, slotIds[i]);
      }
      // Firing, reload, grenade, scope: live phase only (freeze time = no fire).
      if (p.alive && this.phase === 'live') {
        const w = WEAPONS[p.weapon];
        if ((w.auto && input.fireHeld) || (!w.auto && input.firePressed)) tryFire(this, p, this.time);
        if (input.wasPressed('KeyR')) startReload(this, p);
        if (input.wasPressed('KeyG')) throwGrenade(this, p);
        p.scoped = input.rmbHeld && p.weapon === 'sniper' && !p.reloading;
        this.hud.setScoped(p.scoped);
      }
      if (p.reloading && this.time >= p.reloadEnd) finishReload(this, p);

      // Plant channel: hold E inside a site while carrying the bomb.
      this.progress = null;
      this.hintText = '';
      if (this.phase === 'live' && p.alive && p.hasBomb && !this.bomb.planted) {
        for (const key of ['A', 'B']) {
          const s = MAP.sites[key];
          if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < s.r) {
            this.hintText = `Hold [E] to plant the bomb — ${s.name}`;
            if (input.keys.has('KeyE')) {
              this._plantProgress += dt;
              this.progress = { label: 'PLANTING BOMB…', frac: this._plantProgress / PLANT_TIME };
              if (this._plantProgress >= PLANT_TIME) {
                this.plantBomb(key, p);
                this._plantProgress = 0;
              }
            } else this._plantProgress = 0;
            break;
          }
        }
      }
      if (this.phase === 'buy') this.hintText = 'Buy phase — [B] shop · round starts soon';
      else if (this.phase === 'live' && !input.locked && p.alive && !this.hintText) {
        this.hintText = 'Click to lock the mouse — WASD to move';
      }

      stepPlayer(this, p, input, dt);
      stepBots(this, dt);
      updateGrenades(this, dt);

      // Round end by elimination.
      if (this.phase === 'live') {
        const vAlive = this.fighters.some((f) => f.alive && f.team === 'v');
        const sAlive = this.fighters.some((f) => f.alive && f.team === 's');
        if (!sAlive) this.endRound('v', 'Sentinel team eliminated');
        else if (!vAlive) this.endRound('s', 'Vanguard team eliminated');
      }
      // Bomb carrier died: pass the bomb to a living Vanguard bot.
      if (this.playerDied && this.bomb.carrier === p && !this.bomb.planted) {
        this.playerDied = false;
        const mate = this.fighters.find((f) => f.isBot && f.alive && f.team === 'v');
        if (mate) {
          mate.hasBomb = true;
          this.bomb.carrier = mate;
          mate.bot.site = this.rng.chance(0.5) ? 'A' : 'B';
          mate.bot.state = 'route';
          mate.bot.path = [];
          mate.bot.pathIdx = 0;
          this.hud.killfeedAdd(`<span class="v">${mate.name}</span> <b>picked up the bomb</b>`);
        }
      }
    }

    // Tracers + explosion light decay (visual only).
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.9;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    if (this.boomLife > 0) {
      this.boomLife = Math.max(0, this.boomLife - dt * 1.4);
      this.boomLight.intensity = this.boomLife * 90;
    }
    // Bomb blink.
    if (this.bombMesh.visible) {
      const m = this.bombMesh.material;
      m.emissiveIntensity = 0.6 + 0.6 * Math.sin(this.time * 8);
    }
    this.hud.update(this);
    input.endStep();
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    if (!SHOT) {
      this._acc += dt;
      let n = 0;
      while (this._acc >= STEP && n < 5) { this.step(STEP); this._acc -= STEP; n++; }
      if (n === 5) this._acc = 0;
    } else if (!this._shotStaged) {
      this.stageShot(SHOT);
      this._shotStaged = true;
    }
    this.renderer.render(this.scene, this.camera);
    if (SHOT && this._shotStaged && !window.__shotReady) {
      // One rendered frame after staging: the shot is ready.
      window.__shotReady = true;
    }
  }

  // ---- staged screenshots (?shot=1..4) ----

  stageShot(mode) {
    // Build a live round, then pose it deterministically and freeze the sim.
    this.hud.hideOverlay();
    this.hud.show();
    this.startMatch();
    this.hud.el.banner.hidden = true; // startRound's banner must not leak into the shot
    this.phase = 'live';
    this.phaseTimeLeft = 100;
    this.buyOpen = false;
    this.hud.setBuy(false, this);
    const p = this.player;
    const bots = this.fighters.filter((f) => f.isBot);
    const byId = (id) => this.fighters.find((f) => f.id === id);
    const place = (f, x, z, yaw) => {
      f.pos.set(x, 0, z); f.yaw = yaw; f.pitch = 0;
      if (f.mesh) { f.mesh.position.copy(f.pos); f.mesh.rotation.y = yaw; }
    };
    if (mode === '1') {
      // Mid-lane firefight: player in mid, two Sentinels ahead, tracer in flight.
      place(p, 0, 10, 0);
      p.weapons.rifle = { mag: 24, reserve: 90 };
      p.weapon = 'rifle';
      this.economy.money = 4650;
      this.score = { v: 3, s: 2 };
      this.phaseTimeLeft = 72;
      place(byId('s0'), -1.5, -4, Math.PI);
      place(byId('s1'), 2.5, -9, Math.PI);
      place(byId('v0'), -2.5, 8, 0);
      place(byId('s2'), 6, -14, 2.8);
      this.spawnTracer(new THREE.Vector3(0.2, 1.5, 9.4), new THREE.Vector3(-1.5, 1.4, -4), 'v');
      this.hud.showHitmarker(false);
      this.addKillfeed(byId('v0'), byId('s3'), true);
      this.addKillfeed(byId('s1'), byId('v1'), false);
    } else if (mode === '2') {
      // Buy menu at round start.
      this.phase = 'buy';
      this.phaseTimeLeft = 12;
      this.round = 4;
      this.score = { v: 2, s: 1 };
      this.economy.money = 4650;
      place(p, 0, 26, 0);
      p.weapons.rifle = { mag: 30, reserve: 90 };
      p.weapon = 'rifle';
      place(byId('v0'), -3, 24, 0);
      place(byId('v1'), 3, 24, 0);
      this.buyOpen = true;
      this.hud.setBuy(true, this);
      this.hud.setBuyTimer(12);
    } else if (mode === '3') {
      // Bomb planted at A, a Sentinel defusing, timer running.
      place(p, -9, -12, 0.67); // face the A site
      p.weapons.rifle = { mag: 18, reserve: 60 };
      p.weapon = 'rifle';
      this.score = { v: 4, s: 4 };
      this.round = 9;
      this.bomb.planted = true;
      this.bomb.site = 'A';
      this.bomb.detonateAt = this.time + 31;
      this.bomb.pos = { x: MAP.sites.A.x, z: MAP.sites.A.z };
      this.bombMesh.position.set(MAP.sites.A.x, 0.2, MAP.sites.A.z);
      this.bombMesh.visible = true;
      this.phaseTimeLeft = 31;
      place(byId('s0'), -13.5, -18, Math.PI * 0.25);
      place(byId('s1'), -16, -22, -2.53);
      place(byId('v0'), -11, -14, 0.67);
      this.progress = { label: 'DEFUSING…', frac: 0.45 };
      this.addKillfeed(byId('v0'), byId('s2'), false);
    } else if (mode === '4') {
      // Round-win banner, score updated, yard behind.
      this.phase = 'roundEnd';
      this.phaseTimeLeft = 3;
      this.score = { v: 5, s: 3 };
      this.round = 8;
      place(p, 0, 8, 0); // open mid-lane view: teammates ahead, dead Sentinel beyond
      p.weapons.rifle = { mag: 30, reserve: 90 };
      p.weapon = 'rifle';
      this.economy.money = 5200;
      place(byId('v0'), -2.5, 4, 0);
      place(byId('v1'), 2.5, 4, 0);
      place(byId('s0'), 0, -6, Math.PI);
      byId('s0').alive = false; byId('s0').mesh.visible = false;
      this.hud.banner('ROUND WON', 'Sentinel team eliminated', 'win');
    }
    // Camera + HUD from the player's eyes.
    stepPlayer(this, p, { mouseDX: 0, mouseDY: 0, down: false, back: false, left: false, right: false, jump: false, crouch: false, walk: false, keys: new Set(), wasPressed: () => false, endStep: () => {} }, 0);
    this.hud.update(this);
    this.renderer.render(this.scene, this.camera);
  }

  snapshot() {
    return {
      phase: this.phase,
      round: this.round,
      score: { ...this.score },
      time: Math.round(this.time * 100) / 100,
      phaseTimeLeft: Math.round(this.phaseTimeLeft * 10) / 10,
      money: this.economy.money,
      bomb: { planted: this.bomb.planted, site: this.bomb.site },
      player: {
        hp: this.player.hp, alive: this.player.alive,
        x: +this.player.pos.x.toFixed(1), z: +this.player.pos.z.toFixed(1),
        weapon: this.player.weapon, mag: this.player.weapons[this.player.weapon].mag,
        grenades: this.player.grenades,
      },
      fighters: this.fighters.map((f) => ({
        name: f.name, team: f.team, hp: f.hp, alive: f.alive,
        x: +f.pos.x.toFixed(1), z: +f.pos.z.toFixed(1),
        state: f.bot ? f.bot.state : 'player',
      })),
    };
  }
}

const game = new Game();
window.__game = game;
window.__snapshot = () => game.snapshot();
