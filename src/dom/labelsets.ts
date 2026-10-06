/* Labels for the inside sets (nucleus → Golgi, organelles, cytoskeleton,
   matrix, epithelium). Kept apart from labels.ts so each set's anchors live
   next to the set they describe. Each key term in the copy (data-k) lights
   the label with the same id. */
import * as THREE from 'three'
import type { Engine } from '../gl/engine'
import type { L } from './labels'
import { film, smooth } from '../core/film'
import { onShell, DOCK, DOCK_N, HERO_FREE, CHROMO } from '../gl/insideObjs'
import { NUCLEOLUS, LYSO, AUTO_M, PHAGO_P, EXO_P, GOLGI_C, RER_R } from '../gl/inside'
import { TER, insideStage, fibStage } from '../core/stages'
import { ORG_X } from '../gl/org'
import { FIB } from '../gl/fib'
import { ECM } from '../gl/ecm'

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const fix = (v: THREE.Vector3) => () => v

/* the chromatin fibre's first beads (mirrors pathA in insideObjs) */
const pathA = (L: number) => V(55 * Math.sin(L / 55) + 22 * Math.sin(L / 23 + 1) + 9 * Math.sin(L / 9 + 2), 40 * Math.sin(L / 70 + 0.5) + 18 * Math.cos(L / 29) + 7 * Math.sin(L / 11), 45 * Math.cos(L / 61) - 45 + 15 * Math.sin(L / 19 + 3) + 6 * Math.cos(L / 7))
/* where the hero ribosome is now (mirrors insideObjs) */
function heroPos() {
  const s = insideStage(film.F, 0).st
  const k = smooth(0, 1, s.dock)
  return HERO_FREE.clone().lerp(DOCK, k)
}
function aerobe() {
  const k = smooth(0.2, 1, smooth(11.2, 11.32, film.F))
  return V(96, 14, 0).lerp(V(26, -16, 0), k)
}
function cyano() {
  const k = smooth(0.2, 1, smooth(11.4, 11.5, film.F))
  return V(-96, -30, 0).lerp(V(-8, -34, 0), k)
}

