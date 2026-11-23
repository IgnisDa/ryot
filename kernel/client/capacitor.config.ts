import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

const config: CapacitorConfig = {
	webDir: "dist",
	appName: "Ryot",
	appId: "io.ryot.app",
	backgroundColor: "#101113",
	plugins: {
		LocalNotifications: { presentationOptions: [] },
		Keyboard: { autoBackdropColor: "dom", resize: KeyboardResize.None },
	},
};

export default config;
