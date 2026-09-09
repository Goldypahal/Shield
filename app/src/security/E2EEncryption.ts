import CryptoJS from 'crypto-js';
import RSA from 'react-native-rsa-native'; // A common RN wrapper for native asymmetric crypto

/**
 * Ensures zero-knowledge architecture.
 * The server stores the audio clips but mathematically CANNOT listen to them.
 * Only the emergency contacts who hold the private keys can decrypt the payload.
 */
class E2EEncryption {
  
  /**
   * Generates a fast, secure AES-256 random key.
   */
  private generateSymmetricKey(): string {
    return CryptoJS.lib.WordArray.random(256 / 8).toString();
  }

  /**
   * Encrypts the raw audio bytes on the device BEFORE they ever hit the network.
   * 
   * @param rawAudioBase64 The raw audio from the device microphone
   * @param contactPublicKeys A map of ContactID -> RSA Public Key string
   * @returns The encrypted audio payload + the keys needed for contacts to unlock it
   */
  async encryptAudioForContacts(
    rawAudioBase64: string, 
    contactPublicKeys: Record<string, string>
  ) {
    // 1. Generate a one-time use symmetric key (Fernet equivalent)
    const symmetricKey = this.generateSymmetricKey();
    
    // 2. Encrypt the heavy audio file symmetrically (AES is fast for large files)
    const encryptedAudio = CryptoJS.AES.encrypt(rawAudioBase64, symmetricKey).toString();
    
    // 3. Encrypt the Symmetric Key asynchronously for each unique contact
    const encryptedSymmetricKeys: Record<string, string> = {};
    
    for (const [contactId, publicKey] of Object.entries(contactPublicKeys)) {
      try {
        // Encrypt the AES key with the contact's RSA Public Key (OAEP Padding)
        const encryptedKeyForContact = await RSA.encrypt(symmetricKey, publicKey);
        encryptedSymmetricKeys[contactId] = encryptedKeyForContact;
      } catch (error) {
        console.error(`Failed to encrypt key for contact ${contactId}`, error);
      }
    }
    
    // 4. This is the exact payload sent to PostgreSQL + S3/GCS. 
    // The server only sees AES gibberish and RSA-encrypted keys it cannot read.
    return {
      audio_payload: encryptedAudio,
      encrypted_keys: encryptedSymmetricKeys
    };
  }

  /**
   * Called by the Emergency Contact's app when they receive the payload from WebSockets.
   * 
   * @param encryptedAudio The AES payload from the server
   * @param encryptedSymmetricKey The AES key encrypted specifically for this user
   * @param myPrivateKey The user's RSA private key stored locally in SecureStore
   */
  async decryptAudio(
    encryptedAudio: string, 
    encryptedSymmetricKey: string, 
    myPrivateKey: string
  ) {
    // 1. Unlock the symmetric key using our private key
    const decryptedSymmetricKey = await RSA.decrypt(encryptedSymmetricKey, myPrivateKey);
    
    // 2. Decrypt the actual audio file using the unlocked symmetric key
    const rawAudioBytes = CryptoJS.AES.decrypt(encryptedAudio, decryptedSymmetricKey).toString(CryptoJS.enc.Utf8);
    
    return rawAudioBytes;
  }
}

export default new E2EEncryption();
