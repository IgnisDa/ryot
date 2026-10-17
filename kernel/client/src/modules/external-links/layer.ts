import { Browser } from "@capacitor/browser";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect, Layer } from "effect";

import { ExternalLinkPlatform, ExternalLinks } from "#/modules/external-links/service";
import { isNativePlatform } from "#/modules/navigation/native-navigation";

const platform = Layer.sync(ExternalLinkPlatform, () => ({
	isNative: isNativePlatform(),
	isActive: () => navigator.userActivation.isActive,
	openNative: (url: string) =>
		Effect.tryPromise({
			try: () => Browser.open({ url }),
			catch: () => new RyotClientError("link-open-failed"),
		}),
	openBlank: () => {
		const popup = window.open("about:blank", "_blank");
		if (popup === null) {
			return null;
		}
		return {
			close: () => popup.close(),
			detachOpener: () => {
				popup.opener = null;
			},
			setNoReferrer: () => {
				const policy = popup.document.createElement("meta");
				policy.name = "referrer";
				policy.content = "no-referrer";
				popup.document.head.append(policy);
			},
			replace: (url: string) => {
				const link = popup.document.createElement("a");
				link.href = url;
				link.target = "_self";
				link.rel = "noreferrer";
				link.referrerPolicy = "no-referrer";
				popup.document.body.append(link);
				link.click();
			},
		};
	},
}));

export const ExternalLinksLive = ExternalLinks.layer.pipe(Layer.provide(platform));
