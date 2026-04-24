// Streaming SHA-256 hasher — matches the digest format used by lattice-cli's
// `sync/manifest.py::_hash_file`. The CLI truncates to the first 16 hex
// characters to keep manifests small; we do the same so manifests written by
// either side are byte-identical for the same file content.

import { createHash } from 'crypto'
import { createReadStream } from 'fs'

/** Returns `sha256:<hex16>` for the given file, streaming it chunk by chunk.
 *  Errors are wrapped so callers can decide whether to skip or abort. */
export async function hashFile(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(absPath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => {
      const hex = hash.digest('hex').slice(0, 16)
      resolve(`sha256:${hex}`)
    })
  })
}
