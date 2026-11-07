export class ByteCollectorDeniedError extends Error {
  readonly blockReason = 'size_limit' as const
  readonly errorCode = 'response_too_large' as const

  constructor() {
    super('source exceeds byte limit')
    this.name = 'ByteCollectorDeniedError'
  }
}

export class ByteCollectorFailedError extends Error {
  readonly errorCode = 'invalid_response_chunk' as const

  constructor() {
    super('response body emitted invalid bytes')
    this.name = 'ByteCollectorFailedError'
  }
}

async function abortableNext<T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal,
): Promise<IteratorResult<T>> {
  if (!signal) return iterator.next()
  if (signal.aborted) throw signal.reason
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([iterator.next(), aborted])
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

export async function collectBoundedBytes(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const iterator = body[Symbol.asyncIterator]()
  while (true) {
    const next = await abortableNext(iterator, signal)
    if (next.done) break
    const chunk = next.value
    if (!(chunk instanceof Uint8Array)) {
      throw new ByteCollectorFailedError()
    }
    total += chunk.byteLength
    if (total > maxBytes) {
      throw new ByteCollectorDeniedError()
    }
    chunks.push(chunk)
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
