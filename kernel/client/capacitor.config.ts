import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
	webDir: "dist",
	appName: "Ryot",
	appId: "io.ryot.app",
	backgroundColor: "#101113",
	plugins: { Keyboard: { autoBackdropColor: "dom" } },
};

export default config;
