import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Effect, Schema } from "effect";

export class LinkTransferError extends Schema.TaggedError<
	LinkTransferError,
	{ readonly brand: unique symbol }
>()("LinkTransferError", { cause: Schema.Unknown }) {}

const transferError = (cause: unknown) => new LinkTransferError({ cause });

export type AdminLinkTransfer = (
	url: string,
) => Effect.Effect<"copied" | "shared", LinkTransferError>;

export const transferAdminLink: AdminLinkTransfer = (url) =>
	Capacitor.isNativePlatform()
		? Effect.tryPromise({ catch: transferError, try: () => Share.share({ url }) }).pipe(
				Effect.as("shared" as const),
			)
		: Effect.tryPromise({
				catch: transferError,
				try: () => navigator.clipboard.writeText(url),
			}).pipe(Effect.as("copied" as const));

export type MigrationReportDetailsTransfer = (
	text: string,
) => Effect.Effect<"copied" | "shared", LinkTransferError>;

export const transferMigrationReportDetails: MigrationReportDetailsTransfer = (text) =>
	Capacitor.isNativePlatform()
		? Effect.tryPromise({ catch: transferError, try: () => Share.share({ text }) }).pipe(
				Effect.as("shared" as const),
			)
		: Effect.tryPromise({
				catch: transferError,
				try: () => navigator.clipboard.writeText(text),
			}).pipe(Effect.as("copied" as const));
