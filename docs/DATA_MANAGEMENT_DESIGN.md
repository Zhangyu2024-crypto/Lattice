# Lattice Data Management — Product Design Report

> Lattice is a desktop application for AI-assisted materials-science spectroscopy.
> This document defines the data management subsystem that organizes, indexes,
> and relates every research artifact a scientist produces during a study.

---

## 1. Problem Statement

A typical materials-science research cycle generates heterogeneous data:

| Category | Examples | Volume per project |
|----------|----------|--------------------|
| **Spectra** | XRD patterns, XPS survey/high-res scans, Raman spectra, FTIR absorbance | 50 - 500 files |
| **Analysis results** | Peak fits, phase identifications, quantifications, curve fits | 1 per spectrum |
| **Computed data** | DFT outputs, molecular dynamics trajectories, Python notebooks | 10 - 50 files |
| **Images** | SEM/TEM micrographs, EDS maps, optical microscopy, AFM topography | 20 - 200 files |
| **Literature** | PDF papers, BibTeX entries, reading notes, annotation layers | 10 - 100 files |
| **Crystal structures** | CIF files, POSCAR, XYZ coordinates | 5 - 30 files |
| **Reports & notes** | Markdown drafts, LaTeX manuscripts, experiment logs | 5 - 20 files |

Today these files live in ad-hoc folder trees. Scientists manually maintain spreadsheets
or lab notebooks to track which spectrum belongs to which sample, under what conditions
it was measured, and how it relates to a published paper. **This is error-prone, unsearchable,
and breaks whenever a file is renamed or moved.**

Lattice's Data Management layer solves this by providing:

1. A **sample-centric** organizational model that mirrors the researcher's mental model
2. **Automatic metadata extraction** from spectra and documents
3. **Rich cross-references** between spectra, analyses, images, papers, and structures
4. **Faceted search & filtering** across all data types
5. **Non-destructive** — the file system remains the source of truth; metadata is a sidecar index

---

## 2. Design Principles

| Principle | Rationale |
|-----------|-----------|
| **File-first** | All data lives as plain files in the workspace directory. The index (`.lattice/data-index.json`) is derived and rebuildable. If the index is deleted, files are intact. |
| **Sample-centric** | In materials science, the fundamental unit of work is the *sample* (a specific material preparation). Everything else — spectra, images, analyses, papers — attaches to a sample. |
| **Zero-config start** | Dropping files into a folder should be enough. The system auto-detects spectrum types, extracts PDF metadata, and classifies images by extension. Manual tagging is optional enrichment. |
| **Progressive enrichment** | Users start with auto-detected metadata. Over time they add sample assignments, tags, experiment conditions, and literature links. Nothing is mandatory. |
| **Non-modal** | Data management is a standalone floating window (not a sidebar tab). It persists across main-window navigation and can be repositioned independently — similar to a database browser in an IDE. |

---

## 3. Data Model

### 3.1 Core Entities

```
                    ┌──────────────┐
                    │   Project    │  (= workspace root folder)
                    └──────┬───────┘
                           │ 1:N
                    ┌──────┴───────┐
                    │    Sample    │  id, name, formula, preparation,
                    │              │  tags[], notes, createdAt
                    └──────┬───────┘
                           │ 1:N
              ┌────────────┼────────────┐
              │            │            │
       ┌──────┴──────┐ ┌──┴───┐ ┌──────┴──────┐
       │  Spectrum    │ │Image │ │  Structure  │
       │  .spectrum   │ │.png  │ │  .cif       │
       │  .json       │ │.tiff │ │             │
       └──────┬───────┘ └──────┘ └─────────────┘
              │ 1:N
       ┌──────┴───────┐
       │  Analysis    │  .xrd.json / .xps.json / .peakfit.json / ...
       └──────────────┘

       Cross-references (M:N):
       ─ Spectrum  ↔  Paper      (measured property cited in publication)
       ─ Analysis  ↔  Paper      (result compared against literature)
       ─ Sample    ↔  Paper      (sample described in publication)
       ─ Spectrum  ↔  Image      (SEM of the same region as Raman map)
       ─ Structure ↔  Spectrum   (CIF used for XRD phase matching)
```

### 3.2 Sample

The central organizing unit. Represents a physical material specimen.

