// HUD: all DOM updates. The sim never touches document directly except
// through this module. Cheap: text updates only when the value changed.
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(G) {
    this.G = G;
    this.el = {
      hud: $('hud'), hp: $('hp'), fill: $('healthfill'), armor: $('armor'),
      mag: $('ammo-mag'), reserve: $('ammo-reserve'), ammo: $('ammo'),
      weapon: $('weapon-name'), grenades: $('grenades'),
      timer: $('timer'), score: $('scoreboard'), bomb: $('bombstatus'),
      pipsV: $('pips-v'), pipsS: $('pips-s'), money: $('money'),
      killfeed: $('killfeed'), hint: $('hint'), progress: $('progress'),
      progressLabel: $('progress-label'), progressFill: $('progressfill'),
      banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'), scope: $('scope'),
      dmgnums: $('dmgnums'), buy: $('buy'), shop: $('shop'),
      buyMoney: $('buy-money'), buyTimer: $('buy-timer'), buyRound: $('buy-round'),
      overlay: $('overlay'),
    };
    this.last = {};
    this._hitTimer = 0;
    this._dmgPool = [];
    for (let i = 0; i < 8; i++) {
      const s = document.createElement('span');
      s.style.display = 'none';
      this.el.dmgnums.appendChild(s);
      this._dmgPool.push({ el: s, life: 0 });
    }
    this._dmgIdx = 0;
  }

  _set(key, el, value) {
    if (this.last[key] !== value) { this.last[key] = value; el.textContent = value; }
  }

  show() { this.el.hud.hidden = false; }
  hideOverlay() { this.el.overlay.hidden = true; }
  showOverlay() { this.el.overlay.hidden = false; }

  update(G) {
    const p = G.player;
    const w = WEAPONS[p.weapon];
    const slot = p.weapons[p.weapon];
    this._set('hp', this.el.hp, String(Math.max(0, Math.ceil(p.hp))));
    this.el.fill.style.width = `${Math.max(0, p.hp)}%`;
    this.el.fill.classList.toggle('low', p.hp <= 30);
    this._set('armor', this.el.armor, String(p.armor));
    this._set('mag', this.el.mag, String(slot.mag));
    this._set('reserve', this.el.reserve, slot.reserve === Infinity ? ' / ∞' : ` / ${slot.reserve}`);
    this.el.ammo.classList.toggle('empty', slot.mag === 0);
    this._set('weapon', this.el.weapon, w.name + (p.reloading ? ' — RELOADING' : ''));
    this._set('grenades', this.el.grenades, `HE × ${p.grenades}  ·  [G] throw`);
    const moneyHtml = `$${G.economy.money}<small>BUY [B] · ROUND ${G.round}/15</small>`;
    if (this.last.moneyHtml !== moneyHtml) { this.last.moneyHtml = moneyHtml; this.el.money.innerHTML = moneyHtml; }
    // Timer + score.
    const t = Math.max(0, Math.ceil(G.phaseTimeLeft));
    const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
    this._set('timer', this.el.timer, `${mm}:${ss}`);
    this.el.timer.classList.toggle('planted', G.bomb.planted);
    const scoreHtml = `<b class="v">VANGUARD ${G.score.v}</b> — <b class="s">${G.score.s} SENTINEL</b>`;
    if (this.last.scoreHtml !== scoreHtml) { this.last.scoreHtml = scoreHtml; this.el.score.innerHTML = scoreHtml; }
    this._set('bomb', this.el.bomb, G.bombText());
    this._renderPips();
    // Crosshair spread gap grows with bloom + movement.
    const gap = 2 + p.bloom * 90 + (p.speed > 1.5 ? 3 : 0);
    this.el.crosshair.style.transform = `translate(-50%, -50%) scale(${1 + gap / 22})`;
    // Hint (plant/defuse prompt).
    if (G.hintText) { this.el.hint.hidden = false; this._set('hint', this.el.hint, G.hintText); }
    else this.el.hint.hidden = true;
    // Progress bar (plant/defuse).
    if (G.progress) {
      this.el.progress.hidden = false;
      this._set('plabel', this.el.progressLabel, G.progress.label);
      this.el.progressFill.style.width = `${Math.round(G.progress.frac * 100)}%`;
    } else this.el.progress.hidden = true;
    // Damage numbers drift up and fade.
    for (const d of this._dmgPool) {
      if (d.life > 0) {
        d.life -= 1 / 60;
        d.el.style.opacity = String(Math.max(0, d.life));
        if (d.life <= 0) d.el.style.display = 'none';
      }
    }
  }

  _renderPips() {
    const key = this.G.fighters.map((f) => (f.alive ? '1' : '0')).join('');
    if (this.last.pips === key) return;
    this.last.pips = key;
    const mk = (team) => {
      const div = team === 'v' ? this.el.pipsV : this.el.pipsS;
      div.innerHTML = '';
      for (const f of this.G.fighters) {
        if (f.team !== team) continue;
        const pip = document.createElement('span');
        pip.className = `pip ${f.alive ? 'alive ' + team : ''}`;
        div.appendChild(pip);
      }
    };
    mk('v'); mk('s');
  }

  showHitmarker(head) {
    this.el.hitmarker.classList.add('on');
    this.el.hitmarker.style.background = '';
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => this.el.hitmarker.classList.remove('on'), 110);
  }

  flashDamage() {
    this.el.fill.style.background = '#e0533d';
    setTimeout(() => { this.el.fill.style.background = ''; }, 120);
  }

  damageNumber(worldPos, amount) {
    const v = worldPos.clone().project(this.G.camera);
    if (v.z > 1) return;
    const d = this._dmgPool[this._dmgIdx++ % this._dmgPool.length];
    d.el.textContent = `-${amount}`;
    d.el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth + (Math.random() * 30 - 15)}px`;
    d.el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    d.el.style.display = 'block';
    d.el.style.opacity = '1';
    d.life = 0.8;
  }

  setScoped(on) { this.el.scope.classList.toggle('on', on); }

  banner(title, sub, cls) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub;
    this.el.banner.className = cls || '';
    this.el.banner.hidden = false;
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { this.el.banner.hidden = true; }, 3800);
  }

  killfeedAdd(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
    setTimeout(() => div.remove(), 9000);
  }

  // Buy menu: render shop rows, toggle visibility.
  renderShop(G) {
    const items = G.economy.catalogue(G.player);
    this.el.shop.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item';
      b.disabled = it.owned || !it.canAfford;
      b.innerHTML = `<span class="key">${it.key}</span><span class="nm">${it.name}<small>${it.desc}</small></span>` +
        (it.owned ? '<span class="owned">OWNED</span>' : `<span class="price">$${it.price}</span>`);
      b.addEventListener('click', () => G.tryBuy(it.id));
      this.el.shop.appendChild(b);
    }
    this.el.buyMoney.textContent = `$${G.economy.money}`;
    this.el.buyRound.textContent = String(G.round);
  }

  setBuy(open, G) {
    this.el.buy.hidden = !open;
    if (open) this.renderShop(G);
  }

  setBuyTimer(sec) { this._set('buytimer', this.el.buyTimer, String(Math.max(0, Math.ceil(sec)))); }
}
