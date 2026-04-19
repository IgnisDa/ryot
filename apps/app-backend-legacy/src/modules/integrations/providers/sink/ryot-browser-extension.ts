import { z } from "zod";

import { buildMovieOrShowImportRef } from "~/modules/imports/sources/shared/provider-refs";

import {
	createProgressResult,
	createSinkFailure,
	emptySinkResult,
	type SinkParser,
} from "./shared";

const browserExtensionSeenSchema = z.object({
	progress: z.coerce.number(),
	lot: z.enum(["movie", "show"]),
	show_season_number: z.coerce.number().int().optional(),
	show_episode_number: z.coerce.number().int().optional(),
	identifier: z.union([z.string(), z.number().int()]).transform(String),
});

const browserExtensionPayloadSchema = z.union([
	z.object({ url: z.string(), data: browserExtensionSeenSchema }),
	z.object({
		url: z.string().optional(),
		progress: z.coerce.number(),
		lot: z.enum(["movie", "show"]),
		show_season_number: z.coerce.number().int().optional(),
		show_episode_number: z.coerce.number().int().optional(),
		identifier: z.union([z.string(), z.number().int()]).transform(String),
	}),
]);

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

const isDisabledSite = (hostname: string, disabledSites: string[]): boolean => {
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

export const parseRyotBrowserExtensionSink: SinkParser = async (input) => {
	try {
		const specs = input.integration.providerSpecifics;
		if (specs.kind !== "ryot_browser_extension") {
			throw new Error("Integration is not a browser extension sink integration");
		}

		const payload = browserExtensionPayloadSchema.parse(JSON.parse(input.rawBody));
		const mediaSeen = "data" in payload ? payload.data : payload;
		if (payload.url && specs.disabledSites?.length) {
			const hostname = new URL(payload.url).hostname;
			if (isDisabledSite(hostname, specs.disabledSites)) {
				return Promise.resolve(emptySinkResult());
			}
		}

		const ref = buildMovieOrShowImportRef({
			entitySchemaSlug: mediaSeen.lot,
			sourceLabel: mediaSeen.identifier,
			providerIds: { tmdb: mediaSeen.identifier },
		});
		if (!ref) {
			return Promise.resolve({
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Browser extension payload is missing a TMDB identifier",
					}),
				],
			});
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