```typescript
interface Sample {
  id: string                    // sam-<uuid8>
  name: string                  // "BaTiO3 sol-gel 900C 2h"
  formula?: string              // "BaTiO₃"
  preparation?: string          // "Sol-gel, calcined at 900°C for 2h in air"
  substrate?: string            // "Si(100) wafer"
  morphology?: string           // "Nanoparticles, ~50nm diameter"
  tags: string[]                // ["perovskite", "ferroelectric", "batch-2024-03"]
  notes: string                 // Free-form markdown
  files: string[]               // relPaths of all associated files
  createdAt: number
  updatedAt: number
}
```

### 3.3 File Metadata (per-file sidecar)

```typescript
interface FileMeta {
  // Classification
  sampleId?: string
  dataType: 'spectrum' | 'analysis' | 'image' | 'paper' | 'structure' | 'compute' | 'report' | 'note' | 'other'
  technique?: string            // "XRD" | "XPS" | "Raman" | "FTIR" | "SEM" | "TEM" | "EDS" | "AFM" | ...

  // Tags
  tags: string[]                // ["todo", "anomalous", "published"]
  rating?: 1 | 2 | 3 | 4 | 5   // Quick quality rating

  // Experiment conditions (spectrum-specific)
  experimentConditions?: {
    instrument?: string         // "Rigaku MiniFlex 600"
    radiation?: string          // "Cu-Kα (1.5406 Å)"
    voltage?: string            // "40 kV"
    current?: string            // "15 mA"
    scanRange?: string          // "10-80° 2θ"
    stepSize?: string           // "0.02°"
    dwellTime?: string          // "0.5 s/step"
    temperature?: string        // "25°C" | "77K"
    atmosphere?: string         // "Air" | "N₂" | "Vacuum"
    laserWavelength?: string    // "532 nm" (Raman)
    laserPower?: string         // "5 mW"
    passEnergy?: string         // "20 eV" (XPS)
    spotSize?: string           // "400 μm" (XPS)
  }

  // Image-specific
  imageInfo?: {
    magnification?: string      // "50,000×"
    acceleratingVoltage?: string // "15 kV" (SEM)
    detector?: string           // "SE" | "BSE" | "InLens"
    scalebar?: string           // "200 nm"
  }

  // Paper-specific (auto-extracted from PDF metadata)
  paperInfo?: {
    title?: string
    authors?: string
    year?: number
    doi?: string
    journal?: string
    abstract?: string
  }

  // Cross-references
  linkedFiles: string[]         // relPaths of related files (bidirectional)
  linkedPapers: string[]        // relPaths of related papers

  // Timestamps
  importedAt: number
  lastViewedAt?: number
}
```

### 3.4 Persistence: `.lattice/data-index.json`

```json
{
  "version": 1,
  "samples": {
    "sam-a1b2c3d4": {
      "name": "BaTiO3 sol-gel 900C",
      "formula": "BaTiO3",
      "tags": ["perovskite"],
      "files": ["raw/batio3-xrd.spectrum.json", "images/batio3-sem-50k.png"]
    }
  },
  "tags": ["perovskite", "published", "todo", "anomalous"],
  "fileMeta": {
    "raw/batio3-xrd.spectrum.json": {
      "sampleId": "sam-a1b2c3d4",
      "dataType": "spectrum",
      "technique": "XRD",
      "tags": ["published"],
      "experimentConditions": { "radiation": "Cu-Ka", "scanRange": "10-80 2theta" },
      "linkedFiles": ["analysis/batio3-phases.xrd.json"],
      "linkedPapers": ["papers/smith2024.pdf"]
    },
    "images/batio3-sem-50k.png": {
      "sampleId": "sam-a1b2c3d4",
      "dataType": "image",
      "technique": "SEM",
      "imageInfo": { "magnification": "50000x", "detector": "SE" },
      "tags": []
    }
  }
}
```

---

## 4. Auto-Detection Engine

### 4.1 File Type Classification

| Extension | dataType | technique (auto) |
|-----------|----------|------------------|
| `.spectrum.json` | spectrum | from `payload.spectrumType` |
| `.xrd.json` `.xps.json` `.raman.json` `.peakfit.json` `.curve.json` | analysis | from filename |
| `.cif` | structure | — |
| `.pdf` | paper | — |
| `.png` `.jpg` `.jpeg` `.tiff` `.tif` `.bmp` `.svg` | image | from EXIF or filename hint |
| `.py` | compute | — |
| `.md` `.tex` `.latex.json` | report | — |
| `.chat.json` | note | — |
| `.workbench.json` | analysis | from `payload.workbenchKind` |

