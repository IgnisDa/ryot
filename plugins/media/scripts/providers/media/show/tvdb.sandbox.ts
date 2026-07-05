import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";
import type { ProviderTranslateInput } from "@ryot/sandbox-sdk/provider";

import { asRecord, stringValue } from "../../../script-helpers/records";
import {
	bcp47ToTvdb,
	buildTranslationResult,
	getLocalizedArtwork,
	searchTvdb,
	tvdbGet,
	tvdbGetOptional,
} from "../../tvdb-shared";
import { getTvdbShowDetails } from "./tvdb-details";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB",
	slug: "show.tvdb",
	requiredAppConfigKeys: ["moviesAndShows.tvdbApiKey"],
	providerInformation: { source: "tvdb", canonicalLanguage: "en" },
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getAppConfigValue"],
});

const getTranslationRequest = (input: ProviderTranslateInput, providerLanguage: string) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TVDB ID");
	}
	if (input.entitySchemaSlug === "show") {
		return {
			detailsPath: `/series/${input.externalId}/extended`,
			translationPath: `/series/${input.externalId}/translations/${providerLanguage}`,
		};
	}
	const properties = asRecord(input.properties);
	if (!properties) {
		throw new Error("properties must be an object for TVDB show translation");
	}
	const parentShowExternalId = stringValue(properties["parentShowExternalId"]);
	if (!parentShowExternalId || !/^\d+$/.test(parentShowExternalId)) {
		throw new Error("parentShowExternalId must be a numeric TVDB show ID");
	}
	if (input.entitySchemaSlug === "show-season") {
		return {
			detailsPath: `/seasons/${input.externalId}/extended`,
			translationPath: `/seasons/${input.externalId}/translations/${providerLanguage}`,
		};
	}
	if (input.entitySchemaSlug === "show-episode") {
		return {
			detailsPath: `/episodes/${input.externalId}/extended`,
			translationPath: `/episodes/${input.externalId}/translations/${providerLanguage}`,
		};
	}
	throw new Error("show.tvdb translate supports only show, show-season, and show-episode");
};

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	searchTvdb(host, input, { type: "series", nameKeys: ["name", "title"] }),
);

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	getTvdbShowDetails(input, host, manifest.providerInformation.canonicalLanguage),
);

export const translate = defineProviderDriver(manifest, "translate", (input, host) => {
	const providerLanguage = bcp47ToTvdb(input.language);
	return Effect.gen(function* () {
		const request = yield* Effect.try({
			try: () => getTranslationRequest(input, providerLanguage),
			catch: (error) => (error instanceof Error ? error : new Error(String(error))),
		});
		const [translationData, detailsData] = yield* Effect.all([
			tvdbGetOptional(host, request.translationPath),
			tvdbGet(host, request.detailsPath).pipe(Effect.catchAll(() => Effect.succeed(null))),
		]);
		const detailsShow = detailsData ? asRecord(detailsData["data"]) : null;
		const artworks = detailsShow ? (detailsShow["artworks"] ?? detailsShow["artwork"]) : null;
		const image = getLocalizedArtwork(artworks, providerLanguage);
		return buildTranslationResult(translationData, image);
	});
});

export default defineProvider({ manifest, drivers: { search, details, translate } });
