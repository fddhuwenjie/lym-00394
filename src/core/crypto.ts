import type { ZipFileEntry } from '@/types'
import { COMPRESSION_METHOD, ZIP_FLAG_BITS, AES_MODES } from './constants'

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c
  }
  return table
})()

export function crc32(data: Uint8Array, crc: number = 0): number {
  crc = crc ^ 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
  }
  return crc ^ 0xFFFFFFFF
}

export function crc32Combine(crc1: number, crc2: number, len2: number): number {
  const gf2MatrixTimes = (mat: Uint32Array[], vec: number): number => {
    let result = 0
    let i = 0
    while (vec) {
      if (vec & 1) result ^= mat[i][0]
      vec >>>= 1
      i++
    }
    return result
  }

  const gf2MatrixSquare = (square: Uint32Array[], mat: Uint32Array[]): void => {
    for (let n = 0; n < 32; n++) {
      square[n][0] = gf2MatrixTimes(mat, mat[n][0])
    }
  }

  if (len2 === 0) return crc1

  const row = [new Uint32Array(1), new Uint32Array(1)]
  row[0][0] = 1
  row[1][0] = 0

  const mat: Uint32Array[] = []
  for (let n = 0; n < 32; n++) {
    mat.push(new Uint32Array(1))
  }
  mat[0][0] = 0xEDB88320

  for (let n = 1; n < 32; n++) {
    mat[n][0] = 1 << (n - 1)
  }

  let len = len2 >>> 0
  do {
    const square: Uint32Array[] = []
    for (let n = 0; n < 32; n++) {
      square.push(new Uint32Array(1))
    }
    gf2MatrixSquare(square, mat)
    if (len & 1) {
      row[0][0] = gf2MatrixTimes(square, row[0][0])
    }
    len >>>= 1
    if (len) {
      gf2MatrixSquare(mat, square)
    }
  } while (len)

  const odd = [new Uint32Array(1), new Uint32Array(1)]
  odd[0][0] = row[0][0]
  odd[1][0] = row[1][0]

  return gf2MatrixTimes(odd, crc1) ^ crc2
}

export class ZipCrypto {
  private key0: number = 0x12345678
  private key1: number = 0x23456789
  private key2: number = 0x34567890

  constructor(password: string) {
    this.initKeys(password)
  }

  private initKeys(password: string): void {
    this.key0 = 0x12345678
    this.key1 = 0x23456789
    this.key2 = 0x34567890
    for (let i = 0; i < password.length; i++) {
      this.updateKeys(password.charCodeAt(i) & 0xFF)
    }
  }

  private updateKeys(byteValue: number): void {
    this.key0 = crc32(new Uint8Array([byteValue]), this.key0)
    this.key1 = (this.key1 + (this.key0 & 0xFF)) & 0xFFFFFFFF
    this.key1 = Math.imul(this.key1, 0x08088405)
    this.key1 = (this.key1 + 1) & 0xFFFFFFFF
    this.key2 = crc32(new Uint8Array([(this.key1 >>> 24) & 0xFF]), this.key2)
  }

  private streamByte(): number {
    const tmp = this.key2 | 2
    return (Math.imul(tmp, tmp ^ 1) >>> 8) & 0xFF
  }

  encrypt(data: Uint8Array): Uint8Array {
    const result = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i++) {
      const c = this.streamByte()
      result[i] = data[i] ^ c
      this.updateKeys(result[i])
    }
    return result
  }

  decrypt(data: Uint8Array): Uint8Array {
    const result = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i++) {
      const c = this.streamByte()
      result[i] = data[i] ^ c
      this.updateKeys(result[i])
    }
    return result
  }

  encryptChunked(data: Uint8Array): Uint8Array {
    return this.encrypt(data)
  }

  decryptChunked(data: Uint8Array): Uint8Array {
    return this.decrypt(data)
  }
}

export interface AESContext {
  key: CryptoKey
  iv: Uint8Array
  counter: bigint
  encryptionMode: 'cbc' | 'ctr'
}

export interface AESEncryptionHeader {
  salt: Uint8Array
  pwdVerify: Uint8Array
}

export interface AESEncryptionResult {
  data: Uint8Array
  authCode: Uint8Array
  header: AESEncryptionHeader
}

export async function deriveAESKeyFromPassword(
  password: string,
  salt: Uint8Array,
  keySize: number = 32,
  iterations: number = 1000
): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const passwordData = encoder.encode(password)

  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordData,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-1'
    },
    baseKey,
    { name: 'AES-CTR', length: keySize * 8 },
    true,
    ['encrypt', 'decrypt']
  )
}

