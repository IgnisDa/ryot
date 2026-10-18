import { Effect } from "effect";

import { webRequest } from "~/support/web-request";

import type { Client } from "./auth";

export const uploadPermanentAsset = (
	client: Client,
	options: { readonly contentType: string; readonly fileName: string },
) =>
	Effect.gen(function* () {
		const intent = yield* client.call((c) =>
			c.uploads.createIntent({
				payload: {
					kind: "permanent",
					fileName: options.fileName,
					contentType: options.contentType,
				},
			}),
		);
		const uploadResponse = yield* webRequest(new URL(intent.uploadUrl, `${client.baseUrl}/`), {
			method: intent.method,
			headers: intent.headers,
			body: `synthetic ${options.fileName}`,
		});
		if (!uploadResponse.ok) {
			throw new Error(`Could not upload permanent asset (${uploadResponse.status})`);
		}
		const asset = yield* client.call((c) =>
			c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
		);
		if (!("key" in asset)) {
			throw new Error("Expected a permanent asset locator");
		}
		return asset;
	});
