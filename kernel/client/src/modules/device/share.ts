import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import type { CopyFieldAction } from "@ryot-app/plugin-ui-sdk";
import { Effect, Schema } from "effect";

export class ShareError extends Schema.TaggedError<ShareError, { readonly brand: unique symbol }>()(
	"ShareError",
	{ cause: Schema.Unknown },
) {}

const shareError = (cause: unknown) => new ShareError({ cause });

export type ShareOrCopy = (content: ShareContent) => Effect.Effect<void, ShareError>;

export type ShareContent =
	{ readonly text: string } | { readonly url: string; readonly title?: string };

const sharesNatively = Capacitor.isNativePlatform();

export const shareOrCopy: ShareOrCopy = (content) =>
	sharesNatively
		? Effect.tryPromise({ catch: shareError, try: () => Share.share(content) })
		: Effect.tryPromise({
				catch: shareError,
				try: () => navigator.clipboard.writeText("url" in content ? content.url : content.text),
			});

export type ShareAction = (content: ShareContent) => CopyFieldAction;

export const shareActionWith =
	(run: CopyFieldAction["run"], share: ShareOrCopy = shareOrCopy): ShareAction =>
	(content) => ({ run, perform: share(content), kind: sharesNatively ? "share" : "copy" });

export const useShareAction = () => shareActionWith(useRyotSchedule().run);
