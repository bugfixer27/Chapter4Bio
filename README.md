# A Tour of the Cell

Chapter 4 of *Campbell Biology in Focus* (3rd ed.) as an editorial scroll film
with real-time 3D sets. It falls from a person to an atom, puts a cell under
eight microscopes and a centrifuge, then goes inside: through the nuclear
envelope, along one protein's route from ribosome to secretion, into the
mitochondrion and chloroplast, down to single tubulin dimers. It ends with a
macrophage using every system at once. It is a companion to *Membrane*
(CellWall).

## Run it

**On GitHub Pages:** push to `main` and the workflow in
`.github/workflows/deploy.yml` builds and publishes the site. The first time,
open the repository's **Settings → Pages** and set **Source** to
**GitHub Actions**. The site appears at `https://<user>.github.io/<repo>/`.

**Locally:** double-click **`launch.command`**. It installs dependencies on
first run, starts the dev server on port 5181 and opens Chrome. Or:

```bash
npm install
npm run dev
```

Best in desktop Chrome with a recent GPU. The renderer adapts its pixel ratio
to hold the frame rate.

## What's on the page

| | Chapter | Set piece |
|---|---|---|
| 00 | A Tour of the Cell | Hooke's cork, in Voronoi cells, lenses the headline. The lens opens into the next world. |
| 01 | Powers of ten (§4.1, Fig. 4.2) | A log zoom from a person (≈ 1.7 m) through an egg, a cell, a bacterium, a mitochondrion, a virus, a ribosome, hemoglobin, a lipid and glucose to a carbon atom. Each object is drawn to scale on a live log ruler, and neighbouring sizes are paired side by side. |
| 02 | Seeing cells (Fig. 4.3) | One particle cell imaged eight ways: brightfield, stained, phase-contrast, DIC, fluorescence, confocal, SEM and TEM. A wipe moves from instrument to instrument, and a resolution panel shows why a 25-nm ribosome is invisible to light. |
| 03 | Taking cells apart (§4.1) | The cell is homogenised. Four spins (1 000 g to 150 000 g) settle nuclei, mitochondria, membranes and ribosomes into pellets, and the tubes swing out in the rotor. |
| 04 | Two kinds of cell (Figs. 4.4, 4.6) | A rod bacterium (nucleoid, ribosomes, wall, capsule, fimbriae, rotating flagella) beside a eukaryotic cell. Then 125 cubes split apart, and every newly exposed face lights amber: surface rises 5×, volume stays the same. |
| 05 | The panorama (Fig. 4.7) | The animal cell morphs into a plant cell, adding a wall, chloroplasts, a central vacuole and plasmodesmata. A "who has what" table tracks the change. |
| 06 | The nucleus (Fig. 4.8) | A lens dives through the double envelope, the pores and the lamina. Chromatin condenses: beads on a string → 30-nm fibre → looped domains → two sister chromatids. Then the nucleolus, with subunits and mRNA leaving through the pores. |
| 07 | Ribosomes (Fig. 4.9) | One ribosome assembles on an mRNA and translates. It docks on the ER over a translocon, and its chain is threaded into the lumen and glycosylated. |
| 08 | Endoplasmic reticulum (Fig. 4.10) | Rough sheets studded with polysomes, continuous with the envelope. Smooth tubules store Ca²⁺. A vesicle buds from transitional ER. |
| 09 | The Golgi apparatus (Fig. 4.11) | Cis → trans cisternae mature while the cargo's sugar tree is trimmed and rebuilt. A secretory vesicle fuses with the plasma membrane. |
| 10 | Lysosomes and vacuoles (Figs. 4.12–4.15) | Phagocytosis, then a lysosome fusing and digesting at pH 5. Autophagy of a worn mitochondrion. Then the plant's central vacuole, and the whole endomembrane system laid flat as a flow map. |
| 11 | Endosymbiosis (Fig. 4.16) | A host engulfs an oxygen-using prokaryote. Over generations it becomes a mitochondrion, and the evidence ticks off: two membranes, circular DNA, own ribosomes, division. |
| 12 | Power plants (Figs. 4.17–4.19) | Sections through a mitochondrion (cristae, matrix) and a chloroplast (thylakoids, grana, stroma). Mitochondria fuse and divide as a network. Then a peroxisome with its catalase core. |
| 13 | The cytoskeleton (Table 4.1) | Tubulin dimers build a 13-protofilament microtubule that grows under a GTP cap and then peels in catastrophe. Kinesin walks 8 nm per ATP carrying a vesicle. Actin and myosin; an intermediate-filament rope; a centrosome. |
| 14 | Cilia and flagella (Fig. 4.23) | The 9 + 2 axoneme with dynein, nexin and radial spokes; the 9 + 0 basal body. Doublets slide when their links are cut and bend when held. A carpet of beating cilia and a swimming flagellum. |
| 15 | Walls and matrix (Figs. 4.25, 4.26) | The plant wall: cellulose microfibrils laid by rosettes along microtubules, pectin, and a plasmodesma with its desmotubule. The animal ECM: banded collagen, proteoglycans, fibronectin and integrins that pass a signal to the nucleus. |
| 16 | Cell junctions (Figs. 4.27, 4.28) | A cut-open intestinal epithelium. Tight junctions stop dye poured on top from leaking between the cells. Desmosomes appear as plaques with keratin bundles fanning inward. Through gap junctions, dye injected into one cell spreads to its neighbours. |
| 17 | Greater than the sum (§4.8, Fig. 4.29) | A macrophage reaches out with filopodia, engulfs a bacterium and digests it with lysosomes. The page turns to paper for a four-column concept summary. |

