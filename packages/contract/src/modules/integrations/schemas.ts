import { Schema } from "effect";

import { IntegrationId } from "../../schema/brands";
import { AppSchema } from "../../schema/property-schema";
import { integrationLots } from "./types";

const IntegrationLot = Schema.Literals([...integrationLots]);

export const IntegrationRequestFailureReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("provider-not-found"), provider: Schema.String }),
	Schema.Struct({ code: Schema.Literal("invalid-provider-settings"), provider: Schema.String }),
	Schema.Struct({ code: Schema.Literal("integration-not-found"), integrationId: IntegrationId }),
	Schema.Struct({ code: Schema.Literal("queue-unavailable"), operation: Schema.String }),
	Schema.Struct({
		value: Schema.Number,
		code: Schema.Literal("progress-out-of-range"),
		field: Schema.Literals(["minimumProgress", "maximumProgress"]),
	}),
	Schema.Struct({
		minimumProgress: Schema.Number,
		maximumProgress: Schema.Number,
		code: Schema.Literal("invalid-progress-range"),
	}),
	Schema.Struct({
		actual: IntegrationLot,
		expected: IntegrationLot,
		integrationId: IntegrationId,
		code: Schema.Literal("wrong-integration-lot"),
	}),
]);

export type IntegrationRequestFailureReason = typeof IntegrationRequestFailureReason.Type;

export class IntegrationRequestError extends Schema.TaggedError<IntegrationRequestError>()(
	"IntegrationRequestError",
	{ reason: IntegrationRequestFailureReason },
) {}

export class IntegrationNotFoundError extends Schema.TaggedError<IntegrationNotFoundError>()(
	"IntegrationNotFoundError",
	{ reason: IntegrationRequestFailureReason },
) {}

export const IntegrationProvider = Schema.String;

export type IntegrationProvider = typeof IntegrationProvider.Type;

export const IntegrationProviderSettings = Schema.Record(Schema.String, Schema.Unknown);

export type IntegrationProviderSettings = typeof IntegrationProviderSettings.Type;

const IntegrationExtraSettings = Schema.Struct({
	disableOnContinuousErrors: Schema.Boolean,
});

export type IntegrationExtraSettings = typeof IntegrationExtraSettings.Type;

/**
 * A provider form renders `commonSchema` and `settingsSchema` against one flat value record, so a
 * `settingsSchema` field sharing a name with a common one would silently collide. Plugin manifest
 * validation rejects those names.
 */
export const integrationCommonPropertyNames: ReadonlySet<string> = new Set([
	"name",
	"isDisabled",
	"syncOwnership",
	"minimumProgress",
	"maximumProgress",
	"disableOnContinuousErrors",
]);

export const ListedIntegrationProvider = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	lot: IntegrationLot,
	commonSchema: AppSchema,
	settingsSchema: AppSchema,
	pluginSlug: Schema.String,
	description: Schema.String,
	isCreatable: Schema.Boolean,
});

export type ListedIntegrationProvider = typeof ListedIntegrationProvider.Type;

export const ListedIntegration = Schema.Struct({
	id: IntegrationId,
	lot: IntegrationLot,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	pluginSlug: Schema.String,
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
