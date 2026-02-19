import ThunderBunEvent from "./event";

type TrayClickedData = { id: number; action: string; data?: unknown };

export default {
	trayClicked: (data: TrayClickedData) =>
		new ThunderBunEvent<TrayClickedData, { allow: boolean }>(
			"tray-clicked",
			data,
		),
};
