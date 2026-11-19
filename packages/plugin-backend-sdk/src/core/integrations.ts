import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, jsonValueSchema, strictStruct } from "../wire";
import { nonEmptyString } from "./primitives";

export const integrationLotSchema = Schema.Literals(["push", "sink", "yank"]);
export const integrationProviderSchema = Schema.String;
export const integrationProviderSettingsSchema = Schema.Record(Schema.String, jsonValueSchema);
export const integrationRecordSchema = strictStruct({
	id: Schema.String,
	userId: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	lot: integrationLotSchema,
	isDisabled: Schema.Boolean,
	syncOwnership: Schema.Boolean,
	minimumProgress: Schema.Finite,
	maximumProgress: Schema.Finite,
	name: Schema.NullOr(Schema.String),
	provider: integrationProviderSchema,
	webhookUrl: Schema.optional(Schema.String),
	lastFinishedAt: Schema.NullOr(Schema.String),
	providerSpecifics: integrationProviderSettingsSchema,
	extraSettings: strictStruct({ disableOnContinuousErrors: Schema.Boolean }),
});
export type IntegrationRecord = Schema.Schema.Type<typeof integrationRecordSchema>;
export const listIntegrationsOptionsSchema = strictStruct({
	isDisabled: Schema.optional(Schema.Boolean),
	provider: Schema.optional(integrationProviderSchema),
});
export type ListIntegrationsOptions = Schema.Schema.Type<typeof listIntegrationsOptionsSchema>;
export const getCurrentIntegrationArgsSchema = Schema.Tuple([]);
export const getOAuthAccessTokenArgsSchema = Schema.Tuple([
	strictStruct({ field: nonEmptyString }),
]);
export const oauthAccessTokenSchema = strictStruct({
	expiresAt: Schema.String,
	accessToken: Schema.String,
});
export const getOAuthAccessTokenResultSchema = hostResultSchema(oauthAccessTokenSchema);
export const invalidateOAuthAccessTokenArgsSchema = Schema.Tuple([
	strictStruct({ field: nonEmptyString, accessToken: nonEmptyString }),
]);
export const invalidateOAuthAccessTokenResultSchema = hostResultSchema(Schema.Null);
export const listIntegrationsDataSchema = Schema.Array(integrationRecordSchema);
export const getCurrentIntegrationResultSchema = hostResultSchema(integrationRecordSchema);
export const listIntegrationsResultSchema = hostResultSchema(listIntegrationsDataSchema);
export const listIntegrationsArgsSchema = Schema.Tuple([
	Schema.optionalKey(listIntegrationsOptionsSchema),
]);
