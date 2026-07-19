import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot/sandbox-sdk/testing";

import type { LogEntry, SpanEntry } from "../src/core.js";
import { defineManifest, defineScript } from "../src/driver.js";
import { type SandboxHostError, jsonValueSchema } from "../src/wire.js";
import type { Equal, Expect } from "./type-assertions.js";

const allCapabilitiesManifest = defineManifest({
	kind: "script",
	name: "All core capabilities",
	slug: "all-core-capabilities",
	requiredPluginConfigKeys: ["timezone"],
	requiredSystemConfigKeys: ["log-level"],
	capabilities: [
		"log",
		"span",
		"httpCall",
		"getCachedValue",
		"setCachedValue",
		"getPluginConfig",
		"getSystemConfig",
		"getUserPreferences",
		"claimPersistentValue",
	],
});

defineScript({
	manifest: allCapabilitiesManifest,
	input: Schema.Struct({}),
	output: Schema.Boolean,
	run: (_input, host) =>
		Effect.gen(function* () {
			const logs: ReadonlyArray<LogEntry> = [
				{ level: "info", message: "Started", attributes: { attempt: 1 } },
			];
			const spans: ReadonlyArray<SpanEntry> = [{ name: "provider.run" }];
			const logged: null = yield* host.log(logs);
			const spanned: null = yield* host.span(spans);
			void logged;
			void spanned;

			const http = yield* host.httpCall("POST", "https://example.com", {
				body: "payload",
				allowInsecureConnections: true,
				headers: { Accept: "application/json" },
			});
			const status: number = http.status;
			const headers: Readonly<Record<string, string>> = http.headers;
			void headers;
			void status;

			const cached: JsonValue | null = yield* host.getCachedValue("key");
			const stored: null = yield* host.setCachedValue("key", { nested: [true] }, 60);
			const claim = yield* host.claimPersistentValue("key", "value", 60);
			if (!claim.claimed) {
				const value: JsonValue | null = claim.value;
				void value;
			}
			const pluginConfig: Readonly<Record<string, JsonValue>> = yield* host.getPluginConfig([
				"timezone",
			]);
			const systemConfig: Readonly<Record<string, JsonValue>> = yield* host.getSystemConfig([
				"log-level",
			]);
			const preferences = yield* host.getUserPreferences();
			const isNsfw: boolean = preferences.isNsfw;
			void cached;
			void stored;
			void pluginConfig;
			void systemConfig;
			void isNsfw;

			const errorType: Expect<
				Equal<Effect.Error<ReturnType<typeof host.httpCall>>, SandboxHostError>
			> = true;
			void errorType;

			// @ts-expect-error httpCall options require a string body.
			yield* host.httpCall("POST", "https://example.com", { body: 42 });
			// @ts-expect-error httpCall insecure connection opt-in requires a boolean.
			yield* host.httpCall("POST", "https://example.com", { allowInsecureConnections: "yes" });
			// @ts-expect-error log takes exactly one batch argument.
			yield* host.log(logs, logs);
			// @ts-expect-error span entries reject excess fields.
			yield* host.span([{ name: "provider.run", extra: true }]);
			return true;
		}),
});

const narrowedManifest = defineManifest({
	kind: "script",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Narrowed capabilities",
	slug: "narrowed-capabilities",
	capabilities: ["getCachedValue"],
});
defineScript({
	manifest: narrowedManifest,
	input: Schema.Struct({}),
	output: Schema.NullOr(jsonValueSchema),
	run: (_input, host) => {
		const capabilities: Expect<Equal<keyof typeof host, "executeWorkflow" | "getCachedValue">> =
			true;
		void capabilities;
		return host.getCachedValue("key");
	},
});
defineSandboxTestHost(narrowedManifest, {
	// @ts-expect-error host methods must return Effect values, not wire Promises.
	getCachedValue: () => Promise.resolve({ data: null, success: true }),
});

const allDomainManifest = defineManifest({
	kind: "script",
	name: "All domain capabilities",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "all-domain-capabilities",
	capabilities: [
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
	],
});
defineScript({
	manifest: allDomainManifest,
	input: Schema.Struct({}),
	output: Schema.Boolean,
	run: (_input, host) =>
		Effect.gen(function* () {
			const integration = yield* host.getCurrentIntegration();
			const [entitySchema] = yield* host.getEntitySchemas(["schema-1"]);
			if (!entitySchema) {
				return false;
			}
			const lot: "push" | "sink" | "yank" = integration.lot;
			const provider: string = integration.provider;
			const setting: JsonValue | undefined = integration.providerSpecifics["customSetting"];
			yield* host.listEventSchemas(["schema-1"]);
			yield* host.listIntegrations({ provider: "plugin_defined_provider" });
			const providers: ReadonlyArray<{ readonly name: string; readonly providerId: string }> =
				entitySchema.providers;
			const created = yield* host.createEvents([
				{
					entityId: "entity-1",
					properties: { watched: true },
					eventSchemaSlug: "event-schema-1",
				},
			]);
			const [changed] = yield* host.changeUserRelationships([
				{
					deletes: [],
					creates: [
						{
							properties: {},
							sourceEntityId: "entity-1",
							targetEntityId: "library-1",
							relationshipSchemaSlug: "in-library",
						},
					],
				},
			]);
			const changedCount: number | undefined = changed?.created;
			const [ensuredEntity] = yield* host.ensureUserEntities([
				{ properties: {}, name: "Library", entitySchemaSlug: "library" },
			]);
			const ensuredEntityId: string | undefined = ensuredEntity?.entityId;
			const ensuredWasInserted: boolean | undefined = ensuredEntity?.wasInserted;
			const total: number = created.count;
			void provider;
			void setting;
			const [savedEntity] = yield* host.upsertGlobalEntities(
				[
					{
						name: "Cooper",
						populatedAt: null,
						externalId: "person-1",
						entitySchemaSlug: "person",
						properties: { role: "actor" },
					},
				],
				{ maximumTotal: 100 },
			);
			const inserted: boolean | undefined =
				savedEntity?.status === "upserted" ? savedEntity.wasInserted : undefined;
			const [reconciled] = yield* host.upsertGlobalRelationships([
				{ relationships: [], selector: { type: "self" }, relationshipSchemaSlug: "same-as" },
			]);
			const deleted: number | undefined = reconciled?.deleted;
			const query = yield* host.executeRyotql({ queries: {} });
			const queryResult: Expect<Equal<typeof query, unknown>> = true;
			const entitySchemasArg: Expect<
				Equal<Parameters<typeof host.getEntitySchemas>[0], ReadonlyArray<string>>
			> = true;
			void lot;
			void total;
			void deleted;
			void inserted;
			void providers;
			void queryResult;
			void changedCount;
			void ensuredEntityId;
			void entitySchemasArg;
			void ensuredWasInserted;
			return true;
		}),
});

const promiseScriptManifest = defineManifest({
	kind: "script",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Promise driver rejection",
	slug: "promise-driver-rejection",
});
defineScript({
	manifest: promiseScriptManifest,
	input: Schema.Struct({}),
	output: Schema.Boolean,
	// @ts-expect-error scripts must return Effect values.
	run: () => Promise.resolve(true),
});
