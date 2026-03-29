import { Schema } from "effect";

import {
	EntityId,
	EntitySchemaSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxScriptId,
	SignalId,
	SubscriptionRunId,
	UserId,
} from "../../schema/brands";
import { SubscriptionRunStatus } from "../automations/schemas";
import { SandboxScriptMetadata } from "../sandbox/schemas";

export const TestSupportStoredSandboxScript = Schema.Struct({
	id: SandboxScriptId,
	slug: Schema.String,
	name: Schema.String,
	source: Schema.String,
	compiledCode: Schema.String,
	compiledFormat: Schema.Number,
	metadata: SandboxScriptMetadata,
});

export type TestSupportStoredSandboxScript = typeof TestSupportStoredSandboxScript.Type;

export const TestSupportGlobalRelationship = Schema.Struct({
	id: RelationshipId,
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	createdAt: Schema.String,
	properties: Schema.Unknown,
	relationshipSchemaSlug: RelationshipSchemaSlug,
});

export const TestSupportSignal = Schema.Struct({
	id: SignalId,
	createdAt: Schema.String,
	actorUserId: Schema.NullOr(UserId),
	recipientUserIds: Schema.Array(UserId),
	subjectEntityId: Schema.NullOr(EntityId),
});

export const TestSupportSubscriptionRun = Schema.Struct({
	id: SubscriptionRunId,
	status: SubscriptionRunStatus,
});

export const TestSupportBuiltinEntitySchema = Schema.Struct({
	id: EntitySchemaSlug,
	slug: Schema.String,
	name: Schema.String,
});

export const TestSupportEntityTranslation = Schema.Struct({
	language: Schema.String,
	populatedAt: Schema.String,
	name: Schema.NullOr(Schema.String),
	properties: Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});
