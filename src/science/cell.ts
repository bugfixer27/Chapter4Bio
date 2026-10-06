/* ==========================================================================
   THE NUMBERS
   Every figure the copy quotes is a textbook value (Campbell Biology in
   Focus, 3rd ed., chapter 4) or a standard one, noted as such in the
   outro, so the prose and the instruments cannot drift apart.
   ========================================================================== */

/* ---- sizes (Fig. 4.2) ---------------------------------------------------- */
export const RES = {
  eye: 1e-4, // unaided eye ≈ 0.1 mm
  light: 2e-7, // light microscope ≈ 0.2 µm
  superRes: 1.5e-8, // super-resolution 10–20 nm
  em: 2e-9, // electron microscope in practice ≈ 2 nm
}
export const LM_MAG = 1000

/* ---- cell fractionation (typical protocol) ------------------------------- */
export const SPINS = [
  { g: 1000, t: '10 min', pellet: 'Nuclei' },
  { g: 20000, t: '20 min', pellet: 'Mitochondria' },
  { g: 80000, t: '60 min', pellet: 'Membranes' },
  { g: 150000, t: '3 h', pellet: 'Ribosomes' },
]

/* ---- surface and volume (Fig. 4.6) ---------------------------------------- */
export const cubes = (side: number, n: number) => ({ surface: 6 * side * side * n, volume: side ** 3 * n })
export const BIG = cubes(5, 1) // 150, 125
export const SMALL = cubes(1, 125) // 750, 125

/* ---- the nucleus (§4.3) ---------------------------------------------------- */
export const NUCLEUS = { diameter: '≈ 5 µm', gap: '20–40 nm', pore: '≈ 100 nm', chromosomes: 46, gametes: 23 }
/** chromatin's levels of packing (standard values) */
export const CHROMATIN = [
  { w: 2, name: 'DNA double helix' },
  { w: 10, name: 'Nucleosomes: beads on a string' },
  { w: 30, name: 'Coiled fibre' },
  { w: 300, name: 'Looped domains' },
  { w: 700, name: 'Condensed chromosome' },
]

/* ---- the cytoskeleton (Table 4.1) ----------------------------------------- */
export const FILAMENTS = [
  { name: 'Microtubule', prot: 'Tubulin (α + β)', d: 25, dText: '25 nm, 15-nm lumen', role: 'Shape; motility; chromosome movement; organelle movement' },
  { name: 'Microfilament', prot: 'Actin', d: 7, dText: '7 nm', role: 'Shape and its changes; muscle contraction; streaming; crawling; division' },
  { name: 'Intermediate filament', prot: 'Keratins and others', d: 10, dText: '8–12 nm', role: 'Shape; anchor the nucleus; nuclear lamina' },
]
export const KINESIN_STEP_NM = 8
export const CENTRIOLE_NM = 250

/* ---- energy (§4.5) --------------------------------------------------------- */
export const MITO_LEN = '1–10 µm'
export const CHLORO_LEN = '3–6 µm'

/* ---- outside (§4.7) -------------------------------------------------------- */
export const COLLAGEN_PCT = 40
export const PROTEOGLYCAN_CARB_PCT = 95
export const WALL_THICK = '0.1 µm to several µm'

/* ---- lysosomes ------------------------------------------------------------- */
export const PH = { lysosome: 5, cytosol: 7.2 }
export const LIVER_RECYCLE = 'half its macromolecules each week'
