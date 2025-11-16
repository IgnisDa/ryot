import { Context, Effect, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";

import type { ListedEntity, TranslationStatus } from "./schemas";

export type TranslationOverlayRequest = {
	entity: ListedEntity;
	user: CurrentUserValue;
	entitySchemaSlug: string;
	translatableKeys: ReadonlyArray<string>;
};

export type TranslationOverlayResult = {
	entity: ListedEntity;
	status: TranslationStatus;
};

export class TranslationOverlay extends Context.Tag("TranslationOverlay")<
	TranslationOverlay,
	{ apply: (input: TranslationOverlayRequest) => Effect.Effect<TranslationOverlayResult> }
>() {}

export const TranslationOverlayNoop = Layer.succeed(TranslationOverlay, {
	apply: ({ entity }) => Effect.succeed({ entity, status: "none" as const }),
});
