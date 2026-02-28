import { keyManager } from './keyManager';

const IV_LENGTH = 12;

export async function qAesEncrypt(plaintext) {
    if (!plaintext || plaintext.trim() === '') {
        throw new Error('QAES: Plaintext cannot be empty');
    }

    const { key: rawKey, keyId } = await keyManager.getQKDKey(32);

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        rawKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );

    const iv = new Uint8Array(IV_LENGTH);
    crypto.getRandomValues(iv);

    const encoder = new TextEncoder();
    const ciphertextBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        encoder.encode(plaintext)
    );

    return {
        ciphertext: uint8ToBase64(new Uint8Array(ciphertextBuffer)),
        iv: uint8ToBase64(iv),
        keyId,
        level: 'L2_QUANTUM_AES',
    };
}

export async function qAesEncryptWithKey(plaintext, rawKey, level = 'L2_QUANTUM_AES') {
    if (!plaintext || plaintext.trim() === '') {
        throw new Error('QAES: Plaintext cannot be empty');
    }
    if (!rawKey || rawKey.length < 32) {
        throw new Error('QAES: Key must be at least 32 bytes');
    }

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        rawKey.slice(0, 32),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );

    const iv = new Uint8Array(IV_LENGTH);
    crypto.getRandomValues(iv);

    const encoder = new TextEncoder();
    const ciphertextBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        encoder.encode(plaintext)
    );

    return {
        ciphertext: uint8ToBase64(new Uint8Array(ciphertextBuffer)),
        iv: uint8ToBase64(iv),
        level,
    };
}

export async function qAesDecrypt(ciphertext, iv, keyId) {
    try {
        const rawKey = keyManager.getKeyById(keyId);
        if (!rawKey) {
            return {
                plaintext: '',
                success: false,
                error: `QKD key '${keyId}' not found in pool. Key may have been purged.`,
            };
        }

        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            rawKey.slice(0, 32),
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        const ivBytes = base64ToUint8(iv);
        const ciphertextBytes = base64ToUint8(ciphertext);

        const plaintextBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: ivBytes },
            cryptoKey,
            ciphertextBytes
        );

        const decoder = new TextDecoder('utf-8', { fatal: true });
        return {
            plaintext: decoder.decode(plaintextBuffer),
            success: true,
        };
    } catch (err) {
        return {
            plaintext: '',
            success: false,
            error:
                err instanceof Error
                    ? err.message
                    : 'Quantum AES decryption failed — possible tampering detected',
        };
    }
}

export async function qAesDecryptWithKey(ciphertext, iv, rawKey) {
    try {
        if (!rawKey || rawKey.length < 32) {
            return {
                plaintext: '',
                success: false,
                error: 'QKD key is invalid or too short.',
            };
        }

        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            rawKey.slice(0, 32),
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        const ivBytes = base64ToUint8(iv);
        const ciphertextBytes = base64ToUint8(ciphertext);

        const plaintextBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: ivBytes },
            cryptoKey,
            ciphertextBytes
        );

        const decoder = new TextDecoder('utf-8', { fatal: true });
        return {
            plaintext: decoder.decode(plaintextBuffer),
            success: true,
        };
    } catch (err) {
        return {
            plaintext: '',
            success: false,
            error:
                err instanceof Error
                    ? err.message
                    : 'Quantum AES decryption failed — possible tampering detected',
        };
    }
}

function uint8ToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function base64ToUint8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
