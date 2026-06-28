import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { JsonPrimitive, SandboxHostCapability } from "@ryot-app/contract/modules/sandbox/wire";

export type SandboxSourceIdentity = { readonly name: string; readonly slug: string };

type ScriptModuleSourceInput = SandboxSourceIdentity & {
	readonly run: string;
	readonly inputSchema: string;
	readonly outputSchema: string;
	readonly declarations?: string;
	readonly filesystemImport?: boolean;
	readonly sdkImports?: readonly string[];
	readonly ryotqlImports?: readonly string[];
	readonly requiredPluginConfigKeys?: readonly string[];
	readonly requiredSystemConfigKeys?: readonly string[];
	readonly capabilities: readonly SandboxHostCapability[];
};

const scriptModuleSource = (input: ScriptModuleSourceInput) => {
	const coreItems = (input.sdkImports ?? []).filter((i) => i !== "jsonValueSchema");
	const wireItems = (input.sdkImports ?? []).filter((i) => i === "jsonValueSchema");
	const wireImportLine =
		wireItems.length > 0
			? `\nimport { ${wireItems.join(", ")} } from "@ryot-app/sandbox-sdk/wire";`
			: "";
	const coreImportLine =
		coreItems.length > 0
			? `\nimport { ${coreItems.join(", ")} } from "@ryot-app/sandbox-sdk/core";`
			: "";
	const ryotqlImportLine =
		input.ryotqlImports && input.ryotqlImports.length > 0
			? `\nimport { ${input.ryotqlImports.join(", ")} } from "@ryot-app/sandbox-sdk/ryotql";`
			: "";
	const filesystemImportLine = input.filesystemImport
		? '\nimport { writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";'
		: "";

	return `
 import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";${wireImportLine}${coreImportLine}${ryotqlImportLine}${filesystemImportLine}
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: ${JSON.stringify(input.capabilities)},
  requiredPluginConfigKeys: ${JSON.stringify(input.requiredPluginConfigKeys ?? [])},
  requiredSystemConfigKeys: ${JSON.stringify(input.requiredSystemConfigKeys ?? [])},
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

export function processFailureSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		capabilities: [],
		inputSchema: "Schema.Struct({})",
		outputSchema: "Schema.Literal(true)",
		run: `() => {
    const allocations = [];
    for (let index = 0; index < 64; index += 1) {
      allocations.push(new Array(1024 * 1024).fill(index));
    }
    return Effect.succeed(true as const);
  }`,
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

export function httpCallFailureSandboxSource(
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
    Effect.catch((error) => Effect.succeed({
      error: error.message,
      success: false as const,
      data: error.data as { body: string; status: number; headers: Record<string, string> },
    })),
  )`,
	});
}

export function ryotqlSandboxSource(
	input: SandboxSourceIdentity & { readonly query: JsonValue; readonly queryName: string },
) {
	return scriptModuleSource({
		...input,
		inputSchema: "Schema.Struct({})",
		sdkImports: ["ryotqlDocumentSchema"],
		outputSchema: "Schema.Array(Schema.Unknown)",
		capabilities: ["executeRyotql"],
		declarations: `const queryName = ${JSON.stringify(input.queryName)};
const query = Schema.decodeSync(ryotqlDocumentSchema)(JSON.parse(${JSON.stringify(JSON.stringify(input.query))}));`,
		run: `(_input, host) => Effect.gen(function* () {
    const result = yield* host.executeRyotql(query);
     const data = result && typeof result === "object" && "data" in result ? result.data : null;
     const queryResults = data && typeof data === "object" ? data as Record<string, unknown> : null;
     const rows = queryResults?.[queryName];
     if (!rows || typeof rows !== "object") {
       throw new Error("Expected a rows result");
     }
     const rowResult = rows as Record<string, unknown>;
     if (rowResult.type !== "rows" || !Array.isArray(rowResult.items)) {
       throw new Error("Expected a rows result");
     }
     return rowResult.items;
   })`,
	});
}

