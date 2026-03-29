import { SandboxScriptId, EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

export const TrendingProviderTarget = Schema.Struct({
	scriptId: SandboxScriptId,
	scriptSlug: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
});

export type TrendingProviderTarget = typeof TrendingProviderTarget.Type;

export const TrendingDriverItem = Schema.Struct({
	name: Schema.NonEmptyString,
	externalId: Schema.NonEmptyString,
});

export type TrendingDriverItem = typeof TrendingDriverItem.Type;

export const TrendingDriverResult = Schema.Struct({
	items: Schema.Array(TrendingDriverItem),
});

export type TrendingDriverResult = typeof TrendingDriverResult.Type;

export const decodeTrendingDriverResult = Schema.decodeUnknown(TrendingDriverResult);
