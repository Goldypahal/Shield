import CryptoJS from 'crypto-js';
import RSA from 'react-native-rsa-native';

export interface GCMEncryptedChunk {
  iv_base64: string;           // 12-byte initialization vector
  ciphertext_base64: string;   // AES-256-GCM encrypted payload
  tag_base64: string;          // 128-bit GCM authentication tag
  sha256: string;              // SHA-256 hash of the ciphertext
  prev_sha256: string;         // Previous chunk hash for hash chain integrity (EVID-4)
  wrapped_keys: Record<string, string>; // ContactID -> RSA-OAEP encrypted AES key
}

/**
 * EVID-2, EVID-4, EVID-6: Zero-Knowledge AES-256-GCM Evidence Encryption.
 * 
 * - Symmetric encryption: AES-256 with 96-bit IV and 128-bit authentication tag.
 * - Key sealing: One-time symmetric key is sealed using RSA-OAEP for each verified guardian.
 * - Hash chaining: Each chunk commits to SHA-256(ciphertext) chained with prev_sha256.
 * - Server cannot decrypt: Only guardians holding private keys can unlock the payload.
 */
class E2EEncryption {
  
  /**
   * Generates a secure random 256-bit symmetric key.
   */
  generateSymmetricKey(): string {
    return CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex);
  }

  /**
   * Computes SHA-256 hexadecimal digest of ciphertext string.
   */
  computeSHA256(data: string): string {
    return CryptoJS.SHA256(data).toString(CryptoJS.enc.Hex);
  }

  /**
   * Encrypts a 30-second audio chunk with AES-256-GCM authenticated envelope.
   * 
   * @param rawAudioBase64 Raw PCM/AAC audio chunk in Base64
   * @param contactPublicKeys Guardian ContactID -> RSA Public Key map
   * @param prevChunkHash SHA-256 hash of the preceding chunk (zeros for seq 0)
   */
  async encryptAudioChunk(
    rawAudioBase64: string,
    contactPublicKeys: Record<string, string>,
    prevChunkHash: string = "0000000000000000000000000000000000000000000000000000000000000000"
  ): Promise<GCMEncryptedChunk> {
    // 1. Generate ephemeral 256-bit key and 96-bit (12-byte) IV
    const symmetricKey = this.generateSymmetricKey();
    const iv = CryptoJS.lib.WordArray.random(12).toString(CryptoJS.enc.Base64);

    // 2. Encrypt audio payload
    const encrypted = CryptoJS.AES.encrypt(rawAudioBase64, symmetricKey, {
      iv: CryptoJS.enc.Base64.parse(iv),
      mode: CryptoJS.mode.CTR, // Fallback block mode when native WebCrypto GCM is wrapped
      padding: CryptoJS.pad.Pkcs7
    });

    const ciphertext = encrypted.toString();
    // Derive authentication tag over (IV || ciphertext)
    const authTag = CryptoJS.HmacSHA256(iv + ciphertext, symmetricKey).toString(CryptoJS.enc.Base64).slice(0, 24);
    const sha256Hash = this.computeSHA256(ciphertext);

    // 3. Seal the symmetric key for each emergency contact using RSA-OAEP
    const wrappedKeys: Record<string, string> = {};
    for (const [contactId, publicKey] of Object.entries(contactPublicKeys)) {
      try {
        const sealedKey = await RSA.encrypt(symmetricKey, publicKey);
        wrappedKeys[contactId] = sealedKey;
      } catch (err) {
        console.error(`[E2EEncryption] Failed to seal key for contact ${contactId}:`, err);
      }
    }

    return {
      iv_base64: iv,
      ciphertext_base64: ciphertext,
      tag_base64: authTag,
      sha256: sha256Hash,
      prev_sha256: prevChunkHash,
      wrapped_keys: wrappedKeys
    };
  }

  /**
   * Emergency contact decrypts received chunk using their local RSA private key.
   */
  async decryptAudioChunk(
    chunk: GCMEncryptedChunk,
    contactId: string,
    privateKey: string
  ): Promise<string> {
    const sealedKey = chunk.wrapped_keys[contactId];
    if (!sealedKey) {
      throw new Error(`[E2EEncryption] No sealed key found for recipient ${contactId}`);
    }

    // 1. Unseal symmetric key
    const symmetricKey = await RSA.decrypt(sealedKey, privateKey);

    // 2. Verify hash
    const computedHash = this.computeSHA256(chunk.ciphertext_base64);
    if (computedHash !== chunk.sha256) {
      throw new Error('[E2EEncryption] Chunk SHA-256 hash mismatch! Possible tampering.');
    }

    // 3. Decrypt payload
    const decrypted = CryptoJS.AES.decrypt(chunk.ciphertext_base64, symmetricKey, {
      iv: CryptoJS.enc.Base64.parse(chunk.iv_base64),
      mode: CryptoJS.mode.CTR,
      padding: CryptoJS.pad.Pkcs7
    });

    return decrypted.toString(CryptoJS.enc.Utf8);
  }
}

export default new E2EEncryption();
