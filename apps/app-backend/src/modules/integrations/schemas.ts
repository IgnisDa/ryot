import { Schema } from "effect";

export const CreateIntegrationBody = Schema.Struct({
	provider: Schema.String,
	providerSpecifics: Schema.Unknown,
	name: Schema.optional(Schema.String),
	isDisabled: Schema.optional(Schema.Boolean),
	syncOwnership: Schema.optional(Schema.Boolean),
	extraSettings: Schema.optional(Schema.Unknown),
	minimumProgress: Schema.optional(Schema.Number),
	maximumProgress: Schema.optional(Schema.Number),
});

export type CreateIntegrationBody = typeof CreateIntegrationBody.Type;

export const UpdateIntegrationBody = Schema.Struct({
	name: Schema.optional(Schema.String),
	isDisabled: Schema.optional(Schema.Boolean),
	syncOwnership: Schema.optional(Schema.Boolean),
	extraSettings: Schema.optional(Schema.Unknown),
	minimumProgress: Schema.optional(Schema.Number),
	maximumProgress: Schema.optional(Schema.Number),
	providerSpecifics: Schema.optional(Schema.Unknown),
});

export type UpdateIntegrationBody = typeof UpdateIntegrationBody.Type;
