export type BusytexBundle =
  | 'texlive-basic'
  | 'latex-base'
  | 'fonts-recommended'
  | 'latex-recommended'
  | 'latex-extra'
  | 'science'

export type BundleLoadStatus = 'preloaded' | 'lazy' | 'unavailable'

export interface PackageRegistryEntry {
  name: string
  bundle: BusytexBundle | null
  description: string
  category?: string
}

const PRELOADED: ReadonlySet<BusytexBundle> = new Set([
  'texlive-basic',
  'latex-base',
  'fonts-recommended',
])

const LAZY: ReadonlySet<BusytexBundle> = new Set([
  'latex-recommended',
  'latex-extra',
  'science',
])

export function getBundleStatus(bundle: BusytexBundle | null): BundleLoadStatus {
  if (bundle === null) return 'unavailable'
  if (PRELOADED.has(bundle)) return 'preloaded'
  if (LAZY.has(bundle)) return 'lazy'
  return 'unavailable'
}

type E = [name: string, bundle: BusytexBundle | null, description: string, category?: string]

const DATA: E[] = [
  // --- texlive-basic (preloaded) ---
  ['babel', 'texlive-basic', 'Multilingual support', 'i18n'],
  ['iftex', 'texlive-basic', 'Conditionals for TeX engine detection', 'utility'],
  ['graphics', 'texlive-basic', 'Standard graphics inclusion', 'graphics'],
  ['graphicx', 'texlive-basic', 'Enhanced graphics inclusion with key-value options', 'graphics'],
  ['color', 'texlive-basic', 'Foreground and background colour management', 'graphics'],
  ['xcolor', 'texlive-basic', 'Extended colour facilities (68+ named colours)', 'graphics'],
  ['hyperref', 'texlive-basic', 'Hyperlinks, bookmarks, and PDF metadata', 'utility'],
  ['url', 'texlive-basic', 'Verbatim URLs and hyperlinks', 'utility'],
  ['geometry', 'texlive-basic', 'Page layout and margin control', 'formatting'],
  ['pdftexcmds', 'texlive-basic', 'pdfTeX primitives as LaTeX macros', 'utility'],
  ['kvoptions', 'texlive-basic', 'Key-value options for packages', 'utility'],
  ['kvsetkeys', 'texlive-basic', 'Key-value parsing utilities', 'utility'],
  ['kvdefinekeys', 'texlive-basic', 'Key definition utilities', 'utility'],
  ['etoolbox', 'texlive-basic', 'LaTeX kernel patching and programming tools', 'utility'],
  ['ltxcmds', 'texlive-basic', 'LaTeX kernel command variants', 'utility'],
  ['infwarerr', 'texlive-basic', 'Warning and error message macros', 'utility'],
  ['pgf', 'texlive-basic', 'Portable graphics format — base layer for TikZ', 'graphics'],
  ['tikz', 'texlive-basic', 'Programmable vector graphics', 'graphics'],
  ['xkeyval', 'texlive-basic', 'Extended key-value interface', 'utility'],
  ['bookmark', 'texlive-basic', 'PDF bookmark management', 'utility'],
  ['epstopdf', 'texlive-basic', 'Convert EPS to PDF on the fly', 'graphics'],
  ['oberdiek', 'texlive-basic', 'Bundle of small utility packages', 'utility'],
  ['amsfonts', 'texlive-basic', 'AMS mathematical fonts', 'math'],
  ['tools', 'texlive-basic', 'Standard LaTeX tools bundle', 'utility'],

  // --- latex-base (preloaded) ---
  ['amsmath', 'latex-base', 'AMS mathematical typesetting', 'math'],
  ['amssymb', 'latex-base', 'AMS extra mathematical symbols', 'math'],
  ['amsthm', 'latex-base', 'AMS theorem environment', 'math'],
  ['amstext', 'latex-base', 'Text fragments in math mode', 'math'],
  ['amsopn', 'latex-base', 'AMS operator name definitions', 'math'],
  ['amscd', 'latex-base', 'Commutative diagrams', 'math'],
  ['amsbsy', 'latex-base', 'Bold math symbols', 'math'],
  ['inputenc', 'latex-base', 'Input encoding selection (utf8, latin1, etc.)', 'encoding'],
  ['fontenc', 'latex-base', 'Font encoding selection (T1, OT1, etc.)', 'encoding'],
  ['textcomp', 'latex-base', 'Text companion symbols (euro, bullet, etc.)', 'fonts'],
  ['makeidx', 'latex-base', 'Standard index generation', 'utility'],
  ['ifthen', 'latex-base', 'Conditional commands', 'utility'],
  ['alltt', 'latex-base', 'Verbatim-like environment preserving backslash', 'formatting'],
  ['flafter', 'latex-base', 'Float placement after reference point', 'formatting'],
  ['exscale', 'latex-base', 'Scaled versions of CM math extension font', 'fonts'],
  ['fix-cm', 'latex-base', 'Fix Computer Modern font substitutions', 'fonts'],
  ['syntonly', 'latex-base', 'Syntax-check without output', 'utility'],
  ['latexsym', 'latex-base', 'LaTeX symbol font definitions', 'math'],
  ['array', 'latex-base', 'Extended column specification for tables', 'tables'],
  ['tabularx', 'latex-base', 'Tables with auto-width X columns', 'tables'],
  ['longtable', 'latex-base', 'Multi-page tables', 'tables'],
  ['dcolumn', 'latex-base', 'Decimal-point aligned table columns', 'tables'],
  ['hhline', 'latex-base', 'Customisable horizontal rules in tables', 'tables'],
  ['delarray', 'latex-base', 'Delimiters around arrays', 'tables'],
  ['multirow', 'latex-base', 'Multi-row cells in tables', 'tables'],
  ['multicol', 'latex-base', 'Multi-column text layout', 'formatting'],
  ['varioref', 'latex-base', 'Smart cross-references ("on the next page")', 'utility'],
  ['showkeys', 'latex-base', 'Show label and ref keys in margin', 'utility'],
  ['afterpage', 'latex-base', 'Execute command after current page ships out', 'formatting'],
  ['calc', 'latex-base', 'Arithmetic in LaTeX length/counter expressions', 'utility'],
  ['rawfonts', 'latex-base', 'Low-level font access', 'fonts'],
  ['trace', 'latex-base', 'Selective tracing of TeX commands', 'utility'],

  // --- fonts-recommended (preloaded) ---
  ['lmodern', 'fonts-recommended', 'Latin Modern fonts (improved Computer Modern)', 'fonts'],
  ['psnfss', 'fonts-recommended', 'PostScript font selection scheme', 'fonts'],
  ['mathptmx', 'fonts-recommended', 'Times Roman in text and math', 'fonts'],
  ['helvet', 'fonts-recommended', 'Helvetica as default sans-serif', 'fonts'],
  ['courier', 'fonts-recommended', 'Courier as default monospace', 'fonts'],
  ['palatino', 'fonts-recommended', 'Palatino as default serif', 'fonts'],
  ['bookman', 'fonts-recommended', 'Bookman as default serif', 'fonts'],
  ['avant', 'fonts-recommended', 'Avant Garde as default sans-serif', 'fonts'],
  ['chancery', 'fonts-recommended', 'Zapf Chancery as default serif', 'fonts'],
  ['newcent', 'fonts-recommended', 'New Century Schoolbook', 'fonts'],
  ['charter', 'fonts-recommended', 'Charter font family', 'fonts'],
  ['utopia', 'fonts-recommended', 'Utopia font family', 'fonts'],
  ['cm-super', 'fonts-recommended', 'CM-Super Type 1 fonts', 'fonts'],
  ['ec', 'fonts-recommended', 'European Computer Modern fonts', 'fonts'],

  // --- latex-recommended (lazy) ---
  ['beamer', 'latex-recommended', 'Presentation slides with themes and overlays', 'formatting'],
  ['xspace', 'latex-recommended', 'Smart spacing after macros', 'utility'],
  ['anysize', 'latex-recommended', 'Simple margin settings', 'formatting'],
  ['metalogo', 'latex-recommended', 'Typeset TeX engine logos', 'utility'],
  ['fancyhdr', 'latex-recommended', 'Custom headers and footers', 'formatting'],
  ['natbib', 'latex-recommended', 'Flexible author-year and numeric citations', 'bibliography'],
  ['scrextend', 'latex-recommended', 'KOMA-Script extensions for standard classes', 'formatting'],
  ['typearea', 'latex-recommended', 'KOMA-Script page layout', 'formatting'],
  ['scrlayer-scrpage', 'latex-recommended', 'KOMA-Script headers/footers', 'formatting'],
  ['float', 'latex-recommended', 'Improved float placement (H specifier)', 'formatting'],
  ['caption', 'latex-recommended', 'Customise figure/table captions', 'formatting'],
  ['subfig', 'latex-recommended', 'Sub-figures with separate captions', 'formatting'],
  ['thumbpdf', 'latex-recommended', 'Thumbnails for PDF output', 'utility'],
  ['translations', 'latex-recommended', 'Internationalisation framework', 'i18n'],

  // --- latex-extra (lazy) ---
  ['enumitem', 'latex-extra', 'Customise list environments', 'formatting'],
  ['booktabs', 'latex-extra', 'Publication-quality table rules', 'tables'],
  ['listings', 'latex-extra', 'Source code listings', 'code'],
  ['minted', 'latex-extra', 'Syntax-highlighted code via Pygments', 'code'],
  ['fancyvrb', 'latex-extra', 'Sophisticated verbatim environments', 'code'],
  ['todonotes', 'latex-extra', 'Margin and inline TODO annotations', 'utility'],
  ['csquotes', 'latex-extra', 'Context-sensitive quotation marks', 'formatting'],
  ['microtype', 'latex-extra', 'Microtypographic enhancements (tracking, protrusion)', 'formatting'],
  ['titlesec', 'latex-extra', 'Customise section headings', 'formatting'],
  ['titletoc', 'latex-extra', 'Customise table of contents entries', 'formatting'],
  ['tocloft', 'latex-extra', 'Control ToC, LoF, LoT formatting', 'formatting'],
  ['appendix', 'latex-extra', 'Extra control over appendix formatting', 'formatting'],
  ['parskip', 'latex-extra', 'Paragraph skip instead of indent', 'formatting'],
  ['setspace', 'latex-extra', 'Line spacing control (single, 1.5, double)', 'formatting'],
  ['footmisc', 'latex-extra', 'Customise footnote layout', 'formatting'],
  ['xstring', 'latex-extra', 'String manipulation macros', 'utility'],
  ['etex', 'latex-extra', 'e-TeX extensions', 'utility'],
  ['soul', 'latex-extra', 'Letterspacing, underlining, striking out', 'formatting'],
  ['ulem', 'latex-extra', 'Underline and strikeout', 'formatting'],
  ['pdfpages', 'latex-extra', 'Include full PDF pages', 'graphics'],
  ['pdflscape', 'latex-extra', 'Landscape pages in PDF', 'formatting'],
  ['lscape', 'latex-extra', 'Landscape pages', 'formatting'],
  ['rotating', 'latex-extra', 'Rotation of floats and text', 'formatting'],
  ['wrapfig', 'latex-extra', 'Text wrapping around figures', 'formatting'],
  ['subcaption', 'latex-extra', 'Sub-figure/table captions', 'formatting'],
  ['cleveref', 'latex-extra', 'Intelligent cross-referencing', 'utility'],
  ['placeins', 'latex-extra', 'Float barriers to control placement', 'formatting'],
  ['mdframed', 'latex-extra', 'Framed environments with page breaks', 'formatting'],
  ['tcolorbox', 'latex-extra', 'Coloured boxes with breakable support', 'formatting'],
  ['adjustbox', 'latex-extra', 'Box adjustment macros (trim, clip, scale)', 'graphics'],
  ['changepage', 'latex-extra', 'Change page layout mid-document', 'formatting'],
  ['ifdraft', 'latex-extra', 'Draft/final conditional compilation', 'utility'],
  ['comment', 'latex-extra', 'Block comment environments', 'utility'],
  ['xifthen', 'latex-extra', 'Extended conditional commands', 'utility'],
  ['environ', 'latex-extra', 'Collect environment body', 'utility'],
  ['threeparttable', 'latex-extra', 'Table notes within table width', 'tables'],
  ['makecell', 'latex-extra', 'Multi-line table cells', 'tables'],
  ['colortbl', 'latex-extra', 'Coloured table rows and columns', 'tables'],
  ['arydshln', 'latex-extra', 'Dashed lines in tables', 'tables'],
  ['diagbox', 'latex-extra', 'Diagonal box for table headers', 'tables'],

  // --- science (lazy) ---
  ['siunitx', 'science', 'SI units and number formatting', 'science'],
  ['algorithm', 'science', 'Float wrapper for algorithms', 'science'],
  ['algorithm2e', 'science', 'Typeset algorithms with if/while/for', 'science'],
  ['algorithmicx', 'science', 'Flexible algorithm layout', 'science'],
  ['algpseudocode', 'science', 'Pseudocode style for algorithmicx', 'science'],
  ['chemformula', 'science', 'Chemical formula typesetting', 'science'],
  ['mhchem', 'science', 'Chemical equations (\\ce{H2O})', 'science'],
  ['physics', 'science', 'Physics notation (bra-ket, derivatives)', 'science'],
  ['braket', 'science', 'Dirac bra-ket notation', 'science'],
  ['tensor', 'science', 'Tensor index notation', 'science'],
  ['feynmp', 'science', 'Feynman diagrams', 'science'],
  ['mathtools', 'science', 'Extensions and fixes for amsmath', 'math'],
  ['bm', 'science', 'Bold math symbols (improved \\boldsymbol)', 'math'],
  ['empheq', 'science', 'Emphasised equations', 'math'],
  ['cancel', 'science', 'Cancellation marks in math', 'math'],
  ['cases', 'science', 'Numbered case environment', 'math'],
  ['accents', 'science', 'Custom math accents', 'math'],
  ['diffcoeff', 'science', 'Typeset differential coefficients', 'math'],
  ['nicematrix', 'science', 'Enhanced matrix environments with TikZ', 'math'],
  ['bodeplot', 'science', 'Bode and Nyquist diagrams with pgfplots', 'science'],
  ['pgfplots', 'science', 'Publication-quality plots from data', 'graphics'],
  ['pgfplotstable', 'science', 'Tables from data files', 'tables'],

  // --- not in any bundle ---
  ['biblatex', null, 'Modern bibliography management (requires biber — not available)', 'bibliography'],
  ['fontspec', null, 'OpenType/TrueType font selection (requires XeTeX/LuaTeX)', 'fonts'],
  ['unicode-math', null, 'Unicode maths (requires XeTeX/LuaTeX)', 'math'],
  ['polyglossia', null, 'Multilingual support for XeTeX/LuaTeX', 'i18n'],
  ['luacode', null, 'Execute Lua code (requires LuaTeX)', 'utility'],
]

const REGISTRY = new Map<string, PackageRegistryEntry>()
for (const [name, bundle, description, category] of DATA) {
  REGISTRY.set(name, { name, bundle, description, category })
}

export function lookupPackage(name: string): PackageRegistryEntry | undefined {
  return REGISTRY.get(name.toLowerCase())
}

let catalogCache: readonly PackageRegistryEntry[] | null = null

export function getPackageCatalog(): readonly PackageRegistryEntry[] {
  if (!catalogCache) {
    catalogCache = Array.from(REGISTRY.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }
  return catalogCache
}
