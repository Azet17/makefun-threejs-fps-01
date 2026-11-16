// Keyboard + mouse + pointer lock. One job: turn DOM events into a plain
// per-frame input state the sim reads. No game logic here.
export class Input {
  constructor(canvas, onLockChange) {
    this.keys = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.fireHeld = false; this.firePressed = false;
    this.rmbHeld = false;
    this.pressed = new Set(); // keys pressed this frame (edge-triggered)
    this.locked = false;
    this.canvas = canvas;
    this.onLockChange = onLockChange || (() => {});
    this._down = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    };
    this._up = (e) => this.keys.delete(e.code);
    this._blur = () => { this.keys.clear(); this.fireHeld = false; this.rmbHeld = false; };
    this._move = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._mdown = (e) => {
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.fireHeld = true; this.firePressed = true; }
      if (e.button === 2) this.rmbHeld = true;
    };
    this._mup = (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.rmbHeld = false;
    };
    this._lock = () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange(this.locked);
    };
    this._ctx = (e) => e.preventDefault();
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    window.addEventListener('blur', this._blur);
    document.addEventListener('mousemove', this._move);
    canvas.addEventListener('mousedown', this._mdown);
    window.addEventListener('mouseup', this._mup);
    document.addEventListener('pointerlockchange', this._lock);
    canvas.addEventListener('contextmenu', this._ctx);
  }

  requestLock() {
    try {
      const r = this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch { /* headless: no lock */ }
  }

  get down() { return this.keys.has('KeyW') || this.keys.has('ArrowUp'); }
  get back() { return this.keys.has('KeyS') || this.keys.has('ArrowDown'); }
  get left() { return this.keys.has('KeyA') || this.keys.has('ArrowLeft'); }
  get right() { return this.keys.has('KeyD') || this.keys.has('ArrowRight'); }
  get jump() { return this.keys.has('Space'); }
  get crouch() { return this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC'); }
  get walk() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }
  get scope() { return this.rmbHeld; }

  // Edge-triggered: true once, the frame the key went down.
  wasPressed(code) { return this.pressed.has(code); }

  // Called at the end of each sim step: consume edges + mouse deltas.
  endStep() {
    this.pressed.clear();
    this.mouseDX = 0; this.mouseDY = 0;
    this.firePressed = false;
  }
}
