import { Schema } from "effect";

import { IntegrationId } from "../../schema/brands";
import { integrationLots } from "./types";

const IntegrationLot = Schema.Literals([...integrationLots]);

export const IntegrationProvider = Schema.String;

export type IntegrationProvider = typeof IntegrationProvider.Type;

export const IntegrationProviderSettings = Schema.Record(Schema.String, Schema.Unknown);

export type IntegrationProviderSettings = typeof IntegrationProviderSettings.Type;

const IntegrationExtraSettings = Schema.Struct({
	disableOnContinuousErrors: Schema.Boolean,
});

export type IntegrationExtraSettings = typeof IntegrationExtraSettings.Type;

export const ListedIntegration = Schema.Struct({
	id: IntegrationId,
	lot: IntegrationLot,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	isDisabled: Schema.Boolean,
	provider: IntegrationProvider,
	syncOwnership: Schema.Boolean,
	minimumProgress: Schema.Number,
	maximumProgress: Schema.Number,
	extraSettings: IntegrationExtraSettings,
	name: Schema.NullOr(Schema.String),
	providerSpecifics: IntegrationProviderSettings,
	webhookUrl: Schema.optional(Schema.String),
	lastFinishedAt: Schema.NullOr(Schema.String),
});

export type ListedIntegration = typeof ListedIntegration.Type;

export const CreateIntegrationBody = Schema.Struct({
	provider: IntegrationProvider,
	name: Schema.optional(Schema.String),
	providerSpecifics: IntegrationProviderSettings,
	isDisabled: Schema.optional(Schema.Boolean),
	syncOwnership: Schema.optional(Schema.Boolean),
	minimumProgress: Schema.optional(Schema.Number),
	maximumProgress: Schema.optional(Schema.Number),
	extraSettings: Schema.optional(IntegrationExtraSettings),
});

export type CreateIntegrationBody = typeof CreateIntegrationBody.Type;

export const UpdateIntegrationBody = Schema.Struct({
	name: Schema.optional(Schema.String),
	isDisabled: Schema.optional(Schema.Boolean),
	syncOwnership: Schema.optional(Schema.Boolean),
	minimumProgress: Schema.optional(Schema.Number),
	maximumProgress: Schema.optional(Schema.Number),
	extraSettings: Schema.optional(IntegrationExtraSettings),
	providerSpecifics: Schema.optional(IntegrationProviderSettings),
});

export type UpdateIntegrationBody = typeof UpdateIntegrationBody.Type;

export type IntegrationWebhookPayload =
	| null
	| string
	| number
	| boolean
	| ReadonlyArray<IntegrationWebhookPayload>
	| { readonly [key: string]: IntegrationWebhookPayload };

export const IntegrationWebhookPayload: Schema.Codec<IntegrationWebhookPayload, unknown> =
	Schema.suspend(() =>
		Schema.Union([
			Schema.Null,
			Schema.String,
			Schema.Number,
			Schema.Boolean,
			Schema.Array(IntegrationWebhookPayload),
			Schema.Record(Schema.String, IntegrationWebhookPayload),
		]),
	).annotate({
		title: "Integration Webhook Payload",
		identifier: "IntegrationWebhookPayload",
	});
