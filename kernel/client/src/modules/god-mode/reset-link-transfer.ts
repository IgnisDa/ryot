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

export type MigrationReportDetailsTransfer = (text: string) => Promise<"copied" | "shared">;

export const transferMigrationReportDetails: MigrationReportDetailsTransfer = async (text) => {
	if (Capacitor.isNativePlatform()) {
		await Share.share({ text });
		return "shared";
	}
	await navigator.clipboard.writeText(text);
	return "copied";
};