Throughout, as a lesson:

- **Spotlight.** At each moment the thing being taught stays sharp and bright; everything else softens and dims.
- **Key terms.** Bold terms light in reading order, and each lights the thing it names on screen. In the particle cell the named organelle glows. Hovering a term does the same.
- **Predict → reveal.** Questions ask you to predict before the scene shows the answer.
- **Takeaways.** Each chapter ends on three lines that assemble out of the scene.
- **Interludes.** Physics sorting games (which cells have what; what belongs to the endomembrane system) and engraved plates sit between chapters.

## Science notes

`src/science/cell.ts` holds the numbers. Every value in the copy is filled
from it through `data-v` hooks (`src/science/derived.ts`).

- Every set is drawn to scale in its own units: 1 µm (cell), 10 nm (inside, ECM), 100 nm (organelles, epithelium), 1 nm (cytoskeleton). The scale readout in the top bar is computed from the camera.
- Nucleus ≈ 5 µm; envelope gap 20–40 nm; pore ≈ 100 nm with an eight-fold complex; chromatin packing at 2 / 10 / 30 / 300 / 700 nm.
- The membranes are the zero set of one continuous lumen field. So the perinuclear space, the rough ER and the smooth ER are a single compartment, and each pore lip joins the inner membrane to the outer.
- Microtubule: 25 nm, 13 protofilaments, 3-start helix with a seam. Actin: 7 nm, a crossover every ≈ 36 nm. Intermediate filaments: 8–12 nm. Kinesin: 8 nm per step, 1 ATP per step.
- Surface-to-volume: one 5-unit cube (150 : 125) against 125 unit cubes (750 : 125).
- Deliberate liberties, each flagged in the copy where it matters:
  - the particle cell's animal → plant morph;
  - cilia drawn at 1/100 scale (the readout says so);
  - 6 000 nucleosomes standing in for a chromosome's millions, so each is drawn larger as the chromosome condenses.

## For developers

- `?f=12.4` opens the film at that film time.
- `window.__c.go(12.4)` scrolls there; `__c.film` exposes the current state.
- `src/core/film.ts` is the single source of truth: chapters, transitions, camera keys per set, and every stage value.
- Each 3D set implements `WorldSet` (`src/gl/sets.ts`). The engine composes outer and inner sets through a portal pass, then plates, bloom and the final grade.
