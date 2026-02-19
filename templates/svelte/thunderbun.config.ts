import type { ThunderBunConfig } from "thunderbun";

export default {
	app: {
		name: "svelte-app",
		identifier: "svelteapp.thunderbun.dev",
		version: "0.0.1",
	},
	build: {
		// Vite builds to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ThunderBunConfig;
