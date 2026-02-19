import { BrowserWindow, Utils } from "thunderbun/bun";

// Create the main application window
const mainWindow = new BrowserWindow({
	title: "Hello ThunderBun!",
	url: "views://mainview/index.html",
	frame: {
		width: 800,
		height: 800,
		x: 200,
		y: 200,
	},
});

// Quit the app when the main window is closed
mainWindow.on("close", () => {
	Utils.quit();
});

console.log("Hello ThunderBun app started!");