export function systemRyotqlProbeSandboxSource(
	input: SandboxSourceIdentity & {
		readonly entitySchemaSlug: string;
		readonly query: JsonValue;
		readonly queryName: string;
	},
) {
	return scriptModuleSource({
		...input,
		capabilities: ["executeRyotql", "upsertGlobalEntities"],
		sdkImports: ["ryotqlDocumentSchema"],
		inputSchema: "Schema.Struct({})",
		outputSchema: "Schema.Struct({ count: Schema.Number })",
		declarations: `const queryName = ${JSON.stringify(input.queryName)};
const query = Schema.decodeSync(ryotqlDocumentSchema)(JSON.parse(${JSON.stringify(JSON.stringify(input.query))}));`,
		run: `(_input, host) => Effect.gen(function* () {
    const result = yield* host.executeRyotql(query);
     const data = result && typeof result === "object" && "data" in result ? result.data : null;
     const queryResults = data && typeof data === "object" ? data as Record<string, unknown> : null;
     const rowResult = queryResults?.[queryName];
     if (!rowResult || typeof rowResult !== "object") {
       throw new Error("Expected a rows result");
     }
     const rows = rowResult as Record<string, unknown>;
     const items = rows.items;
     if (rows.type !== "rows" || !Array.isArray(items)) {
       throw new Error("Expected a rows result");
     }
    yield* host.upsertGlobalEntities([{
      entitySchemaSlug: ${JSON.stringify(input.entitySchemaSlug)},
      externalId: "system-ryotql-probe",
      name: "RyotQL system probe",
      populatedAt: null,
      properties: { rowCount: items.length },
    }]);
    return { count: items.length };
  })`,
	});
}

export function entityRowsSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		sdkImports: ["entityRecordSchema"],
		capabilities: ["executeRyotql"],
		outputSchema: "Schema.Array(entityRecordSchema)",
		ryotqlImports: ["entityReadRecipe", "executeRyotqlRecipe"],
		inputSchema: "Schema.Struct({ ids: Schema.Array(Schema.String) })",
		run: `(input, host) => input.ids.length === 0
    ? Effect.succeed([])
	    : executeRyotqlRecipe(host.executeRyotql, entityReadRecipe({
				entityIds: input.ids as [string, ...string[]],
		      })).pipe(Effect.map((result) => result.items))`,
	});
}

export function eventRowsSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		capabilities: ["executeRyotql"],
		ryotqlImports: ["eventReadRecipe", "executeRyotqlRecipe"],
		outputSchema: "Schema.Array(Schema.Unknown)",
		run: `(input, host) => executeRyotqlRecipe(host.executeRyotql, eventReadRecipe({
        entityId: input.entityId,
        entitySchemaSlug: input.entitySchemaSlug,
        eventSchemaSlug: input.eventSchemaSlug,
	      })).pipe(Effect.map((result) => result.items))`,
		inputSchema:
			"Schema.Struct({ entityId: Schema.String, entitySchemaSlug: Schema.String, eventSchemaSlug: Schema.String })",
	});
}

export function entitySchemasSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		capabilities: ["getEntitySchemas"],
		sdkImports: ["entitySchemaRecordSchema"],
		outputSchema: "Schema.Array(entitySchemaRecordSchema)",
		run: "(input, host) => host.getEntitySchemas(input.slugs)",
		inputSchema: "Schema.Struct({ slugs: Schema.Array(Schema.String) })",
	});
}

export function eventSchemasSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		capabilities: ["listEventSchemas"],
		sdkImports: ["eventSchemaRecordSchema"],
		outputSchema: "Schema.Array(eventSchemaRecordSchema)",
		run: "(input, host) => host.listEventSchemas(input.slugs)",
		inputSchema: "Schema.Struct({ slugs: Schema.Array(Schema.String) })",
	});
}

export function pluginConfigSandboxSource(
	input: SandboxSourceIdentity & {
		readonly keys: readonly string[];
		readonly requiredPluginConfigKeys?: readonly string[];
	},
) {
	return scriptModuleSource({
		...input,
		sdkImports: ["jsonValueSchema"],
		inputSchema: "Schema.Struct({})",
		capabilities: ["getPluginConfig"],
		outputSchema: "Schema.Record(Schema.String, jsonValueSchema)",
		requiredPluginConfigKeys: input.requiredPluginConfigKeys ?? input.keys,
		run: `(_input, host) => host.getPluginConfig(${JSON.stringify(input.keys)})`,
	});
}

