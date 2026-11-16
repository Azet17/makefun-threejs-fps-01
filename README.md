# FERRO YARD — three.js tactical FPS

A round-based tactical FPS built with three.js 0.187.0 for the make.fun
`threejs-fps-01` bounty ("Make the best three.js tactical FPS").

- 5v5 vs bots — Vanguard (attackers) vs Sentinel (defenders)
- Bomb plant / defuse on two sites in an original industrial rail-yard map
- Economy + buy menu between rounds (4 weapons + HE grenade)
- Fixed 60 Hz sim, hitscan gunplay with headshots, recoil + spread, HUD

## Play

Serve the `game/` folder with any static server, open `index.html` in a
desktop browser, click to lock the pointer. WASD move, mouse look, LMB fire,
R reload, Space jump, Ctrl crouch, B buy menu, G throw grenade.

## Build

`node main.ts` copies `game/` + `screenshots/` to `/output` and writes
`dossier.json` (see `vendor/makefun-threejs.ts`).

## License

MIT — see LICENSE.
