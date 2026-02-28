const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

export async function aesEncrypt(plaintext, password) {
    if (!plaintext || plaintext.trim() === '') {
        throw new Error('AES: Plaintext cannot be empty');
    }
    if (!password || password.length < 1) {
        throw new Error('AES: Password cannot be empty');
    }

    const encoder = new TextEncoder();

    const salt = new Uint8Array(SALT_LENGTH);
    crypto.getRandomValues(salt);

    const iv = new Uint8Array(IV_LENGTH);
    crypto.getRandomValues(iv);

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    const aesKey = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: KEY_LENGTH_BITS },
        false,
        ['encrypt']
    );

    const ciphertextBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        encoder.encode(plaintext)
    );

    return {
        ciphertext: uint8ToBase64(new Uint8Array(ciphertextBuffer)),
        iv: uint8ToBase64(iv),
        salt: uint8ToBase64(salt),
        level: 'L4_AES',
    };
}

export async function aesDecrypt(ciphertext, iv, salt, password) {
    try {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder('utf-8', { fatal: true });

        const ivBytes = base64ToUint8(iv);
        const saltBytes = base64ToUint8(salt);
        const ciphertextBytes = base64ToUint8(ciphertext);

        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        const aesKey = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: saltBytes,
                iterations: PBKDF2_ITERATIONS,
                hash: 'SHA-256',
            },
            keyMaterial,
            { name: 'AES-GCM', length: KEY_LENGTH_BITS },
            false,
            ['decrypt']
        );

        const plaintextBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: ivBytes },
            aesKey,
            ciphertextBytes
        );

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
                    ? err.message.includes('operation-specific')
                        ? 'Decryption failed: wrong password or tampered data'
                        : err.message
                    : 'Decryption failed',
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

function base64ToUint8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
