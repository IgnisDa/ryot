import { Schema } from "effect";

import { IntegrationId } from "../../schema/brands";
import type { AppSchema } from "../../schema/property-schema";
import { integrationLots } from "./types";

const IntegrationLot = Schema.Literals([...integrationLots]);

export const IntegrationRequestFailureReason = Schema.Union([
	Schema.Struct({ provider: Schema.String, code: Schema.Literal("pro-key-required") }),
	Schema.Struct({ provider: Schema.String, code: Schema.Literal("provider-not-found") }),
	Schema.Struct({ operation: Schema.String, code: Schema.Literal("queue-unavailable") }),
	Schema.Struct({ provider: Schema.String, code: Schema.Literal("invalid-provider-settings") }),
	Schema.Struct({ integrationId: IntegrationId, code: Schema.Literal("integration-not-found") }),
	Schema.Struct({ code: Schema.Literal("integration-webhook-not-found") }),
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

const IntegrationExtraSettings = Schema.Struct({ disableOnContinuousErrors: Schema.Boolean });

export type IntegrationExtraSettings = typeof IntegrationExtraSettings.Type;

const baseCommonFields = {
	name: { label: "Name", type: "string", description: "Optional name for this integration" },
	isDisabled: {
		type: "boolean",
		label: "Disabled",
		defaultValue: false,
		description: "Disable this integration",
	},
	disableOnContinuousErrors: {
		type: "boolean",
		defaultValue: false,
		label: "Disable on continuous errors",
		description: "Disable this integration after continuous errors",
	},
} satisfies AppSchema["fields"];

const progressCommonFields = {
	minimumProgress: {
		type: "number",
		defaultValue: 2,
		label: "Minimum progress",
		validation: { minimum: 0, maximum: 100 },
		description: "Minimum progress percentage to synchronize",
	},
	maximumProgress: {
		type: "number",
		defaultValue: 95,
		label: "Maximum progress",
		validation: { minimum: 0, maximum: 100 },
		description: "Maximum progress percentage to synchronize",
	},
} satisfies AppSchema["fields"];

export const integrationCommonSchema = (lot: (typeof integrationLots)[number]): AppSchema => ({
	fields: {
		...baseCommonFields,
		...(lot === "push" ? {} : progressCommonFields),
		...(lot === "yank"
			? {
					syncOwnership: {
						defaultValue: false,
						label: "Sync ownership",
						type: "boolean" as const,
						description: "Synchronize ownership from this integration",
					},
				}
			: {}),
	},
});

/**
 * A provider form renders `commonSchema` and `settingsSchema` against one flat value record, so a
 * `settingsSchema` field sharing a name with a common one would silently collide. Plugin manifest
 * validation rejects those names.
 */
export const integrationCommonPropertyNames: ReadonlySet<string> = new Set(
	Object.keys(integrationCommonSchema("yank").fields),
);

export const IntegrationSnapshot = Schema.Struct({
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
	name: Schema.NullOr(Schema.String),
	extraSettings: IntegrationExtraSettings,
	lastFinishedAt: Schema.NullOr(Schema.String),
	providerSpecifics: IntegrationProviderSettings,
});

export type IntegrationSnapshot = typeof IntegrationSnapshot.Type;

export const CreateIntegrationBody = Schema.Struct({
	provider: IntegrationProvider,
	name: Schema.optional(Schema.String),
	isDisabled: Schema.optional(Schema.Boolean),
	providerSpecifics: IntegrationProviderSettings,
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

export const integrationWebhookUrl = (frontendOrigin: string, token: string): string =>
	`${frontendOrigin.replace(/\/$/, "")}/_i/${token}`;

export const integrationWebhookContentTypes = ["application/json", "multipart/form-data"] as const;

export const IntegrationWebhookBody = Schema.String.annotate({
	title: "Integration Webhook Body",
	identifier: "IntegrationWebhookBody",
	description: "Unparsed webhook request body, forwarded to the integration script verbatim.",
});

export type IntegrationWebhookBody = typeof IntegrationWebhookBody.Type;
