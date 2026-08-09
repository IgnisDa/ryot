import { AutomationOrigin } from "@ryot-app/contract/modules/automations/schemas";
import { EntitySchemaSlug, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

export const EntityImportPayload = Schema.Struct({
	origin: AutomationOrigin,
	externalId: Schema.String,
	executionId: Schema.String,
	providerId: SandboxProviderId,
	entitySchemaSlug: EntitySchemaSlug,
	userId: Schema.NullOr(UserId),
	entityScope: Schema.optional(Schema.Literals(["global", "user"])),
});

export type EntityImportPayload = typeof EntityImportPayload.Type;