export async function deriveAESKeysWinZip(
  password: string,
  salt: Uint8Array,
  keySize: number = 32
): Promise<{ key: CryptoKey; pwdVerifyValue: Uint8Array }> {
  const encoder = new TextEncoder()
  const passwordBytes = encoder.encode(password)

  const hmacSHA1 = async (keyData: Uint8Array, data: Uint8Array): Promise<Uint8Array> => {
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, data)
    return new Uint8Array(signature)
  }

  const passwordVerifierSize = 2
  const totalKeyingMaterialSize = keySize * 2 + passwordVerifierSize

  let derivedKey: Uint8Array = new Uint8Array(totalKeyingMaterialSize)
  let counter = 0

  let blockNumber = 1
  let offset = 0

  while (offset < totalKeyingMaterialSize) {
    const blockNumberBytes = new Uint8Array(4)
    blockNumberBytes[0] = (blockNumber >> 24) & 0xFF
    blockNumberBytes[1] = (blockNumber >> 16) & 0xFF
    blockNumberBytes[2] = (blockNumber >> 8) & 0xFF
    blockNumberBytes[3] = blockNumber & 0xFF

    let intermediateDigest = await hmacSHA1(passwordBytes, new Uint8Array([
      ...blockNumberBytes,
      ...salt
    ]))

    for (counter = 1; counter <= 999; counter++) {
      const prevDigest = intermediateDigest
      intermediateDigest = await hmacSHA1(passwordBytes, prevDigest)
    }

    for (let i = 0; i < intermediateDigest.length && offset < totalKeyingMaterialSize; i++, offset++) {
      derivedKey[offset] = intermediateDigest[i]
    }

    blockNumber++
  }

  const encKey = derivedKey.slice(0, keySize)
  const authKey = derivedKey.slice(keySize, keySize * 2)
  const pwdVerifyValue = derivedKey.slice(keySize * 2, keySize * 2 + passwordVerifierSize)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encKey,
    { name: 'AES-CTR' },
    true,
    ['encrypt', 'decrypt']
  )

  return { key: cryptoKey, pwdVerifyValue }
}

export async function decryptAES256Stream(
  source: ReadableStream<Uint8Array>,
  password: string,
  entry: ZipFileEntry,
  onProgress?: (bytes: number) => void
): Promise<{ stream: ReadableStream<Uint8Array>; verifyPassword: () => boolean }> {
  const aesMode = AES_MODES.AES_256
  let verified = false

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
    },
    async transform(chunk, controller) {
      controller.enqueue(chunk)
      onProgress?.(chunk.length)
    }
  })

  const reader = source.getReader()
  let buffer = new Uint8Array(0)
  let readOffset = 0
  let phase = 0
  let salt: Uint8Array | null = null
  let pwdVerify: Uint8Array | null = null
  let derivedKey: CryptoKey | null = null
  let aesIvCounter: bigint = 1n
  let authDataProcessed = false
  let remainingAuthCode = aesMode.authCodeLen

  const outStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (phase === 0) {
          const needed = aesMode.saltLength
          while (buffer.length < needed) {
            const { done, value } = await reader.read()
            if (done) throw new Error('Unexpected end of stream')
            const newBuffer = new Uint8Array(buffer.length + value.length)
            newBuffer.set(buffer)
            newBuffer.set(value, buffer.length)
            buffer = newBuffer
          }
          salt = buffer.slice(0, needed)
          buffer = buffer.slice(needed)
          phase = 1
        }

        if (phase === 1) {
          const needed = aesMode.pwdVerifyLen
          while (buffer.length < needed) {
            const { done, value } = await reader.read()
            if (done) throw new Error('Unexpected end of stream')
            const newBuffer = new Uint8Array(buffer.length + value.length)
            newBuffer.set(buffer)
            newBuffer.set(value, buffer.length)
            buffer = newBuffer
          }
          pwdVerify = buffer.slice(0, needed)
          buffer = buffer.slice(needed)

          const result = await deriveAESKeysWinZip(password, salt!, aesMode.keySize)
          derivedKey = result.key
          const pwdVerifyValue = result.pwdVerifyValue

          if (pwdVerify[0] !== pwdVerifyValue[0] || pwdVerify[1] !== pwdVerifyValue[1]) {
            throw new Error('Incorrect password for AES-256 encrypted file')
          }
          verified = true
          phase = 2
        }

        if (phase === 2) {
          const compressedSize = entry.compressedSize
          const dataLen = compressedSize - aesMode.saltLength - aesMode.pwdVerifyLen - aesMode.authCodeLen

          const { done, value } = await reader.read()
          if (done) {
            phase = 3
          } else {
            const newBuffer = new Uint8Array(buffer.length + value.length)
            newBuffer.set(buffer)
            newBuffer.set(value, buffer.length)
            buffer = newBuffer
          }

          const availableDataLen = buffer.length - remainingAuthCode

          if (availableDataLen > 0) {
            const toDecrypt = Math.min(availableDataLen, buffer.length)
            const encryptedData = buffer.slice(0, toDecrypt)
            buffer = buffer.slice(toDecrypt)

            if (encryptedData.length > 0 && derivedKey) {
              const iv = new Uint8Array(16)
              const view = new DataView(iv.buffer)
              view.setBigUint64(8, aesIvCounter, true)
              aesIvCounter += BigInt(Math.ceil(encryptedData.length / 16))

              const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-CTR', counter: iv, length: 128 },
                derivedKey,
                encryptedData
              )
              const decryptedBytes = new Uint8Array(decrypted)
              onProgress?.(decryptedBytes.length)
              controller.enqueue(decryptedBytes)
            }
          }

          if (done) {
            phase = 3
          }
        }

        if (phase === 3) {
          controller.close()
        }
      } catch (e) {
        controller.error(e)
        throw e
      }
    },

    cancel(reason) {
      reader.cancel(reason)
    }
  })

  return {
    stream: outStream,
    verifyPassword: () => verified
  }
}

