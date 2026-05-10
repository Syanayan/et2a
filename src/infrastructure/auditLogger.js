import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const MAX_PAYLOAD_BYTES = 200 * 1024;
const MASKED_KEYS = new Set(['token', 'authorization']);

export async function appendAuditLog({ logPath = './.kousu/logs/audit.log', entry }) {
  const timestamped = {
    timestamp: new Date().toISOString(),
    ...maskSensitive(entry ?? {}),
  };

  const sanitized = truncateIfNeeded(timestamped);
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(sanitized)}\n`, 'utf8');
}

function maskSensitive(value) {
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitive(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (MASKED_KEYS.has(key.toLowerCase())) {
        return [key, '***'];
      }
      return [key, maskSensitive(child)];
    }),
  );
}

function truncateIfNeeded(entry) {
  const payload = entry.payload;
  if (typeof payload !== 'string') {
    return entry;
  }

  const size = Buffer.byteLength(payload, 'utf8');
  if (size <= MAX_PAYLOAD_BYTES) {
    return entry;
  }

  const truncatedPayload = truncateUtf8(payload, MAX_PAYLOAD_BYTES);
  return {
    ...entry,
    payload: truncatedPayload,
    truncated: true,
  };
}

function truncateUtf8(text, maxBytes) {
  let result = '';
  let bytes = 0;

  for (const char of text) {
    const nextBytes = Buffer.byteLength(char, 'utf8');
    if (bytes + nextBytes > maxBytes) {
      break;
    }
    result += char;
    bytes += nextBytes;
  }

  return result;
}