### 4.2 PDF Metadata Extraction

When a `.pdf` file is added, automatically:
1. Read PDF metadata via `pdfjs.getDocument().getMetadata()` → title, author, subject, keywords, creation date
2. If DOI found in metadata or first-page text → resolve via CrossRef API for full bibliographic data
3. Populate `fileMeta.paperInfo` automatically

### 4.3 Image Metadata Extraction

When an image file is added:
1. Read EXIF data (if JPEG/TIFF) for instrument info
2. Parse filename conventions common in SEM/TEM software (e.g., `Sample_001_SE_50kx.tif`)
3. Detect scale bars via simple heuristics (horizontal line near bottom of image)

### 4.4 Spectrum Auto-Linking

When a new analysis file (e.g., `.xrd.json`) is created by the backend or agent:
1. Check `envelope.meta.sourceFile` → link to source spectrum
2. Inherit `sampleId` from source spectrum
3. Auto-tag as the same technique

---

## 5. User Interface

### 5.1 Standalone Window

Data Management opens as an **independent floating window** (`alwaysOnTop`, `parent: mainWindow`).
Triggered by the Database icon at the bottom of the Activity Bar.

### 5.2 Layout

```
┌─ Data Management ─────────────────────────────────────────────────────────┐
│                                                                            │
│  ┌─ Toolbar ──────────────────────────────────────────────────────────┐   │
│  │ 🔍 [Search files, samples, tags...]  [Group: Sample ▼]            │   │
│  │ [Technique ▼] [Tags ▼] [Type ▼] [Rating ▼]  | 📊 Stats ▾        │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌─ Main Panel ───────────────────────┐ ┌─ Detail Panel ──────────────┐  │
│  │                                     │ │                             │  │
│  │  ▾ BaTiO₃ sol-gel 900°C    (5)     │ │  ── Sample Info ──          │  │
│  │    📊 batio3-xrd.spectrum   [XRD]  │ │  Name: BaTiO3 sol-gel 900C  │  │
│  │    📊 batio3-xps.spectrum   [XPS]  │ │  Formula: BaTiO₃            │  │
│  │    🖼️ batio3-sem-50k.png   [SEM]  │ │  Preparation: Sol-gel...    │  │
│  │    📈 batio3-phases.xrd     [XRD]  │ │  Tags: [perovskite] [+]     │  │
│  │    📎 smith2024.pdf                │ │                             │  │
│  │                                     │ │  ── File Properties ──      │  │
│  │  ▾ Fe₂O₃ nanoparticles     (3)     │ │  Technique: XRD             │  │
│  │    📊 fe2o3-raman.spectrum [Raman] │ │  Instrument: MiniFlex 600   │  │
│  │    🖼️ fe2o3-tem.tiff      [TEM]   │ │  Radiation: Cu-Kα           │  │
│  │    📈 fe2o3-peaks.peakfit          │ │  Range: 10-80° 2θ           │  │
│  │                                     │ │  Rating: ★★★★☆             │  │
│  │  ▾ Unassigned               (8)     │ │                             │  │
│  │    📊 unknown.spectrum              │ │  ── Linked Files ──         │  │
│  │    📄 draft.md                      │ │  📈 batio3-phases.xrd      │  │
│  │    🖼️ overview.png                 │ │  📎 smith2024.pdf           │  │
│  │    ...                              │ │  🖼️ batio3-sem-50k.png    │  │
│  │                                     │ │  [+ Link File]              │  │
│  └─────────────────────────────────────┘ └─────────────────────────────┘  │
│                                                                            │
│  ┌─ Footer ──────────────────────────────────────────────────────────┐   │
│  │ 12 spectra | 8 analyses | 5 images | 3 papers | 4 samples        │   │
│  │ [+ New Sample]  [Import Files...]  [Export Index...]              │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Main Panel — Group Views

| View | Primary grouping | Secondary sort | Icon semantics |
|------|-----------------|----------------|----------------|
| **By Sample** | Sample name → files | Technique, then name | Default. Shows material hierarchy. |
| **By Technique** | XRD / XPS / Raman / FTIR / SEM / TEM / Other → files | Sample, then date | Useful when comparing across samples |
| **By Type** | Spectra / Analyses / Images / Papers / Structures / Other → files | Technique, then name | Overview of data composition |
| **By Tag** | Tag name → files (file can appear in multiple groups) | Name | For workflow states (todo, done, anomalous) |
| **By Date** | YYYY-MM → files | Name | Chronological view |
| **By Folder** | Directory path → files | Name | Raw filesystem view |

### 5.4 Detail Panel

Appears when a file or sample is selected in the main panel. Two modes:

**Sample mode** (click sample header):
- Editable fields: name, formula, preparation method, substrate, morphology, notes
- Read-only: file count by type, creation date
- Actions: Rename, Delete, Merge with another sample, Export sample bundle

**File mode** (click file row):
- File info: name, path, size, modified date, dataType, technique
- Editable: sample assignment (dropdown), tags (chip input), rating (star widget)
- Experiment conditions: key-value editor (technique-specific presets)
- Image info: magnification, voltage, detector (image files only)
- Paper info: title, authors, DOI, year (PDF files only, auto-populated)
- Linked files: list + "Link File" picker
- Actions: Open, Reveal in OS, Copy Path, Remove from Sample, Delete

### 5.5 Context Menu (right-click)

**On file row:**
- Open
- Open in New Window (spectra/PDF)
- Assign to Sample → submenu of existing samples + "New Sample..."
- Add Tags → tag picker popover
- Set Rating → 1-5 star submenu
- Link to File → file picker
- Properties (opens detail panel)
- Reveal in OS
- Copy Path
- Delete

**On sample header:**
- Rename
- Edit Properties
- Add Files → file picker
- Batch Analyze → run pipeline on all sample spectra
- Export as ZIP
- Delete Sample (files stay, only removes grouping)

### 5.6 Search

Real-time client-side fuzzy matching across:
- File name
- Sample name
- Sample formula
- Tags
- Paper title / authors / DOI
- Experiment conditions values
- Notes content

Results highlight the matched field. Matching is case-insensitive, diacritics-normalized.

### 5.7 Drag & Drop

- **File → Sample group**: assigns file to that sample
- **File → File**: creates bidirectional link
- **External file → window**: imports into workspace + opens assign-to-sample dialog
- **File → trash zone**: removes from sample (not from disk)

---

## 6. Image Support

### 6.1 Image File Types

Supported: `.png`, `.jpg`, `.jpeg`, `.tiff`, `.tif`, `.bmp`, `.svg`, `.webp`

### 6.2 Image Preview

In the main panel, image files show a **thumbnail** (48x48) alongside the filename.
Clicking opens a lightweight image viewer in the detail panel:
- Zoom (scroll wheel)
- Pan (drag)
- Fit to view / 1:1 pixel
- Basic measurement tool (click two points → distance in pixels)

### 6.3 Image Metadata

SEM/TEM images often embed metadata in:
- EXIF tags (JEOL, FEI/ThermoFisher instruments)
- Filename conventions (`SampleName_Mag_Detector.tif`)
- Embedded scale bar text (OCR-extractable in future versions)

The data manager reads available metadata and populates `imageInfo` fields.

### 6.4 Image-Spectrum Correlation

Users can link an image to a spectrum (e.g., "this SEM image shows the region
where Raman was measured"). This appears in both the image's and spectrum's
detail panels under "Linked Files."

---

## 7. Computed Data Support

### 7.1 File Types

- `.py` — Python scripts (DFT input generators, post-processing)
- `.lammps` / `.in` — LAMMPS input files
- `.cp2k` — CP2K input files
- Output files: `.out`, `.log`, `.dat`, `.csv`

### 7.2 Compute Metadata

```typescript
computeInfo?: {
  software?: string       // "VASP" | "Gaussian" | "LAMMPS" | "CP2K" | "Python"
  method?: string         // "DFT-PBE" | "MD-NVT" | "TDDFT"
  basis?: string          // "PW (500 eV)" | "6-311G(d,p)"
  runtime?: string        // "4h 23min on 32 cores"
  convergence?: string    // "SCF converged in 45 cycles"
}
```

### 7.3 Linking

Computed results (e.g., simulated XRD pattern) can be linked to:
- The experimental spectrum for comparison
- The CIF structure used as input
- The paper describing the method

---

## 8. Import & Export

### 8.1 Import

| Source | Method | Auto-detection |
|--------|--------|----------------|
| Local files | Drag & drop into window, or "Import Files" button | Extension → dataType + technique |
| Folder scan | "Import Directory" → recursively scan, skip duplicates | Same + folder name as sample hint |
| Instrument export | Drop `.raw` / `.brml` / `.spc` / `.wdf` → auto-convert to `.spectrum.json` | Instrument metadata extraction |
| BibTeX | Drop `.bib` → create paper entries | Full bibliographic data |
| ZIP bundle | Drop `.zip` exported from another Lattice workspace | Full metadata preservation |

### 8.2 Export

| Format | Content | Use case |
|--------|---------|----------|
| **ZIP bundle** | Selected files + `data-index.json` subset + folder structure | Share with collaborator |
| **CSV manifest** | Spreadsheet of all files with metadata columns | Lab inventory / ELN integration |
| **BibTeX** | All linked papers | Manuscript bibliography |
| **JSON** | Full `data-index.json` | Programmatic access / backup |

---

## 9. Statistics Dashboard

Collapsible section at the top of the main panel. Shows at a glance:

```
┌─ Overview ──────────────────────────────────────────────────────────────┐
│                                                                          │
│  📊 Spectra: 47          📈 Analyses: 32        🖼️ Images: 23          │
│    XRD: 18  XPS: 15       Peak fits: 18          SEM: 12  TEM: 8       │
│    Raman: 10  FTIR: 4     Phase ID: 8            Other: 3              │
│                            Quantification: 6                            │
│                                                                          │
│  📎 Papers: 12           🔬 Structures: 7       💻 Compute: 5          │
│                                                                          │
│  🧪 Samples: 8           🏷️ Tags: 14           ⭐ Rated: 31/120       │
│    Assigned: 89/120 (74%)  Most used: "published" (23)                  │
│                                                                          │
│  ┌─ Technique Distribution ──┐  ┌─ Recent Activity ─────────────────┐  │
│  │  XRD  ████████████  38%   │  │  Today: 3 files added             │  │
│  │  XPS  █████████     31%   │  │  Yesterday: 7 files, 2 analyses   │  │
│  │  Raman ██████       21%   │  │  This week: 23 files total        │  │
│  │  FTIR  ███          10%   │  │                                   │  │
│  └───────────────────────────┘  └───────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Future Roadmap

