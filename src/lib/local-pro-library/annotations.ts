// Annotations (P3 v3) — local, persistent IPC wrappers.

import type {
  AddAnnotationRequest,
  AddAnnotationResponse,
  DeleteAnnotationResponse,
  PaperAnnotationsResponse,
  UpdateAnnotationRequest,
  UpdateAnnotationResponse,
} from '../../types/library-api'
import { normalizeAnnotation, requireIpc } from './helpers'

export async function listAnnotations(
  paperId: number,
): Promise<PaperAnnotationsResponse> {
  const fn = requireIpc('libraryListAnnotations')
  const result = await fn(paperId)
  return result.annotations.map(normalizeAnnotation)
}

export async function addAnnotation(
  paperId: number,
  req: AddAnnotationRequest,
): Promise<AddAnnotationResponse> {
  const fn = requireIpc('libraryAddAnnotation')
  const result = await fn(paperId, {
    page: req.page,
    type: req.type ?? 'note',
    color: req.color ?? '#D4D4D4',
    content: req.content ?? '',
    rects: req.rects ?? [],
  })
  if (result.success) return { success: true, id: result.id }
  return { success: false, error: result.error }
}

export async function updateAnnotation(
  annId: number,
  req: UpdateAnnotationRequest,
): Promise<UpdateAnnotationResponse> {
  const fn = requireIpc('libraryUpdateAnnotation')
  const result = await fn(annId, {
    page: req.page,
    color: req.color,
    content: req.content,
    rects: req.rects,
  })
  return { success: result.success }
}

export async function deleteAnnotation(
  annId: number,
): Promise<DeleteAnnotationResponse> {
  const fn = requireIpc('libraryDeleteAnnotation')
  const result = await fn(annId)
  return { success: result.success }
}
