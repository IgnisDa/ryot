import type { SandboxHostCapability } from "@ryot/sandbox-sdk/core";
import type { JsonPrimitive, JsonValue } from "@ryot/sandbox-sdk/wire";

type SandboxSourceIdentity = {
	readonly name: string;
	readonly slug: string;
};

type ScriptModuleSourceInput = SandboxSourceIdentity & {
	readonly run: string;
	readonly inputSchema: string;
	readonly outputSchema: string;
	readonly declarations?: string;
	readonly sdkImports?: readonly string[];
	readonly requiredAppConfigKeys?: readonly string[];
	readonly capabilities: readonly SandboxHostCapability[];
};

const scriptModuleSource = (input: ScriptModuleSourceInput) => {
	const coreItems = (input.sdkImports ?? []).filter((i) => i !== "jsonValueSchema");
	const wireItems = (input.sdkImports ?? []).filter((i) => i === "jsonValueSchema");
	const wireImportLine =
		wireItems.length > 0
			? `\nimport { ${wireItems.join(", ")} } from "@ryot/sandbox-sdk/wire";`
			: "";
	const coreImportLine =
		coreItems.length > 0
			? `\nimport { ${coreItems.join(", ")} } from "@ryot/sandbox-sdk/core";`
			: "";

	return `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";${wireImportLine}${coreImportLine}
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: ${JSON.stringify(input.capabilities)},
  requiredAppConfigKeys: ${JSON.stringify(input.requiredAppConfigKeys ?? [])},
});

${input.declarations ?? ""}

export default defineScript({
  manifest,
  input: ${input.inputSchema},
  output: ${input.outputSchema},
  run: ${input.run},
});
`;
};

export function literalSandboxSource(
	input: SandboxSourceIdentity & { readonly value: Exclude<JsonPrimitive, null> },
) {
	return scriptModuleSource({
		...input,
		capabilities: [],
		inputSchema: "Schema.Struct({})",
		outputSchema: `Schema.Literal(${JSON.stringify(input.value)})`,
		run: `() => Effect.succeed(${JSON.stringify(input.value)} as const)`,
	});
}

export function observabilitySandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		capabilities: ["log", "span"],
		inputSchema: "Schema.Struct({})",
		outputSchema: "Schema.Literal(true)",
		run: `(_input, host) => Effect.gen(function* () {
    console.log("console before batch");
    console.warn("console warning");
    yield* host.log([
      {
        level: "info",
        message: "batch started",
        attributes: { scriptId: "attempted-override", nested: { z: 1, a: "value" } },
      },
      {
        level: "warning",
        message: "batch continuing",
        attributes: { items: [{ b: 2, a: true }, "done"] },
      },
    ]);
    yield* host.span([
      {
        name: "provider.batch",
        attributes: {
          executionId: "attempted-override",
          nested: { z: false, a: { d: 4, c: 3 } },
        },
      },
      { name: "provider.complete" },
    ]);
    return true as const;
  })`,
	});
}

export function httpCallSandboxSource(
	input: SandboxSourceIdentity & { readonly method?: string; readonly url: string },
) {
	return scriptModuleSource({
		...input,
		capabilities: ["httpCall"],
		inputSchema: "Schema.Struct({})",
		sdkImports: ["httpCallResultSchema"],
		outputSchema: "httpCallResultSchema",
		run: `(_input, host) => host.httpCall(${JSON.stringify(input.method ?? "GET")}, ${JSON.stringify(input.url)}).pipe(
    Effect.map((data) => ({ data, success: true as const })),
  )`,
	});
}

export function queryEngineSandboxSource(
	input: SandboxSourceIdentity & { readonly query: JsonValue },
) {
	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		sdkImports: ["jsonValueSchema"],
		outputSchema: "queryItemsSchema",
		capabilities: ["executeQueryEngine"],
		declarations: `const queryItemsSchema = Schema.Array(Schema.Unknown);
const queryResponseSchema = Schema.Struct({ data: Schema.Struct({ items: queryItemsSchema }) });
const query = Schema.decodeUnknownSync(jsonValueSchema)(JSON.parse(${JSON.stringify(JSON.stringify(input.query))}));`,
		run: `(_input, host) => Effect.gen(function* () {
    const result = yield* host.executeQueryEngine(query);
    return (yield* Schema.decodeUnknown(queryResponseSchema)(result)).data.items;
  })`,
	});
}

export function appConfigSandboxSource(
	input: SandboxSourceIdentity & {
		readonly key: string;
		readonly requiredAppConfigKeys?: readonly string[];
	},
) {
	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		outputSchema: "jsonValueSchema",
		capabilities: ["getAppConfigValue"],
		sdkImports: ["jsonValueSchema"],
		requiredAppConfigKeys: input.requiredAppConfigKeys ?? [input.key],
		run: `(_input, host) => host.getAppConfigValue(${JSON.stringify(input.key)})`,
	});
}

export function userPreferencesSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		capabilities: ["getUserPreferences"],
		outputSchema: "userPreferencesSchema",
		sdkImports: ["userPreferencesSchema"],
		run: "(_input, host) => host.getUserPreferences()",
	});
}

export function throwingSandboxSource(input: SandboxSourceIdentity & { readonly message: string }) {
	return scriptModuleSource({
		...input,
		capabilities: [],
		inputSchema: "Schema.Struct({})",
		outputSchema: "Schema.Unknown",
		run: `() => Effect.sync(() => { throw new Error(${JSON.stringify(input.message)}); })`,
	});
}

export function runtimeManifestMismatchSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		capabilities: [],
		inputSchema: "Schema.Struct({})",
		outputSchema: "Schema.Literal(true)",
		run: "() => Effect.succeed(true as const)",
		declarations: 'Object.assign(manifest, { name: "Runtime-tampered name" });',
	});
}

