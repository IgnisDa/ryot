import type { JsonPrimitive, JsonValue } from "@ryot-app/contract/schema/json";

import { sourceLiteral } from "~/support/source-literal";

type SandboxSourceIdentity = { readonly name: string; readonly slug: string };

type ScriptModuleSourceInput = SandboxSourceIdentity & {
	readonly run: string;
	readonly inputSchema: string;
	readonly outputSchema: string;
	readonly declarations?: string;
	readonly filesystemImport?: boolean;
	readonly sdkImports?: readonly string[];
	readonly ryotqlImports?: readonly string[];
};

const scriptModuleSource = (input: ScriptModuleSourceInput) => {
	const coreItems = (input.sdkImports ?? []).filter((i) => i !== "jsonValueSchema");
	const wireItems = (input.sdkImports ?? []).filter((i) => i === "jsonValueSchema");
	const wireImportLine =
		wireItems.length > 0
			? `\nimport { ${wireItems.join(", ")} } from "@ryot-app/plugin-backend-sdk/wire";`
			: "";
	const coreImportLine =
		coreItems.length > 0
			? `\nimport { ${coreItems.join(", ")} } from "@ryot-app/plugin-backend-sdk/core";`
			: "";
	const ryotqlImportLine =
		input.ryotqlImports && input.ryotqlImports.length > 0
			? `\nimport { ${input.ryotqlImports.join(", ")} } from "@ryot-app/plugin-backend-sdk/ryotql";`
			: "";
	const filesystemImportLine = input.filesystemImport
		? '\nimport { writeScratchChunks } from "@ryot-app/plugin-backend-sdk/filesystem";'
		: "";

	return `
 import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";${wireImportLine}${coreImportLine}${ryotqlImportLine}${filesystemImportLine}
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: ${sourceLiteral(input.name)},
  slug: ${sourceLiteral(input.slug)},
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

type CacheSandboxSourceInput = SandboxSourceIdentity &
	(
		| { readonly key: string; readonly operation: "get" }
		| { readonly key: string; readonly value: JsonValue; readonly operation: "byInput" }
		| {
				readonly key: string;
				readonly value: JsonValue;
				readonly ttlSeconds: number;
				readonly operation: "claimPersistent";
		  }
		| {
				readonly key: string;
				readonly value: JsonValue;
				readonly ttlSeconds: number;
				readonly operation: "set" | "roundTrip";
		  }
	);

export function noChangesSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		run: "() => Effect.succeed({})",
		inputSchema: "Schema.Struct({})",
		outputSchema: "changesOutputSchema",
		sdkImports: ["changesOutputSchema"],
	});
}

export function userPreferencesSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		outputSchema: "userPreferencesSchema",
		sdkImports: ["userPreferencesSchema"],
		run: "(_input, host) => host.getUserPreferences()",
	});
}

export function throwingSandboxSource(input: SandboxSourceIdentity & { readonly message: string }) {
	return scriptModuleSource({
		...input,
		outputSchema: "Schema.Unknown",
		inputSchema: "Schema.Struct({})",
		run: `() => Effect.sync(() => { throw new Error(${sourceLiteral(input.message)}); })`,
	});
}

export function runtimeManifestMismatchSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		outputSchema: "Schema.Literal(true)",
		run: "() => Effect.succeed(true as const)",
		declarations: 'Object.assign(manifest, { name: "Runtime-tampered name" });',
	});
}

export function literalSandboxSource(
	input: SandboxSourceIdentity & { readonly value: Exclude<JsonPrimitive, null> },
) {
	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		outputSchema: `Schema.Literal(${sourceLiteral(input.value)})`,
		run: `() => Effect.succeed(${sourceLiteral(input.value)} as const)`,
	});
}

export function processFailureSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		outputSchema: "Schema.Literal(true)",
		run: `() => Effect.sync(() => {
    console.log("before sandbox failure");
    throw new Error("native sandbox failure: " + "診断".repeat(64 * 1024) + ":diagnostic-end");
  })`,
	});
}

export function scratchEntryLimitSandboxSource(
	input: SandboxSourceIdentity & { readonly chunkCount: number },
) {
	return scriptModuleSource({
		...input,
		filesystemImport: true,
		inputSchema: "Schema.Struct({})",
		outputSchema: "Schema.Struct({ chunkFiles: Schema.Array(Schema.String) })",
		run: `() => writeScratchChunks(Array.from({ length: ${input.chunkCount} }, (_, index) => ({
    name: \`chunk-\${index}.json\`,
    contents: "",
  })))`,
	});
}

export function httpCallSandboxSource(
	input: SandboxSourceIdentity & { readonly url: string; readonly method?: string },
) {
	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		sdkImports: ["httpCallResultSchema"],
		outputSchema: "httpCallResultSchema",
		run: `(_input, host) => host.httpCall(${sourceLiteral(input.method ?? "GET")}, ${sourceLiteral(input.url)}).pipe(
    Effect.map((data) => ({ data, success: true as const })),
  )`,
	});
}