export function systemConfigSandboxSource(
	input: SandboxSourceIdentity & {
		readonly keys: readonly string[];
		readonly requiredSystemConfigKeys?: readonly string[];
	},
) {
	return scriptModuleSource({
		...input,
		sdkImports: ["jsonValueSchema"],
		inputSchema: "Schema.Struct({})",
		capabilities: ["getSystemConfig"],
		outputSchema: "Schema.Record(Schema.String, jsonValueSchema)",
		requiredSystemConfigKeys: input.requiredSystemConfigKeys ?? input.keys,
		run: `(_input, host) => host.getSystemConfig(${JSON.stringify(input.keys)})`,
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

export function scratchEntryLimitSandboxSource(
	input: SandboxSourceIdentity & { readonly chunkCount: number },
) {
	return scriptModuleSource({
		...input,
		filesystemImport: true,
		capabilities: ["scratch"],
		inputSchema: "Schema.Struct({})",
		outputSchema: "Schema.Struct({ chunkFiles: Schema.Array(Schema.String) })",
		run: `() => writeScratchChunks(Array.from({ length: ${input.chunkCount} }, (_, index) => ({
    name: \`chunk-\${index}.json\`,
    contents: "",
  })))`,
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

export function deepThrowingSandboxSource(
	input: SandboxSourceIdentity & { readonly message: string },
) {
	const frameCount = 12;
	const frames = Array.from({ length: frameCount }, (_, index) => {
		const frameName = `sandboxFrame${index}`;
		if (index === frameCount - 1) {
			return `const ${frameName} = () => { throw new Error(${JSON.stringify(input.message)}); };`;
		}
		return `const ${frameName} = () => sandboxFrame${index + 1}();`;
	}).join("\n");

	return scriptModuleSource({
		...input,
		capabilities: [],
		outputSchema: "Schema.Unknown",
		inputSchema: "Schema.Struct({})",
		run: `() => Effect.sync(() => {
    ${frames}
    return sandboxFrame0();
  })`,
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
				readonly operation: "claimPersistent";
		  }
		| {
				readonly key: string;
				readonly value: JsonValue;
				readonly ttlSeconds: number;
				readonly operation: "set" | "roundTrip";
		  }
	);

export function cacheSandboxSource(input: CacheSandboxSourceInput) {
	if (input.operation === "claimPersistent") {
		return scriptModuleSource({
			...input,
			inputSchema: "Schema.Struct({})",
			capabilities: ["claimPersistentValue"],
			sdkImports: ["claimPersistentValueResultSchema"],
			outputSchema: "claimPersistentValueResultSchema",
			run: `(_input, host) => host.claimPersistentValue(${JSON.stringify(input.key)}, JSON.parse(${JSON.stringify(JSON.stringify(input.value))}), ${input.ttlSeconds}).pipe(
    Effect.map((data) => ({ data, success: true as const })),
  )`,
		});
	}

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

export function bootSandboxSource(
	input: SandboxSourceIdentity & { readonly externalId: string; readonly entitySchemaSlug: string },
) {
	return `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: ["upsertGlobalEntities"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
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
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "operation",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
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

export function integrationReadOperationSandboxSource(
	input: SandboxSourceIdentity & { readonly providerSlug: string },
) {
	return `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { integrationRecordSchema } from "@ryot-app/sandbox-sdk/core";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "operation",
  capabilities: ["getCurrentIntegration", "listIntegrations"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
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
    const enabled = yield* host.listIntegrations({ provider: ${JSON.stringify(input.providerSlug)}, isDisabled: false });
    return { current, enabled };
  }),
});
`;
}

export function pluginConfigOperationSandboxSource(
	input: SandboxSourceIdentity & { readonly configKey: string; readonly transform?: string },
) {
	const configKey = JSON.stringify(input.configKey);
	return `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "operation",
  requiredSystemConfigKeys: [],
  capabilities: ["getPluginConfig"],
  requiredPluginConfigKeys: [${configKey}],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineOperation({
  manifest,
  input: Schema.Struct({ prefix: Schema.String }),
  output: Schema.Struct({ label: Schema.String }),
  run: (input, host) => Effect.gen(function* () {
    const config = yield* host.getPluginConfig([${configKey}]);
    const value = String(config[${configKey}]);
    return { label: input.prefix + ":" + (${input.transform ?? "value"}) };
  }),
});
`;
}
