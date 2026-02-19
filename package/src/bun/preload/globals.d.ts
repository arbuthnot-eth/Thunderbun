// Type declarations for ThunderBun preload globals
// These are set dynamically per-webview before the preload script runs

declare global {
	interface Window {
		__thunderbunWebviewId: number;
		__thunderbunWindowId: number;
		__thunderbunRpcSocketPort: number;
		__thunderbunSecretKeyBytes: number[];
		// Event-only bridge (all webviews, including sandboxed)
		__thunderbunEventBridge?: {
			postMessage: (message: string) => void;
		};
		// Internal RPC bridge (trusted webviews only)
		__thunderbunInternalBridge?: {
			postMessage: (message: string) => void;
		};
		// User RPC bridge (trusted webviews only)
		__thunderbunBunBridge?: {
			postMessage: (message: string) => void;
		};
		__thunderbun_encrypt: (
			plaintext: string,
		) => Promise<{ encryptedData: string; iv: string; tag: string }>;
		__thunderbun_decrypt: (
			encryptedData: string,
			iv: string,
			tag: string,
		) => Promise<string>;
		__thunderbunSendToHost: (message: unknown) => void;
		__thunderbun: {
			receiveMessageFromBun: (msg: unknown) => void;
			receiveInternalMessageFromBun: (msg: unknown) => void;
		};
	}
}

export {};
