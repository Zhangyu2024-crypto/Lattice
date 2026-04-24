import type { ArtifactId, ArtifactKind } from './artifact'
import type { MentionElementKind } from './mention'

export type DbEntryId = string
export type CollectionId = string

export interface DbElementRef {
  elementKind: MentionElementKind
  elementId: string
  label: string
}

export interface DbEntry {
  id: DbEntryId
  sourceArtifactKind: ArtifactKind
  element?: DbElementRef
  title: string
  payload: unknown

  source: {
    sessionId: string
    artifactId: ArtifactId
    sessionTitle: string
    sourceFile?: string | null
  }

  tags: string[]
  rating?: 1 | 2 | 3 | 4 | 5
  notes: string
  collectionIds: CollectionId[]

  createdAt: number
  updatedAt: number
  payloadSizeEstimate: number
}

export interface DbCollection {
  id: CollectionId
  name: string
  description: string
  color?: string
  createdAt: number
  updatedAt: number
}

export interface DbFilter {
  search: string
  tags: string[]
  artifactKinds: ArtifactKind[]
  elementKinds: MentionElementKind[]
  collectionIds: CollectionId[]
  rating: number | null
  sortBy: 'createdAt' | 'updatedAt' | 'title' | 'rating'
  sortOrder: 'asc' | 'desc'
}

export interface DbIndexEntry {
  id: DbEntryId
  sourceArtifactKind: ArtifactKind
  element?: { elementKind: MentionElementKind; label: string }
  title: string
  tags: string[]
  rating?: number
  collectionIds: CollectionId[]
  createdAt: number
  updatedAt: number
  payloadSizeEstimate: number
}

export interface DbIndexRoot {
  version: 1
  entries: DbIndexEntry[]
  collections: DbCollection[]
  globalTags: string[]
}

export const EMPTY_DB_FILTER: DbFilter = {
  search: '',
  tags: [],
  artifactKinds: [],
  elementKinds: [],
  collectionIds: [],
  rating: null,
  sortBy: 'createdAt',
  sortOrder: 'desc',
}
