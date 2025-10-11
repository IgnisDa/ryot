import { Schema } from "effect";

import { buildMovieOrShowImportRef } from "~/modules/imports/sources/shared/provider-refs";

import {
	createProgressResult,
	createSinkFailure,
	emptySinkResult,
	type SinkParser,
} from "./shared";

const CoercedNumber = Schema.Union(Schema.Number, Schema.NumberFromString);

const IdentifierFromStringOrNumber = Schema.transform(
	Schema.Union(Schema.String, Schema.Number),
	Schema.String,
	{ strict: true, decode: (value) => String(value), encode: (value) => value },
);

const seenFields = {
	progress: CoercedNumber,
	lot: Schema.Literal("movie", "show"),
	identifier: IdentifierFromStringOrNumber,
	show_season_number: Schema.optional(CoercedNumber),
	show_episode_number: Schema.optional(CoercedNumber),
};

const BrowserExtensionPayload = Schema.Union(
	Schema.Struct({ url: Schema.String, data: Schema.Struct(seenFields) }),
	Schema.Struct({ url: Schema.optional(Schema.String), ...seenFields }),
);

const decodeBrowserExtensionPayload = Schema.decodeUnknownSync(BrowserExtensionPayload);

const normalizeHostname = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/^www\./, "");

const toRegisteredHostname = (hostname: string): string => {
	const parts = normalizeHostname(hostname).split(".").filter(Boolean);
	if (parts.length < 2) {
		return normalizeHostname(hostname);
	}
	return parts.slice(-2).join(".");
};

const isDisabledSite = (hostname: string, disabledSites: ReadonlyArray<string>): boolean => {
	const normalizedHost = normalizeHostname(hostname);
	const registeredHost = toRegisteredHostname(normalizedHost);
	return disabledSites.some((site) => {
		const normalizedSite = normalizeHostname(site);
		return (
			normalizedHost === normalizedSite ||
			registeredHost === normalizedSite ||
			normalizedHost.endsWith(`.${normalizedSite}`)
		);
	});
};

const providerNameByHostname: Record<string, string> = {
	"hbo.com": "hbo",
	"max.com": "max",
	"youtu.be": "youtube",
	"youtube.com": "youtube",
};

const deriveProviderName = (urlValue?: string): string => {
	if (!urlValue) {
		return "ryot_browser_extension";
	}

	try {
		const hostname = toRegisteredHostname(new URL(urlValue).hostname);
		const mapped = providerNameByHostname[hostname];
		if (mapped) {
			return mapped;
		}
		return hostname.split(".")[0] ?? "ryot_browser_extension";
	} catch {
		return "ryot_browser_extension";
	}
};

export const parseBrowserExtensionSink: SinkParser = (input) => {
	try {
		const specs = input.integration.providerSpecifics;
		if (specs.kind !== "ryot_browser_extension") {
			throw new Error("Integration is not a browser extension sink integration");
		}

		const payload = decodeBrowserExtensionPayload(JSON.parse(input.rawBody));
		const mediaSeen = "data" in payload ? payload.data : payload;
		if (payload.url && specs.disabledSites?.length) {
			const hostname = new URL(payload.url).hostname;
			if (isDisabledSite(hostname, specs.disabledSites)) {
				return emptySinkResult();
			}
		}

		const ref = buildMovieOrShowImportRef({
			entitySchemaSlug: mediaSeen.lot,
			sourceLabel: mediaSeen.identifier,
			providerIds: { tmdb: mediaSeen.identifier },
		});
		if (!ref) {
			return {
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Browser extension payload is missing a TMDB identifier",
					}),
				],
			};
		}

		return createProgressResult({
			entityRef: ref,
			progressPercent: mediaSeen.progress,
			consumedOn: deriveProviderName(payload.url),
			...(mediaSeen.lot === "show"
				? { showSeason: mediaSeen.show_season_number, showEpisode: mediaSeen.show_episode_number }
				: {}),
		});
	} catch {
		return {
			...emptySinkResult(),
			failures: [
				createSinkFailure({
					stage: "input_transformation",
					message: "Could not parse browser extension webhook payload",
				}),
			],
		};
	}
};
