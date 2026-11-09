import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Effect, Schema } from "effect";

export class ShareError extends Schema.TaggedError<ShareError, { readonly brand: unique symbol }>()(
	"ShareError",
	{ cause: Schema.Unknown },
) {}

const shareError = (cause: unknown) => new ShareError({ cause });

export type ShareOrCopy = (content: ShareContent) => Effect.Effect<"copied" | "shared", ShareError>;

export type ShareContent =
	{ readonly text: string } | { readonly url: string; readonly title?: string };

export const sharesNatively = Capacitor.isNativePlatform();

export const shareOrCopy: ShareOrCopy = (content) =>
	sharesNatively
		? Effect.tryPromise({ catch: shareError, try: () => Share.share(content) }).pipe(
				Effect.as("shared" as const),
			)
		: Effect.tryPromise({
				catch: shareError,
				try: () => navigator.clipboard.writeText("url" in content ? content.url : content.text),
			}).pipe(Effect.as("copied" as const));
