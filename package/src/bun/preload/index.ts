// ThunderBun Full Preload Script (for trusted webviews)
// This is compiled to JS and injected into webviews that are NOT sandboxed
//
// Includes: RPC, encryption, drag regions, webview tags, lifecycle events
//
// Before this script runs, the following must be set:
// - window.__thunderbunWebviewId
// - window.__thunderbunWindowId
// - window.__thunderbunRpcSocketPort
// - window.__thunderbunSecretKeyBytes
// - window.__thunderbunEventBridge (event emission - all webviews)
// - window.__thunderbunInternalBridge (internal RPC - trusted only)
// - window.__thunderbunBunBridge (user RPC - trusted only)

import "./globals.d.ts";
import { initEncryption } from "./encryption";
import { handleResponse } from "./internalRpc";
import { initDragRegions } from "./dragRegions";
import { initWebviewTag } from "./webviewTag";
import { initWgpuTag } from "./wgpuTag";
import {
	emitWebviewEvent,
	initLifecycleEvents,
	initCmdClickHandling,
	initSPANavigationInterception,
	initOverscrollPrevention,
} from "./events";

// Initialize encryption first (async)
initEncryption().catch((err) =>
	console.error("Failed to initialize encryption:", err),
);

// Set up global handlers for bun to call back
// Wrapper to satisfy the (msg: unknown) => void type
const internalMessageHandler = (msg: unknown) => {
	handleResponse(msg as { type: string; id: string; success: boolean; payload: unknown });
};

if (!window.__thunderbun) {
	window.__thunderbun = {
		receiveInternalMessageFromBun: internalMessageHandler,
		receiveMessageFromBun: (msg: unknown) => {
			// Default handler for user RPC - will be overridden if user creates Thunderview
			console.log("receiveMessageFromBun (no handler):", msg);
		},
	};
} else {
	window.__thunderbun.receiveInternalMessageFromBun = internalMessageHandler;
	window.__thunderbun.receiveMessageFromBun = (msg: unknown) => {
		console.log("receiveMessageFromBun (no handler):", msg);
	};
}

// Allow preload scripts to send custom messages to the host webview
window.__thunderbunSendToHost = (message: unknown) => {
	emitWebviewEvent("host-message", JSON.stringify(message));
};

// Initialize all features
initLifecycleEvents();
initCmdClickHandling();
initSPANavigationInterception();
initOverscrollPrevention();
initDragRegions();
initWebviewTag();
initWgpuTag();
