import type { LatexDocumentPayload } from '../types/latex'

// Three-file demo project: main + one chapter + bib. Intentionally small so
// the first-compile feedback loop is quick; users can add real chapters by
// clicking "+ file" in the card's tab strip.

// BusyTeX only bundles pdfTeX + bibtex8; `biblatex`/`biber` are NOT
// available, and there is no shell-escape. Stick to natbib + bibtex so
// the first-compile demo runs end-to-end on every machine.
const MAIN_TEX = `\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath, amssymb}
\\usepackage{graphicx}
\\usepackage[numbers]{natbib}

\\title{A Short Note on XRD Phase Identification}
\\author{You}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
This short note demonstrates the Lattice-app LaTeX writing module. It ships
as a three-file project so you can test multi-file editing and @-mentions
from the chat panel on day one.
\\end{abstract}

\\input{chapters/intro}

\\section{Conclusion}
The peaks in Figure~\\ref{fig:xrd} match the expected Bragg positions for
an \\emph{fcc} lattice, consistent with \\cite{smith2020}.

\\bibliographystyle{plain}
\\bibliography{refs}

\\end{document}
`

const INTRO_TEX = `\\section{Introduction}
\\label{sec:intro}

X-ray diffraction (XRD) is a standard workhorse for phase identification
in crystalline materials. Given a diffractogram $I(2\\theta)$, the goal is
to attribute each peak to a reflection $(hkl)$ of a known phase.

The Bragg condition,
\\begin{equation}
n \\lambda = 2 d_{hkl} \\sin\\theta,
\\label{eq:bragg}
\\end{equation}
links the observed angle $\\theta$ to the interplanar spacing $d_{hkl}$
via the wavelength $\\lambda$ of the incident beam.
`

const REFS_BIB = `@article{smith2020,
  author  = {Smith, Jane and Lee, Alex},
  title   = {High-throughput phase identification from powder diffraction},
  journal = {J. Appl. Cryst.},
  year    = {2020},
  volume  = {53},
  number  = {6},
  pages   = {1423--1431},
}
`

export const DEMO_LATEX: LatexDocumentPayload = {
  files: [
    { path: 'main.tex', kind: 'tex', content: MAIN_TEX },
    { path: 'chapters/intro.tex', kind: 'tex', content: INTRO_TEX },
    { path: 'refs.bib', kind: 'bib', content: REFS_BIB },
  ],
  rootFile: 'main.tex',
  activeFile: 'main.tex',
  engine: 'pdftex',
  status: 'idle',
  errors: [],
  warnings: [],
  logTail: '',
  mentionMode: 'selection',
  outline: [
    { file: 'main.tex', level: 1, title: 'Conclusion', offset: 0 },
    { file: 'chapters/intro.tex', level: 1, title: 'Introduction', offset: 0 },
  ],
  ghostEnabled: false,
  autoCompile: true,
  autoFixSuggest: true,
}

const EMPTY_MAIN_TEX = `\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath, amssymb}

\\title{Untitled}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

\\end{document}
`

export const EMPTY_LATEX: LatexDocumentPayload = {
  files: [{ path: 'main.tex', kind: 'tex', content: EMPTY_MAIN_TEX }],
  rootFile: 'main.tex',
  activeFile: 'main.tex',
  engine: 'pdftex',
  status: 'idle',
  errors: [],
  warnings: [],
  logTail: '',
  mentionMode: 'selection',
  outline: [],
  ghostEnabled: false,
  autoCompile: true,
  autoFixSuggest: true,
}
