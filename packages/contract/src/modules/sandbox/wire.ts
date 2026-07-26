import { Schema } from "effect";

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
export type JsonValue =
	| JsonPrimitive
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

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
