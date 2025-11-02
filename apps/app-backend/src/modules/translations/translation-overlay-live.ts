import { Effect, Layer } from "effect";

import { TranslationOverlay } from "#modules/entities/translation-overlay";

import { TranslationsService } from "./service";

export const TranslationOverlayLive = Layer.effect(
	TranslationOverlay,
	Effect.gen(function* () {
		const service = yield* TranslationsService;
		return { apply: (input) => service.resolveOverlay(input) };
	}),
);
