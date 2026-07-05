import { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import { EntitySchemaSlug, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

export const EntityImportPayload = Schema.Struct({
	origin: AutomationOrigin,
	scriptId: SandboxScriptId,
	externalId: Schema.String,
	executionId: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
	userId: Schema.NullOr(UserId),
});

export type EntityImportPayload = typeof EntityImportPayload.Type;
