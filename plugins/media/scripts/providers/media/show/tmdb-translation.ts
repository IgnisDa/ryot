import { Effect } from "@ryot/sandbox-sdk/effect";
import type { ProviderTranslateInput } from "@ryot/sandbox-sdk/provider";

import { asRecord, stringValue } from "../../../script-helpers/records";
import {
	firstTranslationValue,
	getLocalizedImageUrl,
	orderedTranslationCandidates,
	parseTranslationLanguage,
	tmdbGet,
	type TmdbHost,
} from "../../tmdb-shared";

const getTranslationRequest = (input: ProviderTranslateInput) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TMDB show ID");
	}
	if (input.entitySchemaSlug === "show") {
		return {
			imageKey: "posters",
			imagesPath: `/tv/${input.externalId}/images`,
			translationsPath: `/tv/${input.externalId}/translations`,
		};
	}

	const properties = asRecord(input.properties);
	if (!properties) {
		throw new Error("properties must be an object for TMDB show translation");
	}
	const seasonNumberValue = properties["seasonNumber"];
	const seasonNumber =
		typeof seasonNumberValue === "number" &&
		Number.isInteger(seasonNumberValue) &&
		seasonNumberValue >= 0
			? seasonNumberValue
			: null;
	const parentShowExternalId = stringValue(properties["parentShowExternalId"]);
	if (seasonNumber === null) {
		throw new Error("seasonNumber is required for TMDB show child translation");
	}
	if (!parentShowExternalId || !/^\d+$/.test(parentShowExternalId)) {
		throw new Error("parentShowExternalId must be a numeric TMDB show ID");
	}
	if (input.entitySchemaSlug === "show-season") {
		return {
			imageKey: "posters",
			imagesPath: `/tv/${parentShowExternalId}/season/${seasonNumber}/images`,
			translationsPath: `/tv/${parentShowExternalId}/season/${seasonNumber}/translations`,
		};
	}

	const episodeNumberValue = properties["episodeNumber"];
	const episodeNumber =
		typeof episodeNumberValue === "number" &&
		Number.isInteger(episodeNumberValue) &&
		episodeNumberValue >= 0
			? episodeNumberValue
			: null;
	if (input.entitySchemaSlug === "show-episode") {
		if (episodeNumber === null) {
			throw new Error("episodeNumber is required for TMDB show episode translation");
		}
		return {
			imageKey: "stills",
			imagesPath: `/tv/${parentShowExternalId}/season/${seasonNumber}/episode/${episodeNumber}/images`,
			translationsPath: `/tv/${parentShowExternalId}/season/${seasonNumber}/episode/${episodeNumber}/translations`,
		};
	}
	throw new Error("show.tmdb translate supports only show, show-season, and show-episode");
};

export const translateTmdbShow = (input: ProviderTranslateInput, host: TmdbHost, token: string) => {
	return Effect.gen(function* () {
		const request = yield* Effect.try({
			try: () => getTranslationRequest(input),
			catch: (error) => (error instanceof Error ? error : new Error(String(error))),
		});
		const { langCode, region } = parseTranslationLanguage(input.language);
		const [translationsData, imagesData] = yield* Effect.all([
			tmdbGet(host, request.translationsPath, {}, token),
			tmdbGet(host, request.imagesPath, { include_image_language: langCode }, token).pipe(
				Effect.catchAll(() => Effect.succeed({})),
			),
		]);
		const candidates = orderedTranslationCandidates(translationsData, langCode, region);
		const name = firstTranslationValue(
			candidates,
			(data) => stringValue(data["name"]) ?? data["title"],
		);
		const description = firstTranslationValue(candidates, (data) => data["overview"]);
		const imageUrl = getLocalizedImageUrl(imagesData, request.imageKey, langCode);
		const properties: Record<string, string | Array<{ type: "remote"; url: string }>> = {};
		if (description) {
			properties["description"] = description;
		}
		if (imageUrl) {
			properties["images"] = [{ type: "remote", url: imageUrl }];
		}
		return {
			...(name ? { name } : {}),
			...(Object.keys(properties).length > 0 ? { properties } : {}),
		};
	});
};
