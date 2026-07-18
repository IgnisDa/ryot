import { AutomationOrigin } from "@ryot-app/contract/modules/automations/schemas";
import { EntitySchemaSlug, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

export const entityImportPayloadFields = {
	origin: AutomationOrigin,
	externalId: Schema.String,
	executionId: Schema.String,
	providerId: SandboxProviderId,
	entitySchemaSlug: EntitySchemaSlug,
} as const;

export const EntityImportScope = Schema.Union([
	Schema.Struct({ type: Schema.Literal("global"), userId: Schema.NullOr(UserId) }),
	Schema.Struct({ type: Schema.Literal("user"), userId: UserId }),
]);

export const EntityImportPayload = Schema.Struct({
	...entityImportPayloadFields,
	entityScope: EntityImportScope,
});

export type EntityImportPayload = typeof EntityImportPayload.Type;