| Phase | Feature | Priority |
|-------|---------|----------|
| **v1.0** | Sample CRUD, file metadata, tags, search, group views, stats bar | Current |
| **v1.1** | Image thumbnails & preview, image metadata extraction | High |
| **v1.2** | PDF auto-metadata extraction (pdfjs + CrossRef) | High |
| **v1.3** | Drag & drop import + external file conversion (.raw → .spectrum.json) | Medium |
| **v1.4** | Export (ZIP bundle, CSV manifest, BibTeX) | Medium |
| **v2.0** | Detail panel (sample editor + file properties + experiment conditions) | High |
| **v2.1** | Star rating + quality flags | Low |
| **v2.2** | Batch operations (tag all, assign all, analyze all) | Medium |
| **v3.0** | Full-text search (index PDF text + notes content) | Medium |
| **v3.1** | Timeline view (activity over time) | Low |
| **v3.2** | Collaboration (export/import with metadata preservation) | Low |
| **v4.0** | ELN (Electronic Lab Notebook) integration | Future |

---

## 11. Technical Implementation Notes

### Storage
- **Index file**: `.lattice/data-index.json` — single JSON, debounce-written on every change
- **No database required** — suitable for 100-1000 files; if scale demands it, migrate to SQLite later
- **File watcher** (chokidar) detects external adds/removes and auto-updates the index

### State Management
- `data-index-store.ts` (Zustand) — loads index on workspace open, auto-saves on mutation
- Derived computations (grouped lists, filtered results, stats) are memoized selectors

### Window Architecture
- Standalone `BrowserWindow` with route `#/data-manager`
- Shares the same preload + IPC channels as the main window
- Reads workspace root from persisted config (`workspace-root.json`)
- Independent store instances (not shared with main window); consistency via file watcher

### Performance Targets
- Index load: < 50ms for 1000 files
- Search: < 16ms (single frame) for 1000 entries
- Group/filter: < 16ms with memoized selectors
- Thumbnail generation: lazy, cached to `.lattice/thumbnails/`
