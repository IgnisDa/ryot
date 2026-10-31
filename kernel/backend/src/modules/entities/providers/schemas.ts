import {
	EntitySchemaSlug,
	PluginId,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

import { DomainLifecycleCommand } from "#modules/entities/write-context";

const providerEntityPayloadFields = {
	pluginId: PluginId,
	externalId: Schema.String,
	executionId: Schema.String,
	providerId: SandboxProviderId,
	entitySchemaSlug: EntitySchemaSlug,
} as const;

export const entityImportPayloadFields = {
	...providerEntityPayloadFields,
	command: DomainLifecycleCommand,
} as const;

export const PopulationLevel = Schema.Literals(["base", "full"]);
export type PopulationLevel = typeof PopulationLevel.Type;

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
