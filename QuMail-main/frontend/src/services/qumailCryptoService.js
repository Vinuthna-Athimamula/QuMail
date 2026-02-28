import { base64ToUint8, qAesDecrypt, qAesDecryptWithKey } from '../engines/quantumAes';
import { aesDecrypt } from '../engines/aes';
import { readQkdChunkService } from './qkdService';

function getMessageContent(message) {
  return (message?.payload?.body_text || message?.snippet || '').trim();
}

export function decodeHtmlEntities(value) {
  if (!value) {
    return '';
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(value, 'text/html');
  return doc.documentElement.textContent || '';
}

export function getSenderDisplayName(message) {
  const fromRaw = (message?.from_raw || '').trim();
  const fromEmail = (message?.from_email || '').trim();

  if (!fromRaw) {
    return fromEmail || 'Unknown Sender';
  }

  const match = fromRaw.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  if (match?.[1]) {
    return decodeHtmlEntities(match[1].trim());
  }

  const noAngles = fromRaw.replace(/<[^>]+>/g, '').trim();
  if (noAngles && noAngles !== fromEmail) {
    return decodeHtmlEntities(noAngles);
  }

  return fromEmail || decodeHtmlEntities(fromRaw) || 'Unknown Sender';
}

export function getSenderLine(message) {
  const display = getSenderDisplayName(message);
  const email = (message?.from_email || '').trim();
  if (email && email !== display) {
    return `${display} <${email}>`;
  }
  return display;
}

export function getAvatarLetter(message) {
  const text = getSenderDisplayName(message);
  return (text[0] || 'U').toUpperCase();
}

function extractField(content, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`${escaped}\\s*:\\s*([A-Za-z0-9+/=_-]+)`, 'i'));
  return match?.[1]?.trim() || '';
}

function extractSecurityLevel(content) {
  const match = content.match(/Security-Level\s*:\s*([A-Za-z0-9_\-]+)/i);
  return match?.[1]?.trim() || '';
}

export function parseQuMailEncryptedPayload(message) {
  const content = getMessageContent(message);
  const securityLevel = extractSecurityLevel(content);
  const ciphertext = extractField(content, 'Ciphertext(Base64)');
  const iv = extractField(content, 'IV(Base64)');
  const keyId = extractField(content, 'QKD-Key-Id');
  const sessionId = extractField(content, 'QKD-Session-Id');
  const offsetRaw = extractField(content, 'QKD-Offset');
  const sizeRaw = extractField(content, 'QKD-Size');
  const salt = extractField(content, 'Salt(Base64)');
  const offset = Number.parseInt(offsetRaw || '-1', 10);
  const chunkSize = Number.parseInt(sizeRaw || '0', 10);

  const isAes = Boolean(ciphertext && iv && salt) || /L4_AES/i.test(securityLevel);
  const isQuantum = Boolean(ciphertext && iv && keyId) || /L2_QUANTUM_AES/i.test(securityLevel);
  const isEncrypted = Boolean(ciphertext && iv && (isAes || isQuantum));

  return {
    isEncrypted,
    securityLevel,
    mode: isAes ? 'aes' : isQuantum ? 'quantum' : '',
    requiresPassphrase: isAes,
    ciphertext,
    iv,
    salt,
    keyId,
    sessionId,
    offset,
    chunkSize,
  };
}

export async function decryptQuMailMessage(message, user, passphrase = '') {
  const parsed = parseQuMailEncryptedPayload(message);
  if (!parsed.isEncrypted) {
    return {
      success: false,
      plaintext: '',
      error: 'This message is not a QuMail encrypted message.',
    };
  }

  if (parsed.mode === 'aes') {
    if (!parsed.salt) {
      return {
        success: false,
        plaintext: '',
        error: 'Missing AES salt in QuMail metadata.',
      };
    }
    if (!passphrase) {
      return {
        success: false,
        plaintext: '',
        error: 'Passphrase is required to decrypt this QuMail message.',
      };
    }
    return aesDecrypt(parsed.ciphertext, parsed.iv, parsed.salt, passphrase);
  }

  if (!parsed.keyId) {
    return {
      success: false,
      plaintext: '',
      error: 'Missing QKD key id in QuMail metadata.',
    };
  }

  if (user?.id && parsed.sessionId && parsed.offset >= 0 && parsed.chunkSize > 0) {
    try {
      const chunk = await readQkdChunkService(user, parsed.sessionId, parsed.offset, parsed.chunkSize);
      const chunkB64 = chunk?.chunk_b64 || '';
      if (!chunkB64) {
        return {
          success: false,
          plaintext: '',
          error: 'QKD key chunk is missing from backend session.',
        };
      }
      return qAesDecryptWithKey(parsed.ciphertext, parsed.iv, base64ToUint8(chunkB64));
    } catch (error) {
      return {
        success: false,
        plaintext: '',
        error: error instanceof Error ? error.message : 'Failed to fetch QKD chunk from backend session.',
      };
    }
  }

  const result = await qAesDecrypt(parsed.ciphertext, parsed.iv, parsed.keyId);
  return result;
}

export function getMessagePreviewBody(message) {
  const text = decodeHtmlEntities(getMessageContent(message));
  return text || 'Open message in Gmail for full body preview.';
}

export function getMaskedPreviewBody(message) {
  const parsed = parseQuMailEncryptedPayload(message);
  if (parsed.isEncrypted) {
    return 'Encrypted QuMail message. Use Decrypt to view content.';
  }
  return getMessagePreviewBody(message);
}

export function getProtectedBodyPlaceholder(message) {
  const parsed = parseQuMailEncryptedPayload(message);
  if (!parsed.isEncrypted) {
    return getMessagePreviewBody(message);
  }
  return parsed.requiresPassphrase
    ? 'This QuMail AES message is protected. Enter passphrase and click Decrypt.'
    : 'This QuMail message is protected. Click Decrypt to view content.';
}

export function getMessageHtmlBody(message) {
  return (message?.payload?.body_html || '').trim();
}

export function buildEmailHtmlDoc(rawHtml) {
  const content = rawHtml || '';
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base target="_blank" />
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff !important; color: #111827 !important; }
      body { padding: 12px; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
      a { color: #1d4ed8; }
    </style>
  </head>
  <body>${content}</body>
</html>`;
}