export function pluginConfigSandboxSource(
	input: SandboxSourceIdentity & {
		readonly keys: readonly string[];
		readonly optionalKeys?: readonly string[];
	},
) {
	return scriptModuleSource({
		...input,
		sdkImports: ["jsonValueSchema"],
		inputSchema: "Schema.Struct({})",
		outputSchema: "Schema.Record(Schema.String, jsonValueSchema)",
		run: `(_input, host) => host.getPluginConfig({ required: ${sourceLiteral(input.keys)}, optional: ${sourceLiteral(input.optionalKeys ?? [])} })`,
	});
}

export function entityRowsSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		outputSchema: "Schema.Array(Schema.Unknown)",
		ryotqlImports: ["entityReadRecipe", "executeRyotqlRecipe"],
		inputSchema: "Schema.Struct({ ids: Schema.Array(Schema.String) })",
		run: `(input, host) => input.ids.length === 0
    ? Effect.succeed([])
	    : executeRyotqlRecipe(host.executeRyotql, entityReadRecipe, { entityIds: input.ids }).pipe(Effect.map((result) => result.items))`,
	});
}

export function eventRowsSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		outputSchema: "Schema.Array(Schema.Unknown)",
		ryotqlImports: ["eventReadRecipe", "executeRyotqlRecipe"],
		inputSchema:
			"Schema.Struct({ entityId: Schema.String, entitySchemaSlug: Schema.String, eventSchemaSlug: Schema.String })",
		run: `(input, host) => executeRyotqlRecipe(host.executeRyotql, eventReadRecipe({
        owner: { kind: "self" },
        entitySchemaSlug: input.entitySchemaSlug,
        eventSchemaSlug: input.eventSchemaSlug,
	      }), { entityId: input.entityId }).pipe(Effect.map((result) => result.items))`,
	});
}

export function deepThrowingSandboxSource(
	input: SandboxSourceIdentity & { readonly message: string },
) {
	const frameCount = 12;
	const frames = Array.from({ length: frameCount }, (_, index) => {
		const frameName = `sandboxFrame${index}`;
		if (index === frameCount - 1) {
			return `const ${frameName} = () => { throw new Error(${sourceLiteral(input.message)}); };`;
		}
		return `const ${frameName} = () => sandboxFrame${index + 1}();`;
	}).join("\n");

	return scriptModuleSource({
		...input,
		outputSchema: "Schema.Unknown",
		inputSchema: "Schema.Struct({})",
		run: `() => Effect.sync(() => {
    ${frames}
    return sandboxFrame0();
  })`,
	});
}

export function httpCallFailureSandboxSource(
	input: SandboxSourceIdentity & { readonly url: string; readonly method?: string },
) {
	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		sdkImports: ["httpCallResultSchema"],
		outputSchema: "httpCallResultSchema",
		run: `(_input, host) => host.httpCall(${sourceLiteral(input.method ?? "GET")}, ${sourceLiteral(input.url)}).pipe(
    Effect.map((data) => ({ data, success: true as const })),
    Effect.catch((error) => Effect.succeed({
      error: error.message,
      success: false as const,
      data: error.data as { body: string; status: number; headers: Record<string, string> },
    })),
  )`,
	});
}

export function operationSandboxSource(input: SandboxSourceIdentity) {
	return `
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
  kind: "operation",
  name: ${sourceLiteral(input.name)},
  slug: ${sourceLiteral(input.slug)},
});

export default defineOperation({
  manifest,
  input: Schema.Struct({ titles: Schema.Array(Schema.String) }),
  output: Schema.Struct({ results: Schema.Array(Schema.String) }),
  run: (input) => Effect.succeed({ output: { results: input.titles.map((title) => title.toUpperCase()) } }),
});
`;
}

