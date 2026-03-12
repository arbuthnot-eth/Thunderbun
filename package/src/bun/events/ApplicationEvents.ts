import ThunderBunEvent from "./event";

type MenuClickedData = { id?: number; action: string; data?: unknown };
type OpenUrlData = { url: string };

export default {
	applicationMenuClicked: (data: MenuClickedData) =>
		new ThunderBunEvent<MenuClickedData, { allow: boolean }>(
			"application-menu-clicked",
			data,
		),
	contextMenuClicked: (data: MenuClickedData) =>
		new ThunderBunEvent<MenuClickedData, { allow: boolean }>(
			"context-menu-clicked",
			data,
		),
	openUrl: (data: OpenUrlData) =>
		new ThunderBunEvent<OpenUrlData, void>("open-url", data),
	reopen: (data: {}) => new ThunderBunEvent<{}, void>("reopen", data),
	beforeQuit: (data: {}) =>
		new ThunderBunEvent<{}, { allow: boolean }>("before-quit", data),
};
