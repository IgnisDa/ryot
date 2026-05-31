import { Effect } from "effect";

import type { MediaImportAdapterResult } from "#modules/imports/media/adapter-result";

import type { IntegrationRecord } from "../repository";
import { parseBrowserExtensionSink } from "./browser-extension";
import { parseEmbySink } from "./emby";
import { parseJellyfinSink } from "./jellyfin";
import { parseKodiSink } from "./kodi";
import { parsePlexSink } from "./plex";
import { createSinkFailure, emptySinkResult, type SinkParserInput } from "./shared";

const unsupportedSinkResult = (provider: string): MediaImportAdapterResult => ({
	...emptySinkResult(),
	failures: [
		createSinkFailure({
			stage: "source_fetch",
			message: `${provider} integration is not implemented in V2 yet`,
		}),
	],
});

export const getSinkAdapterResult = (
	integration: IntegrationRecord,
	rawBody: string,
	contentType: string,
): Effect.Effect<MediaImportAdapterResult> => {
	const input: SinkParserInput = { rawBody, contentType, integration };
	const kind = integration.providerSpecifics.kind;
	if (kind === "kodi") {
		return parseKodiSink(input);
	}
	if (kind === "emby") {
		return parseEmbySink(input);
	}
	if (kind === "plex_sink") {
		return parsePlexSink(input);
	}
	if (kind === "jellyfin_sink") {
		return parseJellyfinSink(input);
	}
	if (kind === "ryot_browser_extension") {
		return parseBrowserExtensionSink(input);
	}
	return Effect.succeed(unsupportedSinkResult(integration.provider));
};
