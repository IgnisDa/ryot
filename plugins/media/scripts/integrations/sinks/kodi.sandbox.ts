import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { resolvedMediaRef } from "../../../imports/source-helpers";
import { failureResult, jsonRecord, progressResult, showEpisodeRef, SinkInput } from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Kodi sink",
	slug: "integration.kodi",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["getIntegration"],
});
export const parseKodi = (rawBody: string) =>
	Effect.try(() => {
		const payload = jsonRecord(rawBody);
		const lot = payload["lot"];
		const progress = payload["progress"];
		const rawId = payload["identifier"];
		if (
			(lot !== "movie" && lot !== "show") ||
			typeof progress !== "number" ||
			!Number.isFinite(progress)
		) {
			return failureResult("Could not parse Kodi webhook payload");
		}
		let id = "";
		if (typeof rawId === "string") {
			id = rawId.trim();
		}
		if (typeof rawId === "number" && Number.isFinite(rawId)) {
			id = String(rawId);
		}
		if (!id) {
			return failureResult("Kodi webhook payload is missing a TMDB identifier");
		}
		const locator =
			lot === "show"
				? showEpisodeRef(
						typeof payload["show_season_number"] === "number"
							? payload["show_season_number"]
							: undefined,
						typeof payload["show_episode_number"] === "number"
							? payload["show_episode_number"]
							: undefined,
					)
				: undefined;
		if (lot === "show" && !locator) {
			return failureResult("Kodi webhook payload is missing show episode coordinates");
		}
		return progressResult({
			entityRef: resolvedMediaRef(lot, "tmdb", id, id),
			consumedOn: "kodi",
			progressPercent: progress,
			...(locator ? { unresolvedEpisode: locator } : {}),
		});
	}).pipe(Effect.orElseSucceed(() => failureResult("Could not parse Kodi webhook payload")));
export default defineScript({
	manifest,
	input: SinkInput,
	output: MediaIntegrationAdapterResult,
	run: (input, host) => host.getIntegration().pipe(Effect.flatMap(() => parseKodi(input.rawBody))),
});
