// Economy: money, kill/round rewards, loss streak, buy menu catalogue.
// Rules (STRATEGY.md): start $800, kill +$300, win +$3250, loss +$1400,
// loss streak +$500 (cap $3400). Buy only during the freeze phase.
import { WEAPONS } from './weapons.js';

export const ECONOMY = {
  start: 800,
  kill: 300,
  win: 3250,
  loss: 1400,
  lossStreakBonus: 500,
  lossCap: 3400,
  kevlarPrice: 650,
  kevlarArmor: 50,
};

export class Economy {
  constructor(G) {
    this.G = G;
    this.money = ECONOMY.start;
    this.lossStreak = 0;
  }

  reset() { this.money = ECONOMY.start; this.lossStreak = 0; }

  addKillReward() { this.money += ECONOMY.kill; }

  roundEnd(won) {
    if (won) { this.money += ECONOMY.win; this.lossStreak = 0; }
    else {
      this.lossStreak += 1;
      const bonus = Math.min(ECONOMY.lossCap, ECONOMY.loss + (this.lossStreak - 1) * ECONOMY.lossStreakBonus);
      this.money += bonus;
    }
    this.money = Math.min(this.money, 16000);
  }

  // Buy catalogue for the shop UI: { key, id, name, desc, price, owned, canAfford }.
  catalogue(f) {
    const items = [];
    for (const id of ['rifle', 'smg', 'sniper']) {
      const w = WEAPONS[id];
      items.push({
        key: String(items.length + 1), id, kind: 'weapon',
        name: w.name, desc: `${w.dmg} dmg · ${w.mag} rnd mag · ${w.auto ? 'auto' : 'semi/bolt'}`,
        price: w.price, owned: !!f.weapons[id], canAfford: this.money >= w.price,
      });
    }
    items.push({
      key: '4', id: 'grenade', kind: 'grenade', name: 'HE GRENADE',
      desc: 'Thrown arc · 80 dmg in 4 m · bots hear the blast', price: 300,
      owned: false, canAfford: this.money >= 300,
    });
    items.push({
      key: '5', id: 'kevlar', kind: 'kevlar', name: 'KEVLAR VEST',
      desc: `+${ECONOMY.kevlarArmor} armor · absorbs half of incoming damage`, price: ECONOMY.kevlarPrice,
      owned: f.armor >= ECONOMY.kevlarArmor, canAfford: this.money >= ECONOMY.kevlarPrice,
    });
    items.push({
      key: '6', id: 'ammo', kind: 'ammo', name: 'REFILL AMMO',
      desc: 'Top up reserve ammo for every owned weapon', price: 200,
      owned: false, canAfford: this.money >= 200,
    });
    return items;
  }

  // Buy by catalogue id. Returns true on success.
  buy(f, id) {
    const G = this.G;
    if (G.phase !== 'buy') return false;
    if (id === 'grenade') {
      if (this.money < 300 || f.grenades >= 2) return false;
      this.money -= 300; f.grenades += 1;
    } else if (id === 'kevlar') {
      if (this.money < ECONOMY.kevlarPrice || f.armor >= ECONOMY.kevlarArmor) return false;
      this.money -= ECONOMY.kevlarPrice; f.armor = ECONOMY.kevlarArmor;
    } else if (id === 'ammo') {
      if (this.money < 200) return false;
      let any = false;
      for (const wid of Object.keys(f.weapons)) {
        const w = WEAPONS[wid], s = f.weapons[wid];
        if (s.reserve !== Infinity && s.reserve < w.reserve) { s.reserve = w.reserve; any = true; }
      }
      if (!any) return false;
      this.money -= 200;
    } else {
      const w = WEAPONS[id];
      if (!w || f.weapons[id] || this.money < w.price) return false;
      this.money -= w.price;
      f.weapons[id] = { mag: w.mag, reserve: w.reserve };
    }
    G.audio.buy();
    return true;
  }
}
