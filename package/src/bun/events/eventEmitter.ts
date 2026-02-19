import EventEmitter from "events";
import windowEvents from "./windowEvents";
import webviewEvents from "./webviewEvents";
import trayEvents from "./trayEvents";
import applicationEvents from "./ApplicationEvents";
import ThunderBunEvent from "./event";

class ThunderBunEventEmitter extends EventEmitter {
	constructor() {
		super();
	}

	// optionally pass in a specifier to make the event name specific.
	// eg: will-navigate is listened to globally for all webviews, but
	// will-navigate-1 is listened to for a specific webview with id 1
	emitEvent(
		ThunderBunEvent: ThunderBunEvent<any, any>,
		specifier?: number | string,
	) {
		if (specifier) {
			this.emit(`${ThunderBunEvent.name}-${specifier}`, ThunderBunEvent);
		} else {
			this.emit(ThunderBunEvent.name, ThunderBunEvent);
		}
	}

	events = {
		window: {
			...windowEvents,
		},
		webview: {
			...webviewEvents,
		},
		tray: {
			...trayEvents,
		},
		app: {
			...applicationEvents,
		},
	};
}

export const thunderbunEventEmitter = new ThunderBunEventEmitter();

export default thunderbunEventEmitter;
