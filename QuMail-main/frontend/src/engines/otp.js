export function otpEncrypt(plaintext) {
    if (!plaintext || plaintext.trim() === '') {
        throw new Error('OTP: Plaintext cannot be empty');
    }

    const encoder = new TextEncoder();
    const plaintextBytes = encoder.encode(plaintext);
    const n = plaintextBytes.length;

    const keyBytes = new Uint8Array(n);
    crypto.getRandomValues(keyBytes);

    const ciphertextBytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        ciphertextBytes[i] = plaintextBytes[i] ^ keyBytes[i];
    }

    return {
        ciphertext: uint8ToBase64(ciphertextBytes),
        key: uint8ToBase64(keyBytes),
        keyLengthBytes: n,
        plaintextLengthBytes: n,
        level: 'L1_OTP',
    };
}

export function otpDecrypt(ciphertext, key) {
    try {
        const ciphertextBytes = base64ToUint8(ciphertext);
        const keyBytes = base64ToUint8(key);

        if (ciphertextBytes.length !== keyBytes.length) {
            return {
                plaintext: '',
                success: false,
                error: `Key length (${keyBytes.length} bytes) must equal ciphertext length (${ciphertextBytes.length} bytes)`,
            };
        }

        const plaintextBytes = new Uint8Array(ciphertextBytes.length);
        for (let i = 0; i < ciphertextBytes.length; i++) {
            plaintextBytes[i] = ciphertextBytes[i] ^ keyBytes[i];
        }

        const decoder = new TextDecoder('utf-8', { fatal: true });
        const plaintext = decoder.decode(plaintextBytes);

        return { plaintext, success: true };
    } catch (err) {
        return {
            plaintext: '',
            success: false,
            error: err instanceof Error ? err.message : 'Decryption failed',
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
