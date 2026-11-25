import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { ProviderTranslateInput } from "@ryot-app/plugin-backend-sdk/provider";

import { mediaFailureMessage } from "../../../lib/error-message";
import { MediaSandboxError } from "../../../lib/failures";
import { normalizePlainDescription } from "../../../lib/plain-description";
import { stringValue } from "../../../lib/records";
import { mediaTranslationResult } from "../../../lib/translation-result";
import {
	firstTranslationValue,
	getLocalizedTmdbArtwork,
	orderedTranslationCandidates,
	parseTranslationLanguage,
	tmdbGet,
	type TmdbHost,
	tmdbLocalizedImages,
} from "../../../lib/vendors/tmdb";
import { tmdbShowChildPath } from "./child-path";

const getTranslationRequest = (input: ProviderTranslateInput) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TMDB show ID");
	}
	const path =
		input.entitySchemaSlug === "show" ? `/tv/${input.externalId}` : tmdbShowChildPath(input);
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
		const { region, script, langCode } = parseTranslationLanguage(input.language);
		const [translationsData, imagesData] = yield* Effect.all([
			tmdbGet(host, request.translationsPath, {}, token),
			tmdbLocalizedImages(host, request.imagesPath, langCode, token).pipe(
				Effect.orElseSucceed(() => ({})),
			),
		]);
		const candidates = orderedTranslationCandidates(translationsData, langCode, region, script);
		const name = firstTranslationValue(
			candidates,
			(data) => stringValue(data["name"]) ?? data["title"],
		);
		const description = normalizePlainDescription(
			firstTranslationValue(candidates, (data) => data["overview"]),
		);
		const image = getLocalizedTmdbArtwork(imagesData, request.imageKey, langCode, request.purpose);
		return mediaTranslationResult(name, description, image);
	});
};
