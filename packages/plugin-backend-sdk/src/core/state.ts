import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, jsonValueSchema, strictStruct } from "../wire";
import { nonEmptyString } from "./primitives";

const positiveInteger = Schema.Number.pipe(
	Schema.check(Schema.isInt()),
	Schema.check(Schema.isGreaterThan(0)),
);
const cacheKeySchema = nonEmptyString;
const cacheTtlSecondsSchema = positiveInteger;
export const getCachedValueArgsSchema = Schema.Tuple([cacheKeySchema]);
export const getCachedValueDataSchema = Schema.NullOr(jsonValueSchema);
export const getCachedValueResultSchema = hostResultSchema(getCachedValueDataSchema);
export const setCachedValueArgsSchema = Schema.Tuple([
	cacheKeySchema,
	jsonValueSchema,
	cacheTtlSecondsSchema,
]);
export const setCachedValueDataSchema = Schema.Null;
export const setCachedValueResultSchema = hostResultSchema(setCachedValueDataSchema);
export const cacheClaimSchema = Schema.Union([
	strictStruct({ claimed: Schema.Literal(true) }),
	strictStruct({ claimed: Schema.Literal(false), value: Schema.NullOr(jsonValueSchema) }),
]);
export const claimPersistentValueArgsSchema = Schema.Tuple([
	cacheKeySchema,
	jsonValueSchema,
	cacheTtlSecondsSchema,
]);
export const configKeysSchema = Schema.Array(nonEmptyString);
export const getPluginConfigArgsSchema = Schema.Tuple([
	strictStruct({
		required: Schema.optional(configKeysSchema),
		optional: Schema.optional(configKeysSchema),
	}),
]);
export const claimPersistentValueResultSchema = hostResultSchema(cacheClaimSchema);
export const configValuesSchema = Schema.Record(Schema.String, jsonValueSchema);
export const getPluginConfigResultSchema = hostResultSchema(configValuesSchema);
export const userPreferencesSchema = strictStruct({ disableIntegrations: Schema.Boolean });
export const getUserPreferencesArgsSchema = Schema.Tuple([]);
export const getUserPreferencesResultSchema = hostResultSchema(userPreferencesSchema);
export const getUserSettingsArgsSchema = Schema.Tuple([]);
export const getUserSettingsResultSchema = hostResultSchema(configValuesSchema);
