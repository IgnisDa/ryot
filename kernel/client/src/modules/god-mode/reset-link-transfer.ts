import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { type Cause, Effect } from "effect";

export type ResetLinkTransfer = (
	url: string,
) => Effect.Effect<"copied" | "shared", Cause.UnknownError>;

export const transferResetLink: ResetLinkTransfer = (url) =>
	Capacitor.isNativePlatform()
		? Effect.tryPromise(() => Share.share({ url })).pipe(Effect.as("shared" as const))
		: Effect.tryPromise(() => navigator.clipboard.writeText(url)).pipe(
				Effect.as("copied" as const),
			);

export type MigrationReportDetailsTransfer = (
	text: string,
) => Effect.Effect<"copied" | "shared", Cause.UnknownError>;

export const transferMigrationReportDetails: MigrationReportDetailsTransfer = (text) =>
	Capacitor.isNativePlatform()
		? Effect.tryPromise(() => Share.share({ text })).pipe(Effect.as("shared" as const))
		: Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
				Effect.as("copied" as const),
			);
