import { EntitySchemaSlug, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

import { LifecycleCommand } from "#lib/domain/lifecycle-command";

const providerEntityPayloadFields = {
	externalId: Schema.String,
	executionId: Schema.String,
	providerId: SandboxProviderId,
	entitySchemaSlug: EntitySchemaSlug,
} as const;

export const entityImportPayloadFields = {
	...providerEntityPayloadFields,
	command: LifecycleCommand,
} as const;

export const EntityImportScope = Schema.Union([
	Schema.Struct({ userId: Schema.NullOr(UserId), type: Schema.Literal("global") }),
	Schema.Struct({ userId: UserId, type: Schema.Literal("user") }),
]);

export const EntityImportPayload = Schema.Struct({
	...entityImportPayloadFields,
	entityScope: EntityImportScope,
});
export type EntityImportPayload = typeof EntityImportPayload.Type;

export const ProviderEntityImportWorkflowPayload = Schema.Struct({
	...entityImportPayloadFields,
	entityScope: Schema.Union([
		Schema.Struct({ userId: UserId, type: Schema.Literal("global") }),
		Schema.Struct({ userId: UserId, type: Schema.Literal("user") }),
	]),
});
export type ProviderEntityImportWorkflowPayload = typeof ProviderEntityImportWorkflowPayload.Type;
