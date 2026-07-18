import { writePluginArchive, type PluginArchivePackage } from "@ryot-app/plugin-archive";
import { Effect } from "effect";

import { getApiUrl } from "~/support/api";

import type { Client } from "./auth";

export const uploadTemporaryArchive = (
	client: Client,
	bytes: Uint8Array,
	options: { readonly baseUrl?: string; readonly fileName: string },
) =>
	Effect.gen(function* () {
		const intent = yield* client.call((c) =>
			c.uploads.createIntent({
				payload: { kind: "temporary", fileName: options.fileName, contentType: "application/zip" },
			}),
		);
		const uploadResponse = yield* Effect.promise(() =>
			fetch(new URL(intent.uploadUrl, `${options.baseUrl ?? getApiUrl()}/`), {
				method: intent.method,
				headers: intent.headers,
				body: new Uint8Array(bytes),
			}),
		);
		if (!uploadResponse.ok) {
			throw new Error(`Could not upload temporary archive (${uploadResponse.status})`);
		}

		const completion = yield* client.call((c) =>
			c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
		);
		if (!("token" in completion)) {
			throw new Error("Expected a temporary archive upload token");
		}
		return completion.token;
	});

export const uploadPrivatePluginPackage = (
	client: Client,
	pluginPackage: PluginArchivePackage,
	baseUrl?: string,
) =>
	uploadTemporaryArchive(client, writePluginArchive(pluginPackage), {
		baseUrl,
		fileName: `${pluginPackage.manifest.metadata.slug}.zip`,
	});
