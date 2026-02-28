const POOL_STORAGE_KEY = 'qumail_qkd_pool';
const DEFAULT_POOL_SIZE = 50;
const KEY_SIZE_BYTES = 64;
const DEFAULT_QRNG_URL = 'https://qrng.anu.edu.au/API/jsonI.php';
const QRNG_MAX_LENGTH = 1024;

function getQrngUrl() {
    return import.meta.env.VITE_QRNG_URL || DEFAULT_QRNG_URL;
}

class KeyManager {
    pool = [];

    constructor() {
        this.loadPool();
        if (this.pool.length === 0) {
            void this.refillPool(DEFAULT_POOL_SIZE);
        }
    }

    loadPool() {
        try {
            const raw = sessionStorage.getItem(POOL_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                this.pool = parsed.map(k => ({
                    ...k,
                    bytes: new Uint8Array(k.bytes),
                }));
            }
        } catch {
            this.pool = [];
        }
    }

    savePool() {
        const serializable = this.pool.map(k => ({
            ...k,
            bytes: Array.from(k.bytes),
        }));
        sessionStorage.setItem(POOL_STORAGE_KEY, JSON.stringify(serializable));
    }

    async fetchQuantumBytes(byteLength) {
        const chunks = [];
        let remaining = byteLength;

        while (remaining > 0) {
            const nextLength = Math.min(QRNG_MAX_LENGTH, remaining);
            const params = new URLSearchParams({
                length: String(nextLength),
                type: 'uint8',
            });

            const response = await fetch(`${getQrngUrl()}?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`QRNG request failed with status ${response.status}`);
            }

            const payload = await response.json();
            const arr = payload?.data;
            if (!Array.isArray(arr) || arr.length !== nextLength) {
                throw new Error('QRNG response format invalid');
            }

            chunks.push(...arr);
            remaining -= nextLength;
        }

        return new Uint8Array(chunks);
    }

    generateFallbackKey() {
        const bytes = new Uint8Array(KEY_SIZE_BYTES);
        crypto.getRandomValues(bytes);
        return {
            id: crypto.randomUUID(),
            bytes,
            createdAt: Date.now(),
            used: false,
            source: 'local-csprng',
        };
    }

    async generateQKDKey() {
        try {
            const bytes = await this.fetchQuantumBytes(KEY_SIZE_BYTES);
            return {
                id: crypto.randomUUID(),
                bytes,
                createdAt: Date.now(),
                used: false,
                source: 'quantum-qrng',
            };
        } catch {
            return this.generateFallbackKey();
        }
    }

    async refillPool(count = DEFAULT_POOL_SIZE) {
        const added = [];
        for (let i = 0; i < count; i++) {
            const key = await this.generateQKDKey();
            this.pool.push(key);
            added.push(key);
        }
        this.savePool();
        return added;
    }

    async getQKDKey(byteLength) {
        let available = this.pool.find(k => !k.used && k.bytes.length >= byteLength);
        if (!available) {
            await this.refillPool(DEFAULT_POOL_SIZE);
            available = this.pool.find(k => !k.used && k.bytes.length >= byteLength);
        }
        if (!available) {
            throw new Error('QKD_KEY_EXHAUSTED: No quantum keys remaining in pool. Refill required.');
        }
        available.used = true;
        this.savePool();
        return {
            key: available.bytes.slice(0, byteLength),
            keyId: available.id,
        };
    }

    getKeyById(keyId) {
        const found = this.pool.find(k => k.id === keyId);
        return found ? found.bytes : null;
    }

    generateLocalKey(byteLength) {
        const key = new Uint8Array(byteLength);
        crypto.getRandomValues(key);
        return key;
    }

    getPoolStatus() {
        const total = this.pool.length;
        const used = this.pool.filter(k => k.used).length;
        const remaining = total - used;
        const healthPercent = total > 0 ? Math.round((remaining / total) * 100) : 0;
        const quantum = this.pool.filter(k => k.source === 'quantum-qrng').length;
        const fallback = this.pool.filter(k => k.source !== 'quantum-qrng').length;
        return { total, used, remaining, healthPercent, quantum, fallback };
    }

    resetPool() {
        this.pool = [];
        sessionStorage.removeItem(POOL_STORAGE_KEY);
    }
}

export const keyManager = new KeyManager();