export function setLabels(engine: Engine): L[] {
  void engine
  const C = {
    nuc: '#4a6bff', er: '#44ff7a', ser: '#80f2c0', gol: '#ffa82e', lys: '#ff4d33', pm: '#8cf2ff', rib: '#ffd27a', ves: '#fff0a0', npc: '#c8b4ff',
    mito: '#ff3d85', chl: '#b8ff3d', per: '#fff06a', mt: '#c4ff4d', act: '#ff8a4a', ifl: '#b886ff', dyn: '#ff4d4d', link: '#5aa0ff',
  }
  const docked = () => film.F > 7.4
  return [
    /* ---- ch 6: the nucleus ---- */
    { id: 'envelope', set: 'in', r: [6.02, 6.05, 6.3, 6.33], at: fix(onShell(70, 60, 503)), text: () => 'Nuclear envelope · two membranes', c: C.nuc },
    { id: 'pore', set: 'in', r: [6.06, 6.09, 6.3, 6.33], at: fix(onShell(30, -30, 506)), text: () => 'Nuclear pore · ≈ 100 nm', c: C.npc },
    { id: 'npc', set: 'in', r: [6.17, 6.2, 6.29, 6.31], at: fix(onShell(0, 7.5, 508)), text: () => 'Pore complex · eight-fold ring', c: C.npc },
    { set: 'in', r: [6.04, 6.07, 6.3, 6.33], at: fix(onShell(-30, 50, 505.6)), text: () => 'Ribosomes on the outer membrane', c: C.rib },
    { id: 'lamina', set: 'in', r: [6.35, 6.37, 6.42, 6.44], at: fix(onShell(10, 22, 496)), text: () => 'Nuclear lamina', c: C.ifl },
    { id: 'chromatin', set: 'in', r: [6.42, 6.45, 6.64, 6.67], at: () => CHROMO.clone().add(pathA(40 * 2.1)).add(V(0, 2, 0)), text: () => 'Chromatin · DNA + proteins', c: C.nuc },
    { id: 'histone', set: 'in', r: [6.44, 6.47, 6.57, 6.6], at: () => CHROMO.clone().add(pathA(8 * 2.1)), text: () => 'Nucleosome · DNA round 8 histones', c: '#c8a0ff', left: true },
    { set: 'in', r: [6.62, 6.65, 6.76, 6.78], at: () => CHROMO.clone().add(film.F < 6.69 ? V(0, 70, 0) : V(0, 26, 0)), text: () => (film.F < 6.69 ? '30-nm fibre, looping' : 'Condensed chromosome · two sister chromatids'), c: C.nuc },
    { id: 'nucleolus', set: 'in', r: [6.78, 6.81, 6.92, 6.95], at: fix(NUCLEOLUS.clone().add(V(0, 36, 0))), text: () => 'Nucleolus · no membrane', c: C.nuc },
    { id: 'subunit', set: 'in', r: [6.8, 6.83, 6.95, 6.97], at: fix(onShell(-20, 10, 488)), text: () => 'Ribosomal subunits, heading for the pores', c: C.rib },
    { id: 'mrna', set: 'in', r: [6.82, 6.85, 6.95, 6.97], at: fix(onShell(-60, 30, 512)), text: () => 'mRNA leaving', c: '#ff8a5a' },

    /* ---- ch 7: ribosomes ---- */
    { id: 'ribosome', set: 'in', r: [7.02, 7.05, 7.3, 7.33], at: () => heroPos().add(V(0, 2.6, 0)), text: () => 'Ribosome · ≈ 25 nm', c: C.rib },
    { id: 'large', set: 'in', r: [7.05, 7.08, 7.18, 7.2], at: () => heroPos().add(V(1.6, 1.0, 0)), text: () => 'Large subunit', c: C.rib },
    { id: 'small', set: 'in', r: [7.06, 7.09, 7.18, 7.2], at: () => heroPos().add(V(1.6, -1.0, 0)), text: () => 'Small subunit', c: '#fff3d6' },
    { id: 'mrna', set: 'in', r: [7.07, 7.1, 7.3, 7.33], at: () => heroPos().add(V(-5, -0.4, 0)), text: () => 'mRNA', c: '#ff8a5a', left: true },
    { id: 'free', set: 'in', r: [7.19, 7.22, 7.33, 7.36], at: () => heroPos().add(V(0, 4.4, 0)), text: () => 'Free ribosome · a protein for the cytosol', c: C.rib },
    { id: 'bound', set: 'in', r: [7.44, 7.47, 7.86, 7.89], at: () => DOCK.clone().add(DOCK_N.clone().multiplyScalar(2.6)), text: () => 'Bound ribosome', c: C.rib },
    { id: 'translocon', set: 'in', r: [7.46, 7.49, 7.86, 7.89], at: () => DOCK.clone().add(DOCK_N.clone().multiplyScalar(-1.5)).add(V(2, 0, 0)), text: () => 'Translocon · a pore in the ER membrane', c: '#d6a6ff' },
    { id: 'lumen', set: 'in', r: [7.48, 7.51, 7.86, 7.89], at: () => DOCK.clone().add(DOCK_N.clone().multiplyScalar(-5)).add(V(4, 0, 0)), text: () => 'ER lumen', c: C.er },
    { id: 'glyco', set: 'in', r: [7.6, 7.63, 7.86, 7.89], at: () => DOCK.clone().add(DOCK_N.clone().multiplyScalar(-7.5)), text: () => 'Sugars added: a glycoprotein', c: '#8dff7a', left: true },
    { id: 'memprot', set: 'in', r: [7.76, 7.79, 7.86, 7.89], at: () => DOCK.clone().add(V(-4, 0, 3)), text: () => 'A membrane protein stays in the bilayer', c: '#e05cff', left: true },

    /* ---- ch 8: the ER ---- */
    { id: 'er', set: 'in', r: [8.03, 8.06, 8.28, 8.31], at: fix(onShell(-175, 60, RER_R[1])), text: () => 'Endoplasmic reticulum', c: C.er },
    { set: 'in', r: [8.03, 8.06, 8.28, 8.31], at: fix(onShell(60, 40, 501.5)), text: () => 'Nuclear envelope', c: C.nuc },
    { id: 'cisternae', set: 'in', r: [8.16, 8.19, 8.42, 8.45], at: fix(onShell(-120, 30, RER_R[2])), text: () => 'Cisternae', c: C.er },
    { id: 'lumen', set: 'in', r: [8.17, 8.2, 8.3, 8.33], at: fix(onShell(-150, 0, RER_R[0])), text: () => 'One continuous lumen', c: C.er, left: true },
    { id: 'rer', set: 'in', r: [8.3, 8.33, 8.43, 8.46], at: fix(onShell(-60, 20, RER_R[2] + 4)), text: () => 'Rough ER · ribosomes on its face', c: C.er },
    { id: 'tER', set: 'in', r: [8.31, 8.34, 8.43, 8.46], at: fix(TER.clone().add(V(4, 4, 0))), text: () => 'Transitional ER · a vesicle buds', c: C.ves },
    { id: 'vesicle', set: 'in', r: [8.38, 8.41, 8.45, 8.48], at: fix(TER.clone().add(V(6, 2, 0))), text: () => 'Transport vesicle', c: C.ves },
    { id: 'ser', set: 'in', r: [8.46, 8.49, 8.9, 8.93], at: fix(V(70, -100, 40)), text: () => 'Smooth ER · tubules, no ribosomes', c: C.ser },
    { id: 'ca', set: 'in', r: [8.55, 8.58, 8.7, 8.73], at: fix(V(48, -118, 30)), text: () => (film.F > 8.63 ? 'Ca²⁺ released → contraction' : 'Ca²⁺ pumped into the lumen'), c: '#a6fff0' },

    /* ---- ch 9: the Golgi ---- */
    { id: 'golgi', set: 'in', r: [9.17, 9.2, 9.33, 9.36], at: fix(GOLGI_C.clone().add(V(0, 40, 0))), text: () => 'Golgi apparatus', c: C.gol },
    { id: 'cis', set: 'in', r: [9.06, 9.1, 9.52, 9.55], at: fix(GOLGI_C.clone().add(V(-16, 34, 0))), text: () => 'cis face · receiving', c: '#4de1c1', left: true },
    { id: 'trans', set: 'in', r: [9.18, 9.21, 9.66, 9.69], at: fix(GOLGI_C.clone().add(V(18, 30, 0))), text: () => 'trans face · shipping', c: C.gol },
    { id: 'sugar', set: 'in', r: [9.2, 9.23, 9.33, 9.36], at: fix(GOLGI_C.clone().add(V(0, -24, 10))), text: () => 'Sugars trimmed and replaced', c: '#8dff7a' },
    { id: 'cisterna', set: 'in', r: [9.35, 9.38, 9.52, 9.55], at: fix(GOLGI_C.clone().add(V(0, 26, 0))), text: () => 'Cisternae move cis → trans', c: C.gol },
    { id: 'retro', set: 'in', r: [9.42, 9.45, 9.52, 9.55], at: fix(GOLGI_C.clone().add(V(-10, -30, 0))), text: () => 'Enzymes carried back', c: '#4de1c1', left: true },
    { id: 'tag', set: 'in', r: [9.58, 9.61, 9.7, 9.73], at: fix(GOLGI_C.clone().add(V(22, 8, 4))), text: () => 'Tagged: a phosphate “zip code”', c: '#ff7ab0' },
    { id: 'lysoves', set: 'in', r: [9.6, 9.63, 9.76, 9.79], at: fix(LYSO[0].clone().add(V(0, 18, 0))), text: () => 'Lysosome', c: C.lys },
    { id: 'pmB', set: 'in', r: [9.7, 9.73, 9.93, 9.96], at: fix(EXO_P.clone().add(V(0, 26, 0))), text: () => 'Plasma membrane', c: C.pm, left: true },
    { id: 'secves', set: 'in', r: [9.77, 9.8, 9.9, 9.93], at: fix(EXO_P.clone().add(V(-12, -6, 0))), text: () => 'Secretory vesicle · exocytosis', c: C.ves, left: true },

    /* ---- ch 10: lysosomes ---- */
    { id: 'lysosome', set: 'in', r: [10.03, 10.06, 10.15, 10.18], at: fix(LYSO[0].clone().add(V(0, 17, 0))), text: () => 'Lysosome · acid, hydrolytic enzymes', c: C.lys },
    { id: 'foodvac', set: 'in', r: [10.2, 10.23, 10.32, 10.34], at: fix(PHAGO_P.clone().add(V(-6, 14, 0))), text: () => (film.F < 10.24 ? 'Bacterium · engulfed' : 'Food vacuole + lysosome'), c: '#59ff73', left: true },
    { id: 'autophag', set: 'in', r: [10.35, 10.38, 10.47, 10.5], at: fix(AUTO_M.clone().add(V(0, 30, 0))), text: () => (film.F < 10.42 ? 'Damaged mitochondrion, being wrapped' : 'Autophagosome + lysosome'), c: '#e8c8ff' },
    { id: 'storage', set: 'in', r: [10.54, 10.57, 10.64, 10.67], at: fix(LYSO[0].clone().add(V(0, 30, 0))), text: () => 'Engorged lysosome · undigested lipid', c: C.lys },

    /* ---- ch 11: endosymbiosis ---- */
    { id: 'host', set: 'org', r: [11.08, 11.12, 11.36, 11.39], at: fix(V(-20, 50, 0)), text: () => 'Host cell · ancestor of eukaryotes', c: C.pm, left: true },
    { id: 'aerobe', set: 'org', r: [11.1, 11.14, 11.36, 11.39], at: () => aerobe().add(V(0, 8, 0)), text: () => (film.F < 11.32 ? 'Oxygen-using prokaryote' : 'Endosymbiont → mitochondrion'), c: C.mito },
    { id: 'cyano', set: 'org', r: [11.4, 11.43, 11.56, 11.59], at: () => cyano().add(V(0, 10, 0)), text: () => (film.F < 11.49 ? 'Photosynthetic prokaryote' : '→ chloroplast'), c: C.chl, left: true },
    { id: 'twomem', set: 'org', r: [11.6, 11.63, 11.8, 11.83], at: () => aerobe().add(V(4, 4.6, 0)), text: () => 'Two membranes', c: C.mito },
    { id: 'mtdna', set: 'org', r: [11.62, 11.65, 11.8, 11.83], at: () => aerobe().add(V(-1.5, -1.6, 0)), text: () => 'Own circular DNA', c: '#ffe066', left: true },
    { id: 'mtribo', set: 'org', r: [11.64, 11.67, 11.8, 11.83], at: () => aerobe().add(V(2.5, -2.2, 0)), text: () => 'Own ribosomes', c: C.rib },
    { id: 'divide', set: 'org', r: [11.68, 11.71, 11.8, 11.83], at: () => aerobe().add(V(-3, 6, 0)), text: () => 'Divides on its own', c: C.mito, left: true },

    /* ---- ch 12: power plants ---- */
    { id: 'outer', set: 'org', r: [12.02, 12.05, 12.3, 12.33], at: fix(V(ORG_X.mito + 2, 5.1, 0)), text: () => 'Outer membrane · smooth', c: C.mito },
    { id: 'inner', set: 'org', r: [12.03, 12.06, 12.3, 12.33], at: fix(V(ORG_X.mito - 6, 4.5, 0)), text: () => 'Inner membrane', c: '#ff8ab0', left: true },
    { id: 'cristae', set: 'org', r: [12.04, 12.07, 12.3, 12.33], at: fix(V(ORG_X.mito - 1.7, -2.5, 0)), text: () => 'Cristae', c: '#ff8ab0' },
    { id: 'ims', set: 'org', r: [12.05, 12.08, 12.3, 12.33], at: fix(V(ORG_X.mito + 8.5, 4.4, 0)), text: () => 'Intermembrane space', c: '#ffc0d8' },
    { id: 'matrix', set: 'org', r: [12.06, 12.09, 12.3, 12.33], at: fix(V(ORG_X.mito - 4, 0.6, 0)), text: () => 'Matrix · DNA, ribosomes, enzymes', c: C.mito, left: true },
    { id: 'synthase', set: 'org', r: [12.18, 12.21, 12.3, 12.33], at: fix(V(ORG_X.mito + 1.7, -1, 0)), text: () => 'ATP synthase sits here, on the cristae', c: '#ffd36b' },
    { id: 'network', set: 'org', r: [12.33, 12.36, 12.43, 12.46], at: fix(V(ORG_X.net, 18, 0)), text: () => 'A fusing, dividing network', c: C.mito },
    { id: 'thylakoid', set: 'org', r: [12.46, 12.49, 12.6, 12.63], at: fix(V(ORG_X.chloro - 12.7, 2.2, 0)), text: () => 'Thylakoids', c: C.chl, left: true },
    { id: 'granum', set: 'org', r: [12.47, 12.5, 12.6, 12.63], at: fix(V(ORG_X.chloro - 6.4, 2.6, -4)), text: () => 'Granum · a stack', c: C.chl },
    { id: 'stroma', set: 'org', r: [12.48, 12.51, 12.6, 12.63], at: fix(V(ORG_X.chloro + 6, -5, 0)), text: () => 'Stroma · DNA, ribosomes, enzymes', c: '#d8ff9a' },
    { id: 'amylo', set: 'org', r: [12.66, 12.69, 12.77, 12.8], at: fix(V(ORG_X.plastid - 14, 9, 0)), text: () => 'Amyloplast · starch', c: '#f0f0ff', left: true },
    { id: 'chromo', set: 'org', r: [12.67, 12.7, 12.77, 12.8], at: fix(V(ORG_X.plastid + 14, 8, 0)), text: () => 'Chromoplast · pigments', c: '#ffb347' },
    { id: 'perox', set: 'org', r: [12.79, 12.82, 13.0, 13.02], at: fix(V(ORG_X.perox + 1, 4.8, 0)), text: () => 'Peroxisome · one membrane', c: C.per },
    { id: 'h2o2', set: 'org', r: [12.82, 12.85, 13.0, 13.02], at: fix(V(ORG_X.perox + 0.6, -1.6, 0)), text: () => 'Crystalline core · catalase: 2 H₂O₂ → 2 H₂O + O₂', c: '#ffd36b', left: true },

    /* ---- ch 13: the cytoskeleton ---- */
    { id: 'mt', set: 'fib', r: [13.04, 13.08, 13.2, 13.23], at: fix(FIB.mt0.clone().add(V(14, 200, 0))), text: () => 'Microtubule · 25 nm', c: C.mt },
    { id: 'actin', set: 'fib', r: [13.04, 13.08, 13.14, 13.17], at: fix(FIB.actin.clone().add(V(4, -60, 0))), text: () => 'Microfilament · 7 nm', c: C.act },
    { id: 'if', set: 'fib', r: [13.05, 13.09, 13.14, 13.17], at: fix(FIB.ifil.clone().add(V(6, -100, 0))), text: () => 'Intermediate filament · 10 nm', c: C.ifl },
    { id: 'tubulin', set: 'fib', r: [13.16, 13.19, 13.24, 13.27], at: fix(FIB.mt0.clone().add(V(13, 240, 0))), text: () => 'Tubulin dimer · α + β, 8 nm', c: '#e8ffb0' },
    { set: 'fib', r: [13.23, 13.26, 13.29, 13.31], at: fix(FIB.mt0.clone().add(V(0, 450, 0))), text: () => '13 protofilaments · 15-nm lumen', c: C.mt },
    { id: 'grow', set: 'fib', r: [13.3, 13.33, 13.41, 13.44], at: () => FIB.mt0.clone().add(V(16, fibLen() * 8 - 4, 0)), text: () => (film.F < 13.36 ? 'Plus end · growing (GTP cap)' : 'Catastrophe · protofilaments peel'), c: '#fff06a' },
    { id: 'motor', set: 'fib', r: [13.44, 13.47, 13.55, 13.58], at: () => kinPos().add(V(0, 8, 0)), text: () => 'Kinesin · 8 nm per step, 1 ATP', c: '#ff5fb0' },
    { id: 'receptor', set: 'fib', r: [13.45, 13.48, 13.55, 13.58], at: () => kinPos().add(V(10, 62, 0)), text: () => 'Receptor · vesicle', c: '#59e1ff' },
    { id: 'myosin', set: 'fib', r: [13.6, 13.63, 13.7, 13.73], at: fix(FIB.actin.clone().add(V(16, -300, 0))), text: () => 'Myosin heads · power stroke', c: '#ffd36b' },
    { id: 'centrosome', set: 'fib', r: [13.86, 13.89, 13.99, 14.02], at: fix(FIB.cen.clone().add(V(0, 260, 0))), text: () => 'Centrosome', c: C.mt },
    { id: 'centriole', set: 'fib', r: [13.87, 13.9, 13.99, 14.02], at: fix(FIB.cen.clone().add(V(110, 0, 0))), text: () => 'Centrioles · 9 triplets, at right angles', c: '#e8ffb0' },

    /* ---- ch 14: cilia and flagella ---- */
    { id: 'cilia', set: 'fib', r: [14.04, 14.07, 14.15, 14.18], at: fix(FIB.cil.clone().add(V(-40, 90, 0))), text: () => 'Cilia · power and recovery strokes', c: C.pm, left: true },
    { id: 'flagellum', set: 'fib', r: [14.06, 14.09, 14.15, 14.18], at: fix(FIB.cil.clone().add(V(130, 54, 0))), text: () => 'Flagellum · undulating', c: C.pm },
    { id: 'doublet', set: 'fib', r: [14.18, 14.21, 14.43, 14.46], at: fix(FIB.ax.clone().add(V(0, 100, 60))), text: () => 'Microtubule doublet', c: C.mt },
    { id: 'central', set: 'fib', r: [14.19, 14.22, 14.43, 14.46], at: fix(FIB.ax.clone().add(V(0, 14, 60))), text: () => 'Central pair', c: C.mt },
    { id: 'spoke', set: 'fib', r: [14.21, 14.24, 14.43, 14.46], at: fix(FIB.ax.clone().add(V(40, 38, 60))), text: () => 'Radial spoke', c: C.link },
    { id: 'links', set: 'fib', r: [14.21, 14.24, 14.43, 14.46], at: fix(FIB.ax.clone().add(V(-60, 66, 60))), text: () => 'Cross-linking proteins', c: C.link, left: true },
    { id: 'dynein', set: 'fib', r: [14.22, 14.25, 14.43, 14.46], at: fix(FIB.ax.clone().add(V(70, -48, 60))), text: () => 'Dynein arms', c: C.dyn },
    { id: 'basal', set: 'fib', r: [14.34, 14.37, 14.45, 14.48], at: fix(FIB.bb.clone().add(V(0, 110, 60))), text: () => 'Basal body · 9 + 0 triplets', c: C.mt },
    { id: 'bend', set: 'fib', r: [14.5, 14.53, 14.68, 14.71], at: fix(FIB.slide.clone().add(V(60, 270, 0))), text: () => (fibLinks() ? 'Linked: walking → bending' : 'Links cut: doublets slide apart'), c: C.dyn },
    { id: 'primary', set: 'fib', r: [14.71, 14.74, 14.79, 14.82], at: fix(FIB.bb.clone().add(V(0, 110, 60))), text: () => 'Primary cilium · 9 + 0, an antenna', c: C.mt },

    /* ---- ch 15: walls and matrix ---- */
    { id: 'synth', set: 'ecm', r: [15.04, 15.07, 15.17, 15.2], at: fix(V(10, 2, 2.5)), text: () => 'Cellulose synthase · in the membrane', c: '#ff9fd8' },
    { id: 'fibril', set: 'ecm', r: [15.05, 15.08, 15.17, 15.2], at: fix(V(-20, 32, 10)), text: () => 'Cellulose microfibrils', c: '#e9ffd0', left: true },
    { id: 'matrixw', set: 'ecm', r: [15.06, 15.09, 15.17, 15.2], at: fix(V(30, 36, 20)), text: () => 'Matrix · polysaccharides, protein', c: '#ffe08a' },
    { set: 'ecm', r: [15.04, 15.07, 15.17, 15.2], at: fix(V(-30, -4, 0)), text: () => 'Cortical microtubules guide the synthase', c: '#c4ff4d', left: true },
    { id: 'primary', set: 'ecm', r: [15.19, 15.22, 15.33, 15.36], at: fix(V(-50, 31, 0)), text: () => 'Primary wall', c: '#e9ffd0', left: true },
    { id: 'lamella', set: 'ecm', r: [15.2, 15.23, 15.33, 15.36], at: fix(V(-50, 40, 0)), text: () => 'Middle lamella · pectin', c: '#ffb347', left: true },
    { set: 'ecm', r: [15.2, 15.23, 15.33, 15.36], at: fix(V(-50, 49, 0)), text: () => "Neighbour's primary wall", c: '#e9ffd0', left: true },
    { id: 'secondary', set: 'ecm', r: [15.24, 15.27, 15.33, 15.36], at: fix(V(-50, -6, 0)), text: () => 'Secondary wall · laminated', c: '#e9ffd0', left: true },
    { id: 'collagen', set: 'ecm', r: [15.37, 15.4, 15.52, 15.55], at: fix(ECM.mat.clone().add(V(-20, 60, 0))), text: () => 'Collagen fibril · 67-nm bands', c: '#ffd9b3' },
    { id: 'pg', set: 'ecm', r: [15.38, 15.41, 15.52, 15.55], at: fix(ECM.mat.clone().add(V(30, 32, 10))), text: () => 'Proteoglycan complex', c: '#8dff7a' },
    { id: 'fn', set: 'ecm', r: [15.53, 15.56, 15.7, 15.73], at: fix(ECM.mat.clone().add(V(4, 16, 0))), text: () => 'Fibronectin', c: '#ffb86b' },
    { id: 'integrin', set: 'ecm', r: [15.54, 15.57, 15.7, 15.73], at: fix(ECM.mat.clone().add(V(-4, 6, 0))), text: () => 'Integrin · spans the membrane', c: '#e05cff', left: true },
    { id: 'mf', set: 'ecm', r: [15.55, 15.58, 15.7, 15.73], at: fix(ECM.mat.clone().add(V(6, -20, 0))), text: () => 'Microfilaments (actin)', c: C.act },
    { id: 'signal', set: 'ecm', r: [15.72, 15.75, 15.9, 15.93], at: fix(ECM.mat.clone().add(V(10, -70, 0))), text: () => 'Signal → nucleus', c: '#ffffff' },
    { id: 'plasmod', set: 'ecm', r: [16.03, 16.06, 16.16, 16.19], at: fix(ECM.pd.clone().add(V(4, 40, 0))), text: () => 'Plasmodesma · membrane-lined channel', c: C.pm },
    { set: 'ecm', r: [16.05, 16.08, 16.16, 16.19], at: fix(ECM.pd.clone().add(V(-2, 24, 0))), text: () => 'Desmotubule (ER)', c: '#7dffa0', left: true },

    /* ---- ch 16: the epithelium ---- */
    { id: 'epi', set: 'epi', r: [16.22, 16.25, 16.33, 16.36], at: fix(V(0, 96, 0)), text: () => 'Epithelial cells · brush border on top', c: C.pm },
    { id: 'tight', set: 'epi', r: [16.35, 16.38, 16.47, 16.5], at: fix(V(35, 75, 0)), text: () => 'Tight junction', c: '#a6fff0' },
    { id: 'desmo', set: 'epi', r: [16.49, 16.52, 16.6, 16.63], at: fix(V(35, 52, 0)), text: () => 'Desmosome', c: '#e0b8ff' },
    { id: 'keratin', set: 'epi', r: [16.5, 16.53, 16.6, 16.63], at: fix(V(24, 46, 0)), text: () => 'Keratin filaments', c: C.ifl, left: true },
    { id: 'gap', set: 'epi', r: [16.66, 16.69, 16.86, 16.89], at: fix(V(35, 32, 0)), text: () => 'Gap junctions', c: '#ffe066' },
  ]
}

/* small mirrors of the stage maths, for anchors that move */
function fibLen() {
  return fibStage(film.F).len0
}
function fibLinks() {
  return fibStage(film.F).links > 0.5
}
function kinPos() {
  const st = fibStage(film.F)
  const k = Math.floor(st.walk * 15 * 1.6)
  return FIB.mt1.clone().add(V(80 + k * 8, 13.6, 0))
}
void GOLGI_C
