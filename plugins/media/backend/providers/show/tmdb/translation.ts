import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { ProviderTranslateInput } from "@ryot-app/plugin-backend-sdk/provider";

import { mediaFailureMessage } from "../../../lib/error-message";
import { MediaSandboxError } from "../../../lib/failures";
import { normalizePlainDescription } from "../../../lib/plain-description";
import { stringValue } from "../../../lib/records";
import {
	firstTranslationValue,
	getLocalizedImageUrl,
	orderedTranslationCandidates,
	parseTranslationLanguage,
	tmdbGet,
	type TmdbHost,
} from "../../../lib/vendors/tmdb";
import { tmdbShowChildPath } from "./child-path";

const getTranslationRequest = (input: ProviderTranslateInput) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TMDB show ID");
	}
	if (input.entitySchemaSlug === "show") {
		return {
			imageKey: "posters",
			purpose: "cover" as const,
			imagesPath: `/tv/${input.externalId}/images`,
			translationsPath: `/tv/${input.externalId}/translations`,
		};
	}

	const path = tmdbShowChildPath(input);
	const episode = input.entitySchemaSlug === "show-episode";
	return {
		imagesPath: `${path}/images`,
		translationsPath: `${path}/translations`,
		imageKey: episode ? "stills" : "posters",
		purpose: episode ? ("still" as const) : ("cover" as const),
	};
};

export const translateTmdbShow = (input: ProviderTranslateInput, host: TmdbHost, token: string) => {
	return Effect.gen(function* () {
		const request = yield* Effect.try({
			try: () => getTranslationRequest(input),
			catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
		});
		const { region, langCode } = parseTranslationLanguage(input.language);
		const [translationsData, imagesData] = yield* Effect.all([
			tmdbGet(host, request.translationsPath, {}, token),
			tmdbGet(host, request.imagesPath, { include_image_language: langCode }, token).pipe(
				Effect.orElseSucceed(() => ({})),
			),
		]);
		const candidates = orderedTranslationCandidates(translationsData, langCode, region);
		const name = firstTranslationValue(
			candidates,
			(data) => stringValue(data["name"]) ?? data["title"],
		);
		const description = normalizePlainDescription(
			firstTranslationValue(candidates, (data) => data["overview"]),
		);
		const imageUrl = getLocalizedImageUrl(imagesData, request.imageKey, langCode);
		const properties: Record<
			string,
			string | Array<{ url: string; type: "remote"; purpose: "cover" | "still" }>
		> = {};
		if (description) {
			properties["description"] = description;
		}
		if (imageUrl) {
			properties["images"] = [{ url: imageUrl, type: "remote", purpose: request.purpose }];
		}
		return {
			...(name ? { name } : {}),
			...(Object.keys(properties).length > 0 ? { properties } : {}),
		};
	});
};
