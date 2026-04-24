import type { LatexDocumentPayload } from '../types/latex'

// Journal-specific scaffolds for the Creator / LaTeX module.
//
// BusyTeX bundles only pdfTeX + bibtex8 (no biblatex/biber, no shell-escape,
// and most publisher classes like `elsarticle.cls` / `achemso.cls` /
// `revtex4-1.cls` are NOT on disk). Every template here therefore compiles
// on top of plain `article` with natbib + bibtex so the first-compile loop
// works end-to-end offline. Each template's header comment points to the
// real publisher class the user should switch to when preparing the final
// submission off-device.
//
// To add a new template: drop a new `LatexTemplate` into `LATEX_TEMPLATES`
// — the Creator sidebar and command palette pick it up automatically.

export interface LatexTemplate {
  id: string
  /** Short label shown in the Creator sidebar. */
  name: string
  /** One-line hint shown under the label / as the button's title attr. */
  description: string
  /** Used as the artifact title when the user loads this template. */
  docTitle: string
  payload: LatexDocumentPayload
}

function makePayload(mainTex: string, refsBib: string): LatexDocumentPayload {
  return {
    files: [
      { path: 'main.tex', kind: 'tex', content: mainTex },
      { path: 'refs.bib', kind: 'bib', content: refsBib },
    ],
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
}

// ── Nature family (Nature, Nature Materials, Nature Communications) ──
// Flat single-column short article, superscript numbered citations,
// Methods as a trailing section.
const NATURE_MAIN = `% Nature-family scaffold (Nature / Nat. Mater. / Nat. Commun.).
% For final submission, switch \\documentclass to \\documentclass{nature}
% (download from nature.com/documents) and re-run on a full TeX Live.
\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath, amssymb}
\\usepackage{graphicx}
\\usepackage[numbers,super,sort&compress]{natbib}
\\renewcommand{\\bibnumfmt}[1]{#1.}

\\title{\\bfseries Title of the manuscript}
\\author{First Author\\textsuperscript{1}, Second Author\\textsuperscript{1,2},
  Corresponding Author\\textsuperscript{1,*}}
\\date{\\textsuperscript{1}Affiliation one \\\\
  \\textsuperscript{2}Affiliation two \\\\
  \\textsuperscript{*}corresponding@example.org}

\\begin{document}
\\maketitle

\\begin{abstract}
\\noindent One-paragraph summary of the work (\\textasciitilde150--200 words):
the problem, the approach, the principal finding, and its significance for
the broader field. Avoid citations and undefined abbreviations here.
\\end{abstract}

\\section*{Main}
Opening context paragraph. State the gap in the literature and the
question your work addresses. Cite sparingly with \\cite{example2024}.

\\paragraph{Result 1.} Describe the first principal finding, with a
pointer to Figure~\\ref{fig:overview}.

\\paragraph{Result 2.} Describe the second finding and how it extends
the first.

\\section*{Discussion}
Interpret the results, compare with prior work, and outline the
implications and limitations.

\\begin{figure}[t]
  \\centering
  % \\includegraphics[width=0.7\\linewidth]{figures/overview}
  \\caption{Overview of the experimental setup and key result.}
  \\label{fig:overview}
\\end{figure}

\\section*{Methods}
Detailed methods (samples, instruments, acquisition parameters, data
processing) go here. Nature journals allow Methods to exceed the main
text's citation budget.

\\section*{Data availability}
State where the raw data supporting this study can be found.

\\section*{Acknowledgements}
Funding sources, facility access, helpful discussions.

\\bibliographystyle{naturemag}
\\bibliography{refs}

\\end{document}
`

const NATURE_BIB = `@article{example2024,
  author  = {Example, Alex and Coauthor, Blake},
  title   = {An illustrative study in materials science},
  journal = {Nature Materials},
  year    = {2024},
  volume  = {23},
  pages   = {100--108},
}
`

// ── APS / RevTeX (Physical Review B, Physical Review Letters) ───────
// Two-column physics layout. We emulate revtex4-1 with article +
// \twocolumn so the scaffold compiles under BusyTeX; switch the class
// to `revtex4-1` on a full TeX Live for real submission.
const APS_MAIN = `% APS / RevTeX scaffold (Phys. Rev. B, Phys. Rev. Lett.).
% For final submission, switch to
%   \\documentclass[aps,prb,reprint,amsmath,amssymb]{revtex4-1}
% on a full TeX Live distribution.
\\documentclass[10pt,twocolumn]{article}
\\usepackage[margin=0.75in,columnsep=0.3in]{geometry}
\\usepackage{amsmath, amssymb, bm}
\\usepackage{graphicx}
\\usepackage[numbers,sort&compress]{natbib}
\\usepackage{caption}
\\captionsetup{font=small,labelfont=bf}

\\title{Title of the manuscript}
\\author{First Author}
\\author{Second Author}
\\author{Corresponding Author\\thanks{corresponding@example.org}}
\\date{\\small Affiliation one, City, Country \\\\ \\today}

\\begin{document}
\\twocolumn[
  \\begin{@twocolumnfalse}
    \\maketitle
    \\begin{abstract}
    \\noindent Abstract of up to 250 words summarizing the motivation,
    method, and principal physical result. Avoid citations and
    undefined symbols.
    \\end{abstract}
    \\vspace{1em}
  \\end{@twocolumnfalse}
]

\\section{Introduction}
Open with the physical context and the question the work addresses.
Cite prior work with \\cite{example2024}.

\\section{Methods}
Describe the theoretical framework, the computational details (code,
functional, basis set, k-mesh, convergence), or the experimental setup
(samples, instrument, geometry).

\\section{Results and discussion}
\\begin{equation}
  E_{\\text{gap}} = E_{\\text{c}} - E_{\\text{v}},
  \\label{eq:gap}
\\end{equation}
as defined in Eq.~\\eqref{eq:gap}. Present the principal observations
and their physical interpretation.

\\begin{figure}[t]
  \\centering
  % \\includegraphics[width=\\linewidth]{figures/bandstructure}
  \\caption{Electronic structure along the high-symmetry path.}
  \\label{fig:bands}
\\end{figure}

\\section{Conclusion}
Summarize the findings and point to follow-up directions.

\\begin{acknowledgments}
Funding sources and computational resources.
\\end{acknowledgments}

\\bibliographystyle{apsrev4-1}
\\bibliography{refs}

\\end{document}
`

const APS_BIB = `@article{example2024,
  author  = {Example, Alex and Coauthor, Blake},
  title   = {An illustrative first-principles study},
  journal = {Phys. Rev. B},
  year    = {2024},
  volume  = {109},
  pages   = {045101},
}
`

// ── ACS (JACS, ACS Nano, Chemistry of Materials) ────────────────────
// Mimics the `achemso` structure: title / authors with affiliation
// symbols, abstract, TOC graphic placeholder, standard body sections,
// Supporting Information callout.
const ACS_MAIN = `% ACS scaffold (JACS / ACS Nano / Chem. Mater.).
% For final submission, switch to \\documentclass{achemso} (from the
% achemso bundle) on a full TeX Live distribution.
\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath, amssymb}
\\usepackage{graphicx}
\\usepackage{chemformula}
\\usepackage[numbers,super,sort&compress]{natbib}
\\usepackage{caption}
\\captionsetup{labelfont=bf}

\\title{Title of the manuscript}
\\author{First Author$^{\\dagger}$, Second Author$^{\\ddagger}$,
  Corresponding Author$^{*,\\dagger}$ \\\\
  \\small $^{\\dagger}$Department One, University, City, Country \\\\
  \\small $^{\\ddagger}$Department Two, Institution, City, Country \\\\
  \\small $^{*}$E-mail: corresponding@example.org}
\\date{}

\\begin{document}
\\maketitle

\\begin{abstract}
\\noindent One-paragraph abstract (\\textasciitilde200 words) stating the
chemical problem, the synthetic/analytical strategy, the principal
result, and its chemical significance.
\\end{abstract}

\\noindent\\textbf{Keywords:} keyword one, keyword two, keyword three

\\paragraph{TOC graphic.}
%\\includegraphics[width=8cm]{figures/toc}
A short, caption-free graphic that captures the central finding.

\\section{Introduction}
Set up the chemistry context and the gap. Cite key prior work with
\\cite{example2024}.

\\section{Experimental}
\\subsection{Materials}
List reagents and suppliers.
\\subsection{Synthesis}
Give a representative procedure.
\\subsection{Characterization}
Instruments and parameters (XRD, XPS, Raman, ...).

\\section{Results and discussion}
Figure~\\ref{fig:char} summarizes the phase-pure product.

\\begin{figure}[t]
  \\centering
  % \\includegraphics[width=0.7\\linewidth]{figures/characterization}
  \\caption{Characterization of the as-synthesized material.}
  \\label{fig:char}
\\end{figure}

\\section{Conclusions}
Summarize the advance and its implications for the field.

\\section*{Supporting Information}
Full synthetic procedures, additional characterization, and raw data
are provided in the Supporting Information.

\\section*{Acknowledgements}
Funding sources and beamline / facility access.

\\bibliographystyle{achemso}
\\bibliography{refs}

\\end{document}
`

const ACS_BIB = `@article{example2024,
  author  = {Example, Alex and Coauthor, Blake},
  title   = {An illustrative synthesis and characterization},
  journal = {J. Am. Chem. Soc.},
  year    = {2024},
  volume  = {146},
  pages   = {10000--10010},
}
`

// ── Elsevier (Acta Materialia, J. Power Sources, Electrochim. Acta) ──
// Mimics `elsarticle`'s front-matter structure with author/affiliation
// cross-references and a keywords block.
const ELSEVIER_MAIN = `% Elsevier scaffold (elsarticle-style: Acta Mater., J. Power Sources,
% J. Alloys Compd., Electrochim. Acta, etc.).
% For final submission, switch to \\documentclass[3p]{elsarticle}
% (elsarticle bundle) on a full TeX Live distribution.
\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath, amssymb}
\\usepackage{graphicx}
\\usepackage[numbers,sort&compress]{natbib}
\\usepackage{caption}

\\title{Title of the manuscript}
\\author{First Author$^{a}$, Second Author$^{a,b}$,
  Corresponding Author$^{a,*}$}
\\date{\\small $^{a}$Affiliation one, City, Country \\\\
  $^{b}$Affiliation two, City, Country \\\\
  $^{*}$Corresponding author. E-mail: corresponding@example.org}

\\begin{document}
\\maketitle

\\begin{abstract}
\\noindent Structured abstract (\\textasciitilde200 words): background,
objective, methods, principal result, and conclusion. No citations or
undefined abbreviations.
\\end{abstract}

\\noindent\\textbf{Keywords:} keyword one; keyword two; keyword three

\\section{Introduction}
Motivate the study and cite the key prior work~\\cite{example2024}.

\\section{Materials and methods}
\\subsection{Sample preparation}
Describe the synthesis or sourcing.
\\subsection{Characterization}
List instruments and acquisition conditions.
\\subsection{Data analysis}
Describe fitting / refinement / statistical procedures.

\\section{Results}
Present observations grouped by technique (Fig.~\\ref{fig:results}).

\\begin{figure}[t]
  \\centering
  % \\includegraphics[width=0.8\\linewidth]{figures/results}
  \\caption{Principal experimental result.}
  \\label{fig:results}
\\end{figure}

\\section{Discussion}
Interpret the results, compare with literature, and state the
implications.

\\section{Conclusions}
\\begin{itemize}
  \\item Key finding one.
  \\item Key finding two.
  \\item Broader implication.
\\end{itemize}

\\section*{CRediT authorship contribution statement}
\\textbf{First Author:} Conceptualization, Methodology.
\\textbf{Corresponding Author:} Supervision, Writing -- review \\& editing.

\\section*{Declaration of competing interest}
The authors declare no competing financial interests.

\\section*{Acknowledgements}
Funding sources and facility access.

\\bibliographystyle{elsarticle-num}
\\bibliography{refs}

\\end{document}
`

const ELSEVIER_BIB = `@article{example2024,
  author  = {Example, Alex and Coauthor, Blake},
  title   = {An illustrative materials-science study},
  journal = {Acta Materialia},
  year    = {2024},
  volume  = {256},
  pages   = {119000},
}
`

export const LATEX_TEMPLATES: readonly LatexTemplate[] = [
  {
    id: 'nature',
    name: 'Nature family',
    description: 'Nature / Nat. Mater. / Nat. Commun. — short, single column',
    docTitle: 'Untitled (Nature)',
    payload: makePayload(NATURE_MAIN, NATURE_BIB),
  },
  {
    id: 'aps',
    name: 'APS / RevTeX',
    description: 'Phys. Rev. B / Phys. Rev. Lett. — two-column physics',
    docTitle: 'Untitled (APS)',
    payload: makePayload(APS_MAIN, APS_BIB),
  },
  {
    id: 'acs',
    name: 'ACS',
    description: 'JACS / ACS Nano / Chem. Mater. — chemistry',
    docTitle: 'Untitled (ACS)',
    payload: makePayload(ACS_MAIN, ACS_BIB),
  },
  {
    id: 'elsevier',
    name: 'Elsevier',
    description: 'Acta Mater. / J. Power Sources / J. Alloys Compd.',
    docTitle: 'Untitled (Elsevier)',
    payload: makePayload(ELSEVIER_MAIN, ELSEVIER_BIB),
  },
] as const

export function findLatexTemplate(id: string): LatexTemplate | undefined {
  return LATEX_TEMPLATES.find((t) => t.id === id)
}
