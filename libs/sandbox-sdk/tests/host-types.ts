import {
	defineDriver,
	defineManifest,
	jsonValueSchema,
	type JsonValue,
	type SandboxHostError,
} from "@ryot/sandbox-sdk/core";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot/sandbox-sdk/testing";

import type { Equal, Expect } from "./type-assertions.js";

const allCapabilitiesManifest = defineManifest({
	kind: "script",
	name: "All core capabilities",
	slug: "all-core-capabilities",
	requiredAppConfigKeys: ["timezone"],
	capabilities: [
		"httpCall",
		"getCachedValue",
		"setCachedValue",
		"claimCachedValue",
		"getAppConfigValue",
		"getUserPreferences",
	],
});

defineDriver(allCapabilitiesManifest, {
	input: Schema.Struct({}),
	output: Schema.Boolean,
	run: (_input, host) =>
		Effect.gen(function* () {
			const http = yield* host.httpCall("POST", "https://example.com", {
				body: "payload",
				headers: { Accept: "application/json" },
			});
			const status: number = http.status;
			const headers: Readonly<Record<string, string>> = http.headers;
			void headers;
			void status;

			const cached: JsonValue | null = yield* host.getCachedValue("key");
			const stored: null = yield* host.setCachedValue("key", { nested: [true] }, 60);
			const claim = yield* host.claimCachedValue("key", "value", 60);
			if (!claim.claimed) {
				const value: JsonValue | null = claim.value;
				void value;
			}
			const config: JsonValue = yield* host.getAppConfigValue("timezone");
			const preferences = yield* host.getUserPreferences();
			const isNsfw: boolean = preferences.isNsfw;
			void cached;
			void stored;
			void config;
			void isNsfw;

			const errorType: Expect<
				Equal<Effect.Effect.Error<ReturnType<typeof host.httpCall>>, SandboxHostError>
			> = true;
			void errorType;

			// @ts-expect-error httpCall options require a string body.
			yield* host.httpCall("POST", "https://example.com", { body: 42 });
			return true;
		}),
});

const narrowedManifest = defineManifest({
	kind: "script",
	requiredAppConfigKeys: [],
	name: "Narrowed capabilities",
	slug: "narrowed-capabilities",
	capabilities: ["getCachedValue"],
});
defineDriver(narrowedManifest, {
	input: Schema.Struct({}),
	output: Schema.NullOr(jsonValueSchema),
	run: (_input, host) => {
		const capabilities: Expect<Equal<keyof typeof host, "getCachedValue">> = true;
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
	requiredAppConfigKeys: [],
	slug: "all-domain-capabilities",
	capabilities: [
		"getEntity",
		"listEvents",
		"createEvents",
		"getIntegration",
		"getEntitySchema",
		"listEventSchemas",
		"listIntegrations",
		"executeQueryEngine",
	],
});
defineDriver(allDomainManifest, {
	input: Schema.Struct({}),
	output: Schema.Boolean,
	run: (_input, host) =>
		Effect.gen(function* () {
			const entity = yield* host.getEntity("entity-1");
			const properties: JsonValue = entity.properties;
			const externalId: string | null = entity.externalId;
			const entitySchema = yield* host.getEntitySchema("schema-1");
			const providers: ReadonlyArray<{ readonly name: string; readonly scriptId: string }> =
				entitySchema.providers;
			const integration = yield* host.getIntegration("integration-1");
			const lot: "push" | "sink" | "yank" = integration.lot;
			const events = yield* host.listEvents({ entityId: "entity-1" });
			const occurredAt: string = events[0]?.occurredAt ?? "";
			yield* host.listEventSchemas("schema-1");
			yield* host.listIntegrations({ provider: "plex_yank" });
			const created = yield* host.createEvents([
				{
					entityId: "entity-1",
					eventSchemaSlug: "event-schema-1",
					properties: { watched: true },
				},
			]);
			const total: number = created.count;
			const query = yield* host.executeQueryEngine({ source: { type: "entities" } });
			const queryResult: Expect<Equal<typeof query, unknown>> = true;
			const entityArg: Expect<Equal<Parameters<typeof host.getEntity>[0], string>> = true;
			void properties;
			void externalId;
			void providers;
			void lot;
			void occurredAt;
			void total;
			void queryResult;
			void entityArg;

			// @ts-expect-error listIntegrations only accepts supported providers.
			yield* host.listIntegrations({ provider: "not-a-provider" });
			return true;
		}),
});

const promiseDriverManifest = defineManifest({
	kind: "script",
	name: "Promise driver rejection",
	slug: "promise-driver-rejection",
	requiredAppConfigKeys: [],
	capabilities: [],
});
defineDriver(promiseDriverManifest, {
	input: Schema.Struct({}),
	output: Schema.Boolean,
	// @ts-expect-error drivers must return Effect values.
	run: () => Promise.resolve(true),
});
