import { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import { EntitySchemaSlug, SandboxProviderId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

export const EntityImportPayload = Schema.Struct({
	origin: AutomationOrigin,
	externalId: Schema.String,
	executionId: Schema.String,
	providerId: SandboxProviderId,
	entitySchemaSlug: EntitySchemaSlug,
	userId: Schema.NullOr(UserId),
});

export type EntityImportPayload = typeof EntityImportPayload.Type;
