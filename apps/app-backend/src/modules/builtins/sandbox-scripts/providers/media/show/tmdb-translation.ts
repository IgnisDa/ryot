import type { ProviderTranslateInput, ProviderTranslateResult } from "@ryot/sandbox-sdk/provider";

import {
	asRecord,
	getImageUrl,
	recordsValue,
	stringValue,
	tmdbGet,
	type TmdbHost,
	type UnknownRecord,
} from "./tmdb-shared";

const parseTranslationLanguage = (language: string) => {
	const [languagePart = "", regionPart] = language.split("-");
	return {
		langCode: languagePart.trim().toLowerCase(),
		region: regionPart ? regionPart.trim().toUpperCase() : null,
	};
};

const orderedTranslationCandidates = (
	translationsData: UnknownRecord,
	langCode: string,
	region: string | null,
) => {
	const candidates = recordsValue(translationsData["translations"]).filter(
		(entry) => stringValue(entry["iso_639_1"])?.toLowerCase() === langCode,
	);
	const regionMatch = region
		? candidates.find((entry) => stringValue(entry["iso_3166_1"])?.toUpperCase() === region)
		: null;
	return regionMatch
		? [regionMatch, ...candidates.filter((entry) => entry !== regionMatch)]
		: candidates;
};

const firstTranslationValue = (
	candidates: readonly UnknownRecord[],
	extract: (data: UnknownRecord) => unknown,
) => {
	for (const entry of candidates) {
		const data = asRecord(entry["data"]);
		const value = data ? stringValue(extract(data)) : null;
		if (value) {
			return value;
		}
	}
	return null;
};

const getLocalizedImageUrl = (imagesData: UnknownRecord, imageKey: string, langCode: string) => {
	const localizedImage = recordsValue(imagesData[imageKey]).find(
		(image) => stringValue(image["iso_639_1"])?.toLowerCase() === langCode,
	);
	return localizedImage ? getImageUrl(localizedImage["file_path"]) : null;
};

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

export const translateTmdbShow = (
	input: ProviderTranslateInput,
	host: TmdbHost,
	token: string,
): Promise<ProviderTranslateResult> => {
	const request = getTranslationRequest(input);
	const { langCode, region } = parseTranslationLanguage(input.language);
	return Promise.all([
		tmdbGet(host, request.translationsPath, {}, token),
		tmdbGet(host, request.imagesPath, { include_image_language: langCode }, token).catch(
			() => ({}),
		),
	]).then(([translationsData, imagesData]) => {
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
