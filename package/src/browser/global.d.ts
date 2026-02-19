// Global type declarations for ThunderBun browser environment

interface ThunderBunEncryptResult {
  encryptedData: string;
  iv: string;
  tag: string;
}

interface ThunderBunBridge {
  receiveMessageFromBun: (msg: unknown) => void;
  receiveInternalMessageFromBun: (msg: unknown) => void;
}

interface MessageHandler {
  postMessage: (msg: string) => void;
}

declare global {
  interface Window {
    __thunderbunWebviewId: number;
    __thunderbunWindowId: number;
    __thunderbunRpcSocketPort: number;
    __thunderbun?: ThunderBunBridge;
    __thunderbun_encrypt: (msg: string) => Promise<ThunderBunEncryptResult>;
    __thunderbun_decrypt: (encryptedData: string, iv: string, tag: string) => Promise<string>;
    __thunderbunInternalBridge?: MessageHandler;
    __thunderbunBunBridge?: MessageHandler;
  }
}

export {};
