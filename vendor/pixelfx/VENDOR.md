# pixelfx, vendored for one effect

From https://github.com/patch-gg/pixelfx at commit 5294518ce7c72e48b6100a744596e0acf57f2826 (2026-11-12), MIT (LICENSE,
NOTICE.md: the MIT licence allows copying, keeping its notice). Peek uses one effect, the XP orb, as its loading
animation: `src/fx/pickups/xp-orb.js` with its helpers `src/fx/pickups/_lib.js`, and the core it runs
on (`src/core`). Nothing else from the library is here; nothing is changed. The orb's colours are passed in by
`app/pixel-loader.tsx` (the brand orange ramp).
