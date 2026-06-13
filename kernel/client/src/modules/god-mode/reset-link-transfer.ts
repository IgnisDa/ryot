import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";

export type ResetLinkTransfer = (url: string) => Promise<"copied" | "shared">;

export const transferResetLink: ResetLinkTransfer = async (url) => {
	if (Capacitor.isNativePlatform()) {
		await Share.share({ url });
		return "shared";
	}
	await navigator.clipboard.writeText(url);
	return "copied";
};
