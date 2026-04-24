type NodeCategory = 'material' | 'process' | 'property' | 'paper' | 'element'

interface KnowledgeNode {
  id: string
  label: string
  category: NodeCategory
  symbolSize?: number
  value?: number
  paperRef?: string
}

interface KnowledgeEdge {
  source: string
  target: string
  relation: string
  weight?: number
}

interface KnowledgeGraphPayload {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  stats: {
    nodeCount: number
    edgeCount: number
    categoryCounts: Record<NodeCategory, number>
  }
  query?: string
}

const RAW_NODES: Omit<KnowledgeNode, 'symbolSize'>[] = [
  // Materials
  { id: 'mat-batio3', label: 'BaTiO3', category: 'material' },
  { id: 'mat-srtio3', label: 'SrTiO3', category: 'material' },
  { id: 'mat-tio2-anatase', label: 'TiO2 (anatase)', category: 'material' },
  { id: 'mat-tio2-rutile', label: 'TiO2 (rutile)', category: 'material' },
  { id: 'mat-pbtio3', label: 'PbTiO3', category: 'material' },
  { id: 'mat-catio3', label: 'CaTiO3', category: 'material' },
  // Processes
  { id: 'proc-sol-gel', label: 'Sol-Gel', category: 'process' },
  { id: 'proc-hydrothermal', label: 'Hydrothermal', category: 'process' },
  { id: 'proc-solid-state', label: 'Solid State Reaction', category: 'process' },
  { id: 'proc-pld', label: 'Pulsed Laser Deposition', category: 'process' },
  // Properties
  { id: 'prop-bg-tio2', label: 'Bandgap 3.2 eV', category: 'property', value: 3.2 },
  { id: 'prop-bg-batio3', label: 'Bandgap 3.4 eV', category: 'property', value: 3.4 },
  { id: 'prop-ferroelectric', label: 'Ferroelectric', category: 'property' },
  { id: 'prop-piezoelectric', label: 'Piezoelectric', category: 'property' },
  { id: 'prop-dielectric', label: 'Dielectric Constant 1500', category: 'property', value: 1500 },
  { id: 'prop-photocatalytic', label: 'Photocatalytic', category: 'property' },
  // Papers
  {
    id: 'paper-merz-1953',
    label: 'Merz, Phys. Rev. 1953',
    category: 'paper',
    paperRef: '10.1103/PhysRev.91.513',
  },
  {
    id: 'paper-haertling-1999',
    label: 'Haertling, J. Am. Ceram. Soc. 1999',
    category: 'paper',
    paperRef: '10.1111/j.1151-2916.1999.tb01840.x',
  },
  {
    id: 'paper-fujishima-1972',
    label: 'Fujishima & Honda, Nature 1972',
    category: 'paper',
    paperRef: '10.1038/238037a0',
  },
  {
    id: 'paper-scott-2007',
    label: 'Scott, Science 2007',
    category: 'paper',
    paperRef: '10.1126/science.1129564',
  },
  {
    id: 'paper-chen-2007',
    label: 'Chen & Mao, Chem. Rev. 2007',
    category: 'paper',
    paperRef: '10.1021/cr0500535',
  },
  // Elements
  { id: 'el-ti', label: 'Ti', category: 'element' },
  { id: 'el-ba', label: 'Ba', category: 'element' },
  { id: 'el-o', label: 'O', category: 'element' },
]

