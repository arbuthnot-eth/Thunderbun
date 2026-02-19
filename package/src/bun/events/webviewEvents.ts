import ThunderBunEvent from "./event";

type DetailData = { detail: string };
type NewWindowOpenData = {
	detail:
		| string
		| {
				url: string;
				isCmdClick: boolean;
				modifierFlags?: number;
				targetDisposition?: number;
				userGesture?: boolean;
		  };
};

export default {
	willNavigate: (data: DetailData) =>
		new ThunderBunEvent<DetailData, {}>("will-navigate", data),
	didNavigate: (data: DetailData) =>
		new ThunderBunEvent<DetailData, {}>("did-navigate", data),
	didNavigateInPage: (data: DetailData) =>
		new ThunderBunEvent<DetailData, {}>("did-navigate-in-page", data),
	didCommitNavigation: (data: DetailData) =>
		new ThunderBunEvent<DetailData, {}>("did-commit-navigation", data),
	domReady: (data: DetailData) =>
		new ThunderBunEvent<DetailData, {}>("dom-ready", data),
	newWindowOpen: (data: NewWindowOpenData) =>
		new ThunderBunEvent<NewWindowOpenData, {}>("new-window-open", data),
	hostMessage: (data: DetailData) =>
		new ThunderBunEvent<DetailData, {}>("host-message", data),
	downloadStarted: (data: DetailData) =>
		new ThunderBunEvent<DetailData, {}>("download-started", data),
	downloadProgress: (data: DetailData) =>
		new ThunderBunEvent<DetailData, {}>("download-progress", data),
	downloadCompleted: (data: DetailData) =>
		new ThunderBunEvent<DetailData, {}>("download-completed", data),
	downloadFailed: (data: DetailData) =>
		new ThunderBunEvent<DetailData, {}>("download-failed", data),
};
