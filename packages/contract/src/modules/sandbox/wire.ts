import { Schema } from "effect";

import type { JsonValue } from "../ryotql/language";

export type { JsonValue };

export const SANDBOX_HOST_CAPABILITIES = [
	"log",
	"span",
	"httpCall",
	"getCachedValue",
	"setCachedValue",
	"getPluginConfig",
	"getSystemConfig",
	"getUserPreferences",
	"claimPersistentValue",
	"createEvents",
	"getEntitySchemas",
	"listEventSchemas",
	"listIntegrations",
	"executeRyotql",
	"ensureUserEntities",
	"upsertGlobalEntities",
	"getCurrentIntegration",
	"changeUserRelationships",
	"upsertGlobalRelationships",
	"emitSignal",
	"sendNotification",
	"scratch",
	"artifact-read",
] as const;

export type SandboxHostCapability = (typeof SANDBOX_HOST_CAPABILITIES)[number];

export type JsonPrimitive = boolean | number | string | null;

export const jsonValueSchema: Schema.Codec<JsonValue, JsonValue> = Schema.suspend(() =>
	Schema.Union([
		Schema.Null,
		Schema.String,
		Schema.Finite,
		Schema.Boolean,
		Schema.Array(jsonValueSchema),
		Schema.Record(Schema.String, jsonValueSchema),
	]),
).pipe(Schema.annotate({ identifier: "JsonValue" }));
