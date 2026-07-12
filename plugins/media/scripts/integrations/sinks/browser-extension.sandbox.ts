import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { resolvedMediaRef } from "../../../imports/source-helpers";
import {
	emptyResult,
	failureResult,
	jsonRecord,
	progressResult,
	showEpisodeRef,
	SinkInput,
	specifics,
} from "../shared";

export const manifest = defineManifest({
	kind: "activity",
	name: "Ryot browser extension sink",
	slug: "integration.browser-extension",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["getIntegration"],
});

const hostname = (url?: string) => {
	if (!url || !URL.canParse(url)) {
		return "ryot_browser_extension";
	}
	const parts = new URL(url).hostname
		.toLowerCase()
		.replace(/^www\./, "")
		.split(".");
	const host = parts.slice(-2).join(".");
	return (
		(
			{
				"hbo.com": "hbo",
				"max.com": "max",
				"youtu.be": "youtube",
				"youtube.com": "youtube",
			} as Record<string, string>
		)[host] ??
		host.split(".")[0] ??
		"ryot_browser_extension"
	);
};

export default defineActivity({
	manifest,
	input: SinkInput,
	output: MediaIntegrationAdapterResult,
	run: (input, host) =>
		host.getIntegration().pipe(
			Effect.flatMap((integration) =>
				Effect.try(() => {
					const payload = jsonRecord(input.rawBody);
					const data = specifics(payload["data"]) ?? payload;
					const settings = specifics(integration.providerSpecifics);
					const url = typeof payload["url"] === "string" ? payload["url"] : undefined;
					const disabled = Array.isArray(settings?.["disabledSites"])
						? settings["disabledSites"].filter((site): site is string => typeof site === "string")
						: [];
					if (
						url &&
						disabled.some((site) =>
							new URL(url).hostname
								.toLowerCase()
								.replace(/^www\./, "")
								.endsWith(site.toLowerCase().replace(/^www\./, "")),
						)
					) {
						return emptyResult();
					}
					const lot = data["lot"];
					const id =
						typeof data["identifier"] === "string" || typeof data["identifier"] === "number"
							? String(data["identifier"]).trim()
							: "";
					const progress =
						typeof data["progress"] === "string" ? Number(data["progress"]) : data["progress"];
					if (
						(lot !== "movie" && lot !== "show") ||
						!id ||
						typeof progress !== "number" ||
						!Number.isFinite(progress)
					) {
						return failureResult("Could not parse browser extension webhook payload");
					}
					const locator =
						lot === "show"
							? showEpisodeRef(
									Number(data["show_season_number"]),
									Number(data["show_episode_number"]),
								)
							: undefined;
					if (lot === "show" && !locator) {
						return failureResult("Browser extension payload is missing show episode coordinates");
					}
					return progressResult({
						entityRef: resolvedMediaRef(lot, "tmdb", id, id),
						progressPercent: progress,
						consumedOn: hostname(url),
						...(locator ? { unresolvedEpisode: locator } : {}),
					});
				}).pipe(
					Effect.orElseSucceed(() =>
						failureResult("Could not parse browser extension webhook payload"),
					),
				),
			),
		),
});