export async function encryptAES256Stream(
  source: ReadableStream<Uint8Array>,
  password: string
): Promise<{ stream: ReadableStream<Uint8Array> }> {
  const aesMode = AES_MODES.AES_256
  const salt = crypto.getRandomValues(new Uint8Array(aesMode.saltLength))

  const result = await deriveAESKeysWinZip(password, salt, aesMode.keySize)
  const derivedKey = result.key
  const pwdVerifyValue = result.pwdVerifyValue

  let aesIvCounter: bigint = 1n
  let headerSent = false
  const reader = source.getReader()

  const outStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        const header = new Uint8Array(aesMode.saltLength + aesMode.pwdVerifyLen)
        header.set(salt, 0)
        header.set(pwdVerifyValue, aesMode.saltLength)
        controller.enqueue(header)
        headerSent = true
      }

      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }

      const iv = new Uint8Array(16)
      const view = new DataView(iv.buffer)
      view.setBigUint64(8, aesIvCounter, true)
      aesIvCounter += BigInt(Math.ceil(value.length / 16))

      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-CTR', counter: iv, length: 128 },
        derivedKey,
        value
      )
      controller.enqueue(new Uint8Array(encrypted))
    },

    cancel(reason) {
      reader.cancel(reason)
    }
  })

  return { stream: outStream }
}

export async function decryptZipCryptoStream(
  source: ReadableStream<Uint8Array>,
  password: string,
  entry: ZipFileEntry
): Promise<{ stream: ReadableStream<Uint8Array> }> {
  const zipCrypto = new ZipCrypto(password)
  const reader = source.getReader()
  let phase = 0
  let pwdCheckBuffer = new Uint8Array(0)
  const HEADER_SIZE = 12

  const outStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (phase === 0) {
          while (pwdCheckBuffer.length < HEADER_SIZE) {
            const { done, value } = await reader.read()
            if (done) throw new Error('Unexpected end of stream')
            const newBuffer = new Uint8Array(pwdCheckBuffer.length + value.length)
            newBuffer.set(pwdCheckBuffer)
            newBuffer.set(value, pwdCheckBuffer.length)
            pwdCheckBuffer = newBuffer
          }

          const decryptedHeader = zipCrypto.decryptChunked(pwdCheckBuffer.slice(0, HEADER_SIZE))

          const lastByte = decryptedHeader[HEADER_SIZE - 1]
          const expectedByte = (entry.crc32 >>> 24) & 0xFF

          if (lastByte !== expectedByte && expectedByte !== 0) {
            if (lastByte !== ((entry.lastModified.getTime() / 2000) & 0xFF)) {
              throw new Error('Incorrect password for ZipCrypto encrypted file')
            }
          }

          pwdCheckBuffer = pwdCheckBuffer.slice(HEADER_SIZE)
          phase = 1
        }

        if (phase === 1) {
          if (pwdCheckBuffer.length > 0) {
            const decrypted = zipCrypto.decryptChunked(pwdCheckBuffer)
            controller.enqueue(decrypted)
            pwdCheckBuffer = new Uint8Array(0)
          }

          const { done, value } = await reader.read()
          if (done) {
            controller.close()
            return
          }

          const decrypted = zipCrypto.decryptChunked(value)
          controller.enqueue(decrypted)
        }
      } catch (e) {
        controller.error(e)
        throw e
      }
    },

    cancel(reason) {
      reader.cancel(reason)
    }
  })

  return { stream: outStream }
}

export async function encryptZipCryptoStream(
  source: ReadableStream<Uint8Array>,
  password: string,
  crc32Value: number
): Promise<{ stream: ReadableStream<Uint8Array> }> {
  const zipCrypto = new ZipCrypto(password)
  const reader = source.getReader()
  let headerSent = false

  const outStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        const header = crypto.getRandomValues(new Uint8Array(12))
        header[11] = (crc32Value >>> 24) & 0xFF
        const encryptedHeader = zipCrypto.encryptChunked(header)
        controller.enqueue(encryptedHeader)
        headerSent = true
      }

      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }

      const encrypted = zipCrypto.encryptChunked(value)
      controller.enqueue(encrypted)
    },

    cancel(reason) {
      reader.cancel(reason)
    }
  })

  return { stream: outStream }
}
