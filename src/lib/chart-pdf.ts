// Minimal single-page PDF generator that embeds a JPEG chart image.
// No external dependencies — builds the PDF byte stream directly from
// the DCTDecode (JPEG) spec so the raw JPEG bytes go in unmodified.

const enc = new TextEncoder()

export function chartImageToPdf(
  jpegBytes: Uint8Array,
  imgWidth: number,
  imgHeight: number,
  pageWidth: number,
  pageHeight: number,
): Blob {
  const chunks: Uint8Array[] = []
  let pos = 0

  const emit = (text: string) => {
    const buf = enc.encode(text)
    chunks.push(buf)
    pos += buf.length
  }
  const emitRaw = (buf: Uint8Array) => {
    chunks.push(buf)
    pos += buf.length
  }

  const offsets: number[] = []
  const startObj = () => {
    offsets.push(pos)
  }

  emit('%PDF-1.4\n')
  emitRaw(new Uint8Array([0x25, 0xc0, 0xc0, 0xc0, 0xc0, 0x0a]))

  startObj()
  emit('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  startObj()
  emit('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')

  startObj()
  emit(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Contents 4 0 R ` +
      `/Resources << /XObject << /Img 5 0 R >> >> >>\nendobj\n`,
  )

  const stream = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Img Do Q`
  startObj()
  emit(
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  )

  startObj()
  emit(
    `5 0 obj\n<< /Type /XObject /Subtype /Image ` +
      `/Width ${imgWidth} /Height ${imgHeight} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
      `/Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
  )
  emitRaw(jpegBytes)
  emit('\nendstream\nendobj\n')

  const xrefOffset = pos
  const count = offsets.length + 1
  emit(`xref\n0 ${count}\n`)
  emit('0000000000 65535 f \n')
  for (const off of offsets) {
    emit(`${String(off).padStart(10, '0')} 00000 n \n`)
  }
  emit(
    `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  )

  return new Blob(chunks, { type: 'application/pdf' })
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const match = /^data:[^;]+;base64,(.*)$/.exec(dataUrl)
  if (!match) throw new Error('Invalid data URL')
  const raw = atob(match[1])
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
  return buf
}