const EDGES: KnowledgeEdge[] = [
  // material -> element (contains)
  { source: 'mat-batio3', target: 'el-ba', relation: 'contains', weight: 1 },
  { source: 'mat-batio3', target: 'el-ti', relation: 'contains', weight: 1 },
  { source: 'mat-batio3', target: 'el-o', relation: 'contains', weight: 3 },
  { source: 'mat-srtio3', target: 'el-ti', relation: 'contains', weight: 1 },
  { source: 'mat-srtio3', target: 'el-o', relation: 'contains', weight: 3 },
  { source: 'mat-tio2-anatase', target: 'el-ti', relation: 'contains', weight: 1 },
  { source: 'mat-tio2-anatase', target: 'el-o', relation: 'contains', weight: 2 },
  { source: 'mat-tio2-rutile', target: 'el-ti', relation: 'contains', weight: 1 },
  { source: 'mat-pbtio3', target: 'el-ti', relation: 'contains', weight: 1 },
  { source: 'mat-catio3', target: 'el-ti', relation: 'contains', weight: 1 },
  // material -> process (synthesized_by)
  { source: 'mat-batio3', target: 'proc-sol-gel', relation: 'synthesized_by' },
  { source: 'mat-batio3', target: 'proc-solid-state', relation: 'synthesized_by' },
  { source: 'mat-srtio3', target: 'proc-pld', relation: 'synthesized_by' },
  { source: 'mat-tio2-anatase', target: 'proc-hydrothermal', relation: 'synthesized_by' },
  { source: 'mat-tio2-rutile', target: 'proc-solid-state', relation: 'synthesized_by' },
  { source: 'mat-pbtio3', target: 'proc-sol-gel', relation: 'synthesized_by' },
  { source: 'mat-catio3', target: 'proc-solid-state', relation: 'synthesized_by' },
  // material -> property (has_property)
  { source: 'mat-batio3', target: 'prop-bg-batio3', relation: 'has_property' },
  { source: 'mat-batio3', target: 'prop-ferroelectric', relation: 'has_property' },
  { source: 'mat-batio3', target: 'prop-piezoelectric', relation: 'has_property' },
  { source: 'mat-batio3', target: 'prop-dielectric', relation: 'has_property' },
  { source: 'mat-tio2-anatase', target: 'prop-bg-tio2', relation: 'has_property' },
  { source: 'mat-tio2-anatase', target: 'prop-photocatalytic', relation: 'has_property' },
  { source: 'mat-pbtio3', target: 'prop-ferroelectric', relation: 'has_property' },
  { source: 'mat-pbtio3', target: 'prop-piezoelectric', relation: 'has_property' },
  // material -> paper (reported_in)
  { source: 'mat-batio3', target: 'paper-merz-1953', relation: 'reported_in' },
  { source: 'mat-batio3', target: 'paper-haertling-1999', relation: 'reported_in' },
  { source: 'mat-tio2-anatase', target: 'paper-fujishima-1972', relation: 'reported_in' },
  { source: 'mat-tio2-anatase', target: 'paper-chen-2007', relation: 'reported_in' },
  { source: 'mat-pbtio3', target: 'paper-scott-2007', relation: 'reported_in' },
]

function computeDegrees(): Record<string, number> {
  const deg: Record<string, number> = {}
  for (const n of RAW_NODES) deg[n.id] = 0
  for (const e of EDGES) {
    deg[e.source] = (deg[e.source] ?? 0) + 1
    deg[e.target] = (deg[e.target] ?? 0) + 1
  }
  return deg
}

function sizeFor(degree: number): number {
  return Math.max(20, Math.min(40, 18 + degree * 2.2))
}

function buildPayload(): KnowledgeGraphPayload {
  const degrees = computeDegrees()
  const nodes: KnowledgeNode[] = RAW_NODES.map((n) => ({
    ...n,
    symbolSize: sizeFor(degrees[n.id] ?? 0),
  }))
  const categoryCounts: Record<NodeCategory, number> = {
    material: 0,
    process: 0,
    property: 0,
    paper: 0,
    element: 0,
  }
  for (const n of nodes) categoryCounts[n.category] += 1
  return {
    nodes,
    edges: EDGES,
    stats: {
      nodeCount: nodes.length,
      edgeCount: EDGES.length,
      categoryCounts,
    },
    query: undefined,
  }
}

export const DEMO_KNOWLEDGE_GRAPH: KnowledgeGraphPayload = buildPayload()
