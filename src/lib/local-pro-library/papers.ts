// CRUD IPC wrappers for papers / tags / collections / stats. Thin
// pass-through — all storage lives in the main-process library IPC.

import type {
  AddPaperRequest,
  AddPaperResponse,
  AddTagResponse,
  CreateCollectionRequest,
  CreateCollectionResponse,
  DeleteCollectionResponse,
  DeletePaperResponse,
  LibraryCollectionsResponse,
  LibraryPapersQuery,
  LibraryPapersResponse,
  LibraryStats,
  LibraryTagsResponse,
  RemoveTagResponse,
} from '../../types/library-api'
import { normalizeRow, requireIpc } from './helpers'

export async function listPapers(
  query?: LibraryPapersQuery,
): Promise<LibraryPapersResponse> {
  const fn = requireIpc('libraryListPapers')
  const result = await fn({
    q: query?.q,
    tag: query?.tag,
    year: query?.year,
    collection: query?.collection,
    page: query?.page,
    limit: query?.limit,
    sort: query?.sort,
    order: query?.order,
  })
  if (result.error) throw new Error(result.error)
  return {
    papers: result.papers.map(normalizeRow),
    total: result.total,
  }
}

export async function addPaper(
  req: AddPaperRequest,
): Promise<AddPaperResponse> {
  const fn = requireIpc('libraryAddPaper')
  return await fn({
    title: req.title,
    authors: req.authors,
    year: req.year,
    doi: req.doi,
    url: req.url,
    journal: req.journal,
    abstract: req.abstract,
    notes: req.notes,
    tags: req.tags,
    collection: req.collection,
  })
}

export async function deletePaper(id: number): Promise<DeletePaperResponse> {
  const fn = requireIpc('libraryDeletePaper')
  return await fn(id)
}

export async function listTags(): Promise<LibraryTagsResponse> {
  const fn = requireIpc('libraryListTags')
  return await fn()
}

export async function addTag(
  paperId: number,
  tag: string,
): Promise<AddTagResponse> {
  const fn = requireIpc('libraryAddTag')
  return await fn(paperId, tag)
}

export async function removeTag(
  paperId: number,
  tag: string,
): Promise<RemoveTagResponse> {
  const fn = requireIpc('libraryRemoveTag')
  return await fn(paperId, tag)
}

export async function listCollections(): Promise<LibraryCollectionsResponse> {
  const fn = requireIpc('libraryListCollections')
  return await fn()
}

export async function createCollection(
  req: CreateCollectionRequest,
): Promise<CreateCollectionResponse> {
  const fn = requireIpc('libraryCreateCollection')
  return await fn({ name: req.name, description: req.description })
}

export async function deleteCollection(
  name: string,
): Promise<DeleteCollectionResponse> {
  const fn = requireIpc('libraryDeleteCollection')
  return await fn(name)
}

export async function addToCollection(
  name: string,
  paperId: number,
): Promise<{ success: boolean }> {
  const fn = requireIpc('libraryAddToCollection')
  return await fn(name, paperId)
}

export async function removeFromCollection(
  name: string,
  paperId: number,
): Promise<{ success: boolean }> {
  const fn = requireIpc('libraryRemoveFromCollection')
  return await fn(name, paperId)
}

export async function stats(): Promise<LibraryStats> {
  const fn = requireIpc('libraryStats')
  return await fn()
}