type CacheSandboxSourceInput = SandboxSourceIdentity &
	(
		| { readonly key: string; readonly operation: "get" }
		| { readonly key: string; readonly operation: "byInput"; readonly value: JsonValue }
		| {
				readonly key: string;
				readonly value: JsonValue;
				readonly ttlSeconds: number;
				readonly operation: "set" | "roundTrip";
		  }
	);

export function cacheSandboxSource(input: CacheSandboxSourceInput) {
	if (input.operation === "byInput") {
		return scriptModuleSource({
			...input,
			capabilities: ["setCachedValue", "getCachedValue"],
			inputSchema: 'Schema.Struct({ operation: Schema.Literal("get", "set") })',
			outputSchema: "getCachedValueResultSchema",
			sdkImports: ["getCachedValueResultSchema"],
			run: `(input, host) => Effect.gen(function* () {
    if (input.operation === "set") {
      yield* host.setCachedValue(${JSON.stringify(input.key)}, JSON.parse(${JSON.stringify(JSON.stringify(input.value))}), 60);
    }
    const data = yield* host.getCachedValue(${JSON.stringify(input.key)});
    return { data, success: true as const };
  })`,
		});
	}

	if (input.operation === "get") {
		return scriptModuleSource({
			...input,
			inputSchema: "Schema.Struct({})",
			capabilities: ["getCachedValue"],
			sdkImports: ["getCachedValueResultSchema"],
			outputSchema: "getCachedValueResultSchema",
			run: `(_input, host) => host.getCachedValue(${JSON.stringify(input.key)}).pipe(
    Effect.map((data) => ({ data, success: true as const })),
  )`,
		});
	}

	if (input.operation === "set") {
		return scriptModuleSource({
			...input,
			inputSchema: "Schema.Struct({})",
			capabilities: ["setCachedValue"],
			sdkImports: ["setCachedValueResultSchema"],
			outputSchema: "setCachedValueResultSchema",
			run: `(_input, host) => host.setCachedValue(${JSON.stringify(input.key)}, JSON.parse(${JSON.stringify(JSON.stringify(input.value))}), ${input.ttlSeconds}).pipe(
    Effect.map((data) => ({ data, success: true as const })),
  )`,
		});
	}

	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		outputSchema: "getCachedValueResultSchema",
		capabilities: ["setCachedValue", "getCachedValue"],
		sdkImports: ["getCachedValueResultSchema"],
		run: `(_input, host) => Effect.gen(function* () {
    yield* host.setCachedValue(${JSON.stringify(input.key)}, JSON.parse(${JSON.stringify(JSON.stringify(input.value))}), ${input.ttlSeconds});
    const data = yield* host.getCachedValue(${JSON.stringify(input.key)});
    return { data, success: true as const };
  })`,
	});
}

export function trendingSandboxSource(
	input: SandboxSourceIdentity & {
		readonly items: ReadonlyArray<{ readonly externalId: string; readonly name: string }>;
	},
) {
	return `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: ["upsertGlobalEntities", "upsertGlobalRelationships"],
  requiredAppConfigKeys: [],
});

const trendingResultSchema = Schema.Struct({
  items: Schema.Array(Schema.Struct({ externalId: Schema.String, name: Schema.String })),
});
const trendingResult = Schema.decodeUnknownSync(trendingResultSchema)(JSON.parse(${JSON.stringify(
		JSON.stringify({ items: input.items }),
	)}));

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Struct({ count: Schema.Number }),
  run: (_input, host) => Effect.gen(function* () {
    const entities = yield* host.upsertGlobalEntities(
      trendingResult.items.map((item) => ({
        properties: {},
        name: item.name,
        populatedAt: null,
        entitySchemaSlug: "movie",
        externalId: item.externalId,
      })),
    );
    const upsertedEntities = entities.filter((entity) => entity.status === "upserted");
    const fetchedAt = DateTime.formatIso(DateTime.unsafeNow());
    yield* host.upsertGlobalRelationships([{
      selector: { type: "self" },
      relationshipSchemaSlug: "media-trending",
      relationships: upsertedEntities.map(({ entityId }, index) => ({
        sourceEntityId: entityId,
        targetEntityId: entityId,
        properties: { rank: index + 1, fetchedAt },
      })),
    }]);
    return { count: upsertedEntities.length };
  }),
});
`;
}

export function bootSandboxSource(
	input: SandboxSourceIdentity & {
		readonly externalId: string;
		readonly entitySchemaSlug: string;
	},
) {
	return `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: ["upsertGlobalEntities"],
  requiredAppConfigKeys: [],
});

export default defineScript({
  manifest,
  input: Schema.Unknown,
  output: Schema.Struct({ count: Schema.Number }),
  run: (_input, host) => Effect.gen(function* () {
    const entities = yield* host.upsertGlobalEntities([
      {
        properties: {},
        populatedAt: null,
        name: ${JSON.stringify(input.name)},
        entitySchemaSlug: ${JSON.stringify(input.entitySchemaSlug)},
        externalId: ${JSON.stringify(input.externalId)},
      },
    ]);
    return { count: entities.filter((entity) => entity.status === "upserted").length };
  }),
});
`;
}

export function operationSandboxSource(input: SandboxSourceIdentity) {
	return `
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineOperation } from "@ryot/sandbox-sdk/operation";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "operation",
  capabilities: [],
  requiredAppConfigKeys: [],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineOperation({
  manifest,
  input: Schema.Struct({ titles: Schema.Array(Schema.String) }),
  output: Schema.Struct({ results: Schema.Array(Schema.String) }),
  run: (input) => Effect.succeed({ results: input.titles.map((title) => title.toUpperCase()) }),
});
`;
}
