import {
	defineDriver,
	defineManifest,
	type JsonValue,
	jsonValueSchema,
} from "@ryot/sandbox-sdk/core";
import * as z from "@ryot/sandbox-sdk/zod";

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
	input: z.object({}),
	output: z.boolean(),
	run: async (_input, host) => {
		const http = await host.httpCall("POST", "https://example.com", {
			body: "payload",
			headers: { Accept: "application/json" },
		});
		if (http.success) {
			const status: number = http.data.status;
			const headers: Record<string, string> = http.data.headers;
			void headers;
			void status;
		} else if (http.data) {
			const status: number = http.data.status;
			void status;
		}

		const cached = await host.getCachedValue("key");
		if (cached.success) {
			const value: JsonValue | null = cached.data;
			void value;
		}

		const stored = await host.setCachedValue("key", { nested: [true] }, 60);
		if (stored.success) {
			const value: null = stored.data;
			void value;
		}

		const claim = await host.claimCachedValue("key", "value", 60);
		if (claim.success && !claim.data.claimed) {
			const value: JsonValue | null = claim.data.value;
			void value;
		}

		const config = await host.getAppConfigValue("timezone");
		if (config.success) {
			const value: JsonValue = config.data;
			void value;
		}

		const preferences = await host.getUserPreferences();
		if (preferences.success) {
			const isNsfw: boolean = preferences.data.isNsfw;
			void isNsfw;
		}

		// @ts-expect-error httpCall options require a string body.
		await host.httpCall("POST", "https://example.com", { body: 42 });

		return true;
	},
});

const narrowedManifest = defineManifest({
	kind: "script",
	requiredAppConfigKeys: [],
	name: "Narrowed capabilities",
	slug: "narrowed-capabilities",
	capabilities: ["getCachedValue"],
});

defineDriver(narrowedManifest, {
	input: z.object({}),
	output: jsonValueSchema.nullable(),
	run: async (_input, host) => {
		const result = await host.getCachedValue("key");

		const capabilities: Expect<Equal<keyof typeof host, "getCachedValue">> = true;
		void capabilities;

		return result.success ? result.data : null;
	},
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
	input: z.object({}),
	output: z.boolean(),
	run: async (_input, host) => {
		const entity = await host.getEntity("entity-1");
		if (entity.success) {
			const properties: JsonValue = entity.data.properties;
			const externalId: string | null = entity.data.externalId;
			void properties;
			void externalId;
		}

		const entitySchema = await host.getEntitySchema("schema-1");
		if (entitySchema.success) {
			const providers: ReadonlyArray<{ name: string; scriptId: string }> =
				entitySchema.data.providers;
			void providers;
		}

		const integration = await host.getIntegration("integration-1");
		if (integration.success) {
			const lot: "push" | "sink" | "yank" = integration.data.lot;
			void lot;
		}

		const events = await host.listEvents({ entityId: "entity-1" });
		if (events.success) {
			const occurredAt: string = events.data[0]?.occurredAt ?? "";
			void occurredAt;
		}

		const eventSchemas = await host.listEventSchemas("schema-1");
		void eventSchemas;

		const integrations = await host.listIntegrations({ provider: "plex_yank" });
		void integrations;

		const created = await host.createEvents([
			{ entityId: "entity-1", eventSchemaSlug: "event-schema-1", properties: { watched: true } },
		]);
		if (created.success) {
			const total: number = created.data.count;
			void total;
		}

		const query = await host.executeQueryEngine({ source: { type: "entities" } });
		if (query.success) {
			const queryResult: Expect<Equal<typeof query.data, unknown>> = true;
			void queryResult;
		}

		const entityArg: Expect<Equal<Parameters<typeof host.getEntity>[0], string>> = true;
		void entityArg;

		// @ts-expect-error listIntegrations only accepts supported providers.
		await host.listIntegrations({ provider: "not-a-provider" });

		return true;
	},
});

const narrowedDomainManifest = defineManifest({
	kind: "script",
	requiredAppConfigKeys: [],
	capabilities: ["getEntity"],
	name: "Narrowed domain capabilities",
	slug: "narrowed-domain-capabilities",
});

defineDriver(narrowedDomainManifest, {
	input: z.object({}),
	output: z.boolean(),
	run: async (_input, host) => {
		await host.getEntity("entity-1");

		const capabilities: Expect<Equal<keyof typeof host, "getEntity">> = true;
		void capabilities;

		return true;
	},
});
