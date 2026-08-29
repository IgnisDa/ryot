import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";

export type ResetLinkTransfer = (url: string) => Promise<"copied" | "shared">;

export const transferResetLink: ResetLinkTransfer = (url) =>
	Capacitor.isNativePlatform()
		? Share.share({ url }).then(() => "shared" as const)
		: navigator.clipboard.writeText(url).then(() => "copied" as const);

export type MigrationReportDetailsTransfer = (text: string) => Promise<"copied" | "shared">;

export const transferMigrationReportDetails: MigrationReportDetailsTransfer = (text) =>
	Capacitor.isNativePlatform()
		? Share.share({ text }).then(() => "shared" as const)
		: navigator.clipboard.writeText(text).then(() => "copied" as const);
