import { describe, expect, it } from 'vitest'
import {
  createRoomSecret,
  decryptBytes,
  deriveRoomAccessKey,
  encryptBytes,
  importDataKey,
  isEncryptedCollaborationPacket,
  keyIdForRoom,
} from './encrypted-collaboration'

describe('encrypted collaboration crypto helpers', () => {
  it('encrypts and decrypts collaboration updates without plaintext in packet fields', async () => {
    const roomName = 'latex-project:LAT-123:main.tex'
    const secret = createRoomSecret()
    const key = await importDataKey(secret, roomName)
    const kid = keyIdForRoom(roomName)
    const plaintext = new TextEncoder().encode('confidential latex source')

    const packet = await encryptBytes(plaintext, key, kid)
    expect(isEncryptedCollaborationPacket(packet)).toBe(true)
    expect(packet.kid).toBe(kid)
    expect(JSON.stringify(packet)).not.toContain('confidential')

    const restored = await decryptBytes(packet, key, kid)
    expect(new TextDecoder().decode(restored)).toBe('confidential latex source')
  })

  it('rejects packets from a different room key id', async () => {
    const secret = createRoomSecret()
    const key = await importDataKey(secret, 'room-a')
    const packet = await encryptBytes(
      new TextEncoder().encode('secret'),
      key,
      keyIdForRoom('room-a'),
    )

    await expect(decryptBytes(packet, key, keyIdForRoom('room-b'))).rejects.toThrow(
      /different room/,
    )
  })

  it('derives separate server access and document encryption material from one room key', async () => {
    const roomName = 'project:LAT-1:main.tex'
    const secret = createRoomSecret()
    const accessKey = await deriveRoomAccessKey(secret, roomName)
    const dataKey = await importDataKey(secret, roomName)
    const packet = await encryptBytes(
      new TextEncoder().encode('paper text'),
      dataKey,
      keyIdForRoom(roomName),
    )

    expect(accessKey).toMatch(/^[A-Za-z0-9_-]{32,256}$/)
    expect(accessKey).not.toBe(secret)
    expect(JSON.stringify(packet)).not.toContain(accessKey)
  })
})
