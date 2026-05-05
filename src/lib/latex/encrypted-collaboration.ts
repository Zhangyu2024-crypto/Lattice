import * as Y from 'yjs'

export interface EncryptedCollaborationPacket {
  v: 1
  alg: 'AES-GCM'
  kid: string
  iv: string
  ct: string
}

const KEY_BYTES = 32
const IV_BYTES = 12
const ACCESS_INFO = 'lattice:latex:room-access:v1'
const DATA_INFO = 'lattice:latex:data-key:v1'

export function createRoomSecret(): string {
  const bytes = randomBytes(KEY_BYTES)
  return base64UrlEncode(bytes)
}

export async function deriveRoomAccessKey(
  roomSecret: string,
  roomName: string,
): Promise<string> {
  const bits = await deriveBits(roomSecret, roomName, ACCESS_INFO)
  return base64UrlEncode(bits)
}

export function keyIdForRoom(roomName: string): string {
  return `latx_${stableHash(roomName).slice(0, 16)}`
}

export async function importDataKey(
  roomSecret: string,
  roomName: string,
): Promise<CryptoKey> {
  if (!crypto.subtle) {
    throw new Error('Web Crypto is unavailable in this runtime.')
  }
  const keyBytes = await deriveBits(roomSecret, roomName, DATA_INFO)
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

async function deriveBits(
  roomSecret: string,
  roomName: string,
  info: string,
): Promise<Uint8Array> {
  if (!crypto.subtle) {
    throw new Error('Web Crypto is unavailable in this runtime.')
  }
  const encoder = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    secretBytes(roomSecret),
    'HKDF',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(`lattice:latex:${roomName}`),
      info: encoder.encode(info),
    },
    baseKey,
    KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

export async function encryptBytes(
  plaintext: Uint8Array,
  key: CryptoKey,
  kid: string,
): Promise<EncryptedCollaborationPacket> {
  const iv = randomBytes(IV_BYTES)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  )
  return {
    v: 1,
    alg: 'AES-GCM',
    kid,
    iv: base64UrlEncode(iv),
    ct: base64UrlEncode(ct),
  }
}

export async function decryptBytes(
  packet: EncryptedCollaborationPacket,
  key: CryptoKey,
  expectedKid: string,
): Promise<Uint8Array> {
  if (!isEncryptedCollaborationPacket(packet) || packet.kid !== expectedKid) {
    throw new Error('Collaboration packet was encrypted for a different room.')
  }
  const iv = base64UrlDecode(packet.iv)
  const ciphertext = base64UrlDecode(packet.ct)
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext),
  )
}

export function isEncryptedCollaborationPacket(
  value: unknown,
): value is EncryptedCollaborationPacket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const packet = value as Partial<EncryptedCollaborationPacket>
  return (
    packet.v === 1 &&
    packet.alg === 'AES-GCM' &&
    typeof packet.kid === 'string' &&
    packet.kid.length > 0 &&
    isBase64Url(packet.iv) &&
    isBase64Url(packet.ct)
  )
}

export function encodeDocumentState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc)
}

function randomBytes(length: number): Uint8Array {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random generation is unavailable in this runtime.')
  }
  return cryptoApi.getRandomValues(new Uint8Array(length))
}

function secretBytes(roomSecret: string): Uint8Array {
  const bytes = base64UrlDecode(roomSecret.trim())
  if (bytes.length < KEY_BYTES) {
    throw new Error('Collaboration room secret is too short.')
  }
  return bytes
}

function isBase64Url(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)
}

function stableHash(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0').repeat(2)
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  )
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}