export function cronActivityWorkflowSandboxSource(
	input: SandboxSourceIdentity & { readonly activitySlug: string },
) {
	return `
import { defineManifest, defineScriptReference, defineWorkflow, Effect, Schema } from "@ryot-app/plugin-backend-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  name: ${sourceLiteral(input.name)},
  slug: ${sourceLiteral(input.slug)},
});

const activity = defineScriptReference({
  input: Schema.Struct({}),
  output: Schema.Unknown,
  scriptSlug: ${sourceLiteral(input.activitySlug)},
});

export default defineWorkflow({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Unknown,
  run: (_input, step) => Effect.gen(function* () {
    return { output: yield* step.activity("run", activity, {}) };
  }),
});
`;
}

export function observabilitySandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
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

export function ryotqlSandboxSource(
	input: SandboxSourceIdentity & { readonly query: JsonValue; readonly queryName: string },
) {
	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		ryotqlImports: ["type PluginRyotQLDocument"],
		outputSchema: "Schema.Array(Schema.Unknown)",
		declarations: `const queryName = ${sourceLiteral(input.queryName)};
const query: PluginRyotQLDocument = ${JSON.stringify(input.query)};`,
		run: `(_input, host) => Effect.gen(function* () {
    const result = yield* host.executeRyotql({ source: { kind: "inline", document: query } });
    const envelope = yield* Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Record(Schema.String, Schema.Struct({ type: Schema.Literal("rows"), items: Schema.Array(Schema.Unknown) })) }))(result);
    const rows = envelope.data[queryName];
    if (!rows) return yield* Effect.fail(new Error("Expected a rows result"));
    const items = rows.items;
    return items;
   })`,
	});
}

export function pluginConfigOperationSandboxSource(
	input: SandboxSourceIdentity & { readonly configKey: string; readonly transform?: string },
) {
	const configKey = sourceLiteral(input.configKey);
	return `
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
  kind: "operation",
  name: ${sourceLiteral(input.name)},
  slug: ${sourceLiteral(input.slug)},
});

export default defineOperation({
  manifest,
  input: Schema.Struct({ prefix: Schema.String }),
  output: Schema.Struct({ label: Schema.String }),
  run: (input, host) => Effect.gen(function* () {
    const config = yield* host.getPluginConfig({ required: [${configKey}] });
    const value = String(config[${configKey}]);
    return { output: { label: input.prefix + ":" + (${input.transform ?? "value"}) } };
  }),
});
`;
}

export function integrationReadOperationSandboxSource(
	input: SandboxSourceIdentity & { readonly providerSlug: string },
) {
	return `
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { integrationRecordSchema } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
  kind: "operation",
  name: ${sourceLiteral(input.name)},
  slug: ${sourceLiteral(input.slug)},
});

export default defineOperation({
  manifest,
  input: Schema.Struct({ integrationId: Schema.String }),
  output: Schema.Struct({
    current: integrationRecordSchema,
    enabled: Schema.Array(integrationRecordSchema),
  }),
  run: (_input, host) => Effect.gen(function* () {
    const current = yield* host.getCurrentIntegration();
    const enabled = yield* host.listIntegrations({ provider: ${sourceLiteral(input.providerSlug)}, isDisabled: false });
    return { output: { current, enabled: enabled.items } };
  }),
});
`;
}

export function systemRyotqlProbeSandboxSource(
	input: SandboxSourceIdentity & {
		readonly query: JsonValue;
		readonly queryName: string;
		readonly entitySchemaSlug: string;
	},
) {
	return `
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { PluginRyotQLDocument } from "@ryot-app/plugin-backend-sdk/ryotql";
import { defineActivityWithChanges, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

export const manifest = defineManifest({
  kind: "script",
  name: ${sourceLiteral(input.name)},
  slug: ${sourceLiteral(input.slug)},
});

const queryName = ${sourceLiteral(input.queryName)};
const query: PluginRyotQLDocument = ${JSON.stringify(input.query)};

export default defineActivityWithChanges({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Struct({ count: Schema.Number }),
  run: (_input, host) => Effect.gen(function* () {
    const result = yield* host.executeRyotql({ source: { kind: "inline", document: query } });
    const envelope = yield* Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Record(Schema.String, Schema.Struct({ type: Schema.Literal("rows"), items: Schema.Array(Schema.Unknown) })) }))(result);
    const rows = envelope.data[queryName];
    if (!rows) return yield* Effect.fail(new Error("Expected a rows result"));
    const count = rows.items.length;
    return {
      output: { count },
      changes: {
        globalEntities: [{
          entitySchemaSlug: ${sourceLiteral(input.entitySchemaSlug)},
          externalId: "system-ryotql-probe",
          name: "RyotQL system probe",
          populatedAt: null,
          properties: { rowCount: count },
        }],
      },
    };
  }),
});
`;
}

