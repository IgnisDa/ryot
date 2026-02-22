import { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import { EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

export const EntityImportPayload = Schema.Struct({
	origin: AutomationOrigin,
	scriptId: SandboxScriptId,
	externalId: Schema.String,
	executionId: Schema.String,
	entitySchemaId: EntitySchemaId,
	userId: Schema.NullOr(UserId),
});

export type EntityImportPayload = typeof EntityImportPayload.Type;
