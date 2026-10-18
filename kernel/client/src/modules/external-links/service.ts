import { type ExternalLinkOutcome, ExternalLinkRequest } from "@ryot-app/plugin-client-contract";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Context, Effect, Layer, Result, Schema } from "effect";

type ExternalLinkWindow = {
	readonly close: () => void;
	readonly detachOpener: () => void;
	readonly setNoReferrer: () => void;
	readonly replace: (url: string) => void;
};

export class ExternalLinkPlatform extends Context.Service<
	ExternalLinkPlatform,
	{
		readonly isNative: boolean;
		readonly isActive: () => boolean;
		readonly openBlank: () => null | ExternalLinkWindow;
		readonly openNative: (url: string) => Effect.Effect<void, RyotClientError>;
	}
>()("ExternalLinkPlatform") {}

export class ExternalLinks extends Context.Service<ExternalLinks>()("ExternalLinks", {
	make: Effect.gen(function* () {
		const platform = yield* ExternalLinkPlatform;
		const open = Effect.fn("ExternalLinks.open")(function* (request: ExternalLinkRequest) {
			const decoded = Schema.decodeResult(ExternalLinkRequest)(request);
			if (Result.isFailure(decoded)) {
				return yield* new RyotClientError("invalid-request");
			}
			if (platform.isNative) {
				yield* platform.openNative(decoded.success.url);
			} else {
				yield* Effect.try({
					catch: (error) =>
						error instanceof RyotClientError ? error : new RyotClientError("link-open-failed"),
					try: () => {
						if (!platform.isActive()) {
							throw new RyotClientError("activation-required");
						}
						const popup = platform.openBlank();
						if (popup === null) {
							throw new RyotClientError("link-open-failed");
						}
						try {
							popup.detachOpener();
							popup.setNoReferrer();
							popup.replace(decoded.success.url);
						} catch (error) {
							popup.close();
							throw error;
						}
					},
				});
			}
			return { outcome: "success" } as const;
		});
		const outcome = (request: ExternalLinkRequest): Effect.Effect<ExternalLinkOutcome> =>
			open(request).pipe(
				Effect.match({
					onSuccess: (value) => value,
					onFailure: (error) => ({
						outcome: "failure" as const,
						reason:
							error.reason === "activation-required" || error.reason === "invalid-request"
								? error.reason
								: "link-open-failed",
					}),
				}),
			);
		return { open, outcome };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