export function trendingSandboxSource(
	input: SandboxSourceIdentity & {
		readonly items: ReadonlyArray<{ readonly name: string; readonly externalId: string }>;
	},
) {
	return `
import { upsertedGlobalEntity } from "@ryot-app/plugin-backend-sdk/core";
import { DateTime, Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivityWithChanges, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

export const manifest = defineManifest({
  kind: "script",
  name: ${sourceLiteral(input.name)},
  slug: ${sourceLiteral(input.slug)},
});

const trendingResultSchema = Schema.Struct({
  items: Schema.Array(Schema.Struct({ externalId: Schema.String, name: Schema.String })),
});
const trendingResult = Schema.decodeSync(trendingResultSchema)(JSON.parse(${sourceLiteral(
		JSON.stringify({ items: input.items }),
	)}));

export default defineActivityWithChanges({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Struct({ count: Schema.Number }),
  run: () => Effect.gen(function* () {
    const fetchedAt = DateTime.formatIso(yield* DateTime.now);
    return {
      output: { count: trendingResult.items.length },
      changes: {
        globalEntities: trendingResult.items.map((item) => ({
          properties: {},
          name: item.name,
          populatedAt: null,
          entitySchemaSlug: "movie",
          externalId: item.externalId,
        })),
        globalRelationships: [{
          selector: { type: "self" as const, entitySchemaSlug: "movie" },
          relationshipSchemaSlug: "media-trending",
          relationships: trendingResult.items.map((item, index) => {
            const entity = upsertedGlobalEntity("movie", item.externalId);
            return { source: entity, target: entity, properties: { rank: index + 1, fetchedAt } };
          }),
        }],
      },
    };
  }),
});
`;
}

export function cacheSandboxSource(input: CacheSandboxSourceInput) {
	if (input.operation === "claimPersistent") {
		return scriptModuleSource({
			...input,
			inputSchema: "Schema.Struct({})",
			sdkImports: ["claimPersistentValueResultSchema"],
			outputSchema: "claimPersistentValueResultSchema",
			run: `(_input, host) => host.claimPersistentValue(${sourceLiteral(input.key)}, JSON.parse(${sourceLiteral(JSON.stringify(input.value))}), ${input.ttlSeconds}).pipe(
    Effect.map((data) => ({ data, success: true as const })),
  )`,
		});
	}

	if (input.operation === "byInput") {
		return scriptModuleSource({
			...input,
			outputSchema: "getCachedValueResultSchema",
			sdkImports: ["getCachedValueResultSchema"],
			inputSchema: 'Schema.Struct({ operation: Schema.Literal("get", "set") })',
			run: `(input, host) => Effect.gen(function* () {
    if (input.operation === "set") {
      yield* host.setCachedValue(${sourceLiteral(input.key)}, JSON.parse(${sourceLiteral(JSON.stringify(input.value))}), 60);
    }
    const data = yield* host.getCachedValue(${sourceLiteral(input.key)});
    return { data, success: true as const };
  })`,
		});
	}

	if (input.operation === "get") {
		return scriptModuleSource({
			...input,
			inputSchema: "Schema.Struct({})",
			sdkImports: ["getCachedValueResultSchema"],
			outputSchema: "getCachedValueResultSchema",
			run: `(_input, host) => host.getCachedValue(${sourceLiteral(input.key)}).pipe(
    Effect.map((data) => ({ data, success: true as const })),
  )`,
		});
	}

	if (input.operation === "set") {
		return scriptModuleSource({
			...input,
			inputSchema: "Schema.Struct({})",
			sdkImports: ["setCachedValueResultSchema"],
			outputSchema: "setCachedValueResultSchema",
			run: `(_input, host) => host.setCachedValue(${sourceLiteral(input.key)}, JSON.parse(${sourceLiteral(JSON.stringify(input.value))}), ${input.ttlSeconds}).pipe(
    Effect.map((data) => ({ data, success: true as const })),
  )`,
		});
	}

	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		outputSchema: "getCachedValueResultSchema",
		sdkImports: ["getCachedValueResultSchema"],
		run: `(_input, host) => Effect.gen(function* () {
    yield* host.setCachedValue(${sourceLiteral(input.key)}, JSON.parse(${sourceLiteral(JSON.stringify(input.value))}), ${input.ttlSeconds});
    const data = yield* host.getCachedValue(${sourceLiteral(input.key)});
    return { data, success: true as const };
  })`,
	});
}
