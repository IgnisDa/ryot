import type { JsonPrimitive, JsonValue, SandboxHostCapability } from "@ryot/sandbox-sdk/core";

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
	readonly driverName?: "main" | "trending";
	readonly requiredAppConfigKeys?: readonly string[];
	readonly capabilities: readonly SandboxHostCapability[];
};

const scriptModuleSource = (input: ScriptModuleSourceInput) => {
	const sdkImports = [
		"defineDriver",
		"defineManifest",
		"defineScript",
		...(input.sdkImports ?? []),
	];

	return `
import { ${sdkImports.join(", ")} } from "@ryot/sandbox-sdk/core";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: ${JSON.stringify(input.capabilities)},
  requiredAppConfigKeys: ${JSON.stringify(input.requiredAppConfigKeys ?? [])},
});

${input.declarations ?? ""}

const main = defineDriver(manifest, {
  input: ${input.inputSchema},
  output: ${input.outputSchema},
  run: ${input.run},
});

export default defineScript({ manifest, drivers: { ${input.driverName ?? "main"}: main } });
`;
};

export function literalSandboxSource(
	input: SandboxSourceIdentity & { readonly value: Exclude<JsonPrimitive, null> },
) {
	return scriptModuleSource({
		...input,
		capabilities: [],
		inputSchema: "z.object({})",
		outputSchema: `z.literal(${JSON.stringify(input.value)})`,
		run: `async () => ${JSON.stringify(input.value)} as const`,
	});
}

export function invalidTypeScriptSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		capabilities: [],
		declarations: 'const invalid: number = "not a number";',
		inputSchema: "z.object({})",
		outputSchema: "z.number()",
		run: "async () => invalid",
	});
}

export function nonStaticManifestSandboxSource(input: SandboxSourceIdentity) {
	return literalSandboxSource({ ...input, value: true })
		.replace("defineScript }", "defineScript, type SandboxManifest }")
		.replace(
			"export const manifest = defineManifest",
			"export const manifest: SandboxManifest = defineManifest",
		);
}

export function forbiddenImportSandboxSource(input: SandboxSourceIdentity) {
	return `import "zod";\n${literalSandboxSource({ ...input, value: true })}`;
}

export function httpCallSandboxSource(
	input: SandboxSourceIdentity & { readonly method?: string; readonly url: string },
) {
	return scriptModuleSource({
		...input,
		capabilities: ["httpCall"],
		inputSchema: "z.object({})",
		sdkImports: ["httpCallResultSchema"],
		outputSchema: "httpCallResultSchema",
		run: `async (_input, host) => host.httpCall(${JSON.stringify(input.method ?? "GET")}, ${JSON.stringify(input.url)})`,
	});
}

export function queryEngineSandboxSource(
	input: SandboxSourceIdentity & { readonly query: JsonValue },
) {
	return scriptModuleSource({
		...input,
		inputSchema: "z.object({})",
		sdkImports: ["jsonValueSchema"],
		outputSchema: "queryItemsSchema",
		capabilities: ["executeQueryEngine"],
		declarations: `const queryItemsSchema = z.array(z.unknown());
const queryResponseSchema = z.object({ data: z.object({ items: queryItemsSchema }) });
const query = jsonValueSchema.parse(JSON.parse(${JSON.stringify(JSON.stringify(input.query))}));`,
		run: `async (_input, host) => {
    const result = await host.executeQueryEngine(query);
    if (!result.success) {
      throw new Error(result.error);
    }
    return queryResponseSchema.parse(result.data).data.items;
  }`,
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
		inputSchema: "z.object({})",
		outputSchema: "jsonValueSchema",
		capabilities: ["getAppConfigValue"],
		sdkImports: ["jsonValueSchema", "unwrapHostResult"],
		requiredAppConfigKeys: input.requiredAppConfigKeys ?? [input.key],
		run: `async (_input, host) => unwrapHostResult(await host.getAppConfigValue(${JSON.stringify(input.key)}))`,
	});
}

export function userPreferencesSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		inputSchema: "z.object({})",
		capabilities: ["getUserPreferences"],
		outputSchema: "userPreferencesSchema",
		sdkImports: ["unwrapHostResult", "userPreferencesSchema"],
		run: "async (_input, host) => unwrapHostResult(await host.getUserPreferences())",
	});
}

export function throwingSandboxSource(input: SandboxSourceIdentity & { readonly message: string }) {
	return scriptModuleSource({
		...input,
		capabilities: [],
		inputSchema: "z.object({})",
		outputSchema: "z.unknown()",
		run: `async () => {
    throw new Error(${JSON.stringify(input.message)});
  }`,
	});
}

type CacheSandboxSourceInput = SandboxSourceIdentity &
	(
		| { readonly key: string; readonly operation: "get" }
		| {
				readonly key: string;
				readonly value: JsonValue;
				readonly ttlSeconds: number;
				readonly operation: "set" | "roundTrip";
		  }
	);

export function cacheSandboxSource(input: CacheSandboxSourceInput) {
	if (input.operation === "get") {
		return scriptModuleSource({
			...input,
			inputSchema: "z.object({})",
			capabilities: ["getCachedValue"],
			sdkImports: ["getCachedValueResultSchema"],
			outputSchema: "getCachedValueResultSchema",
			run: `async (_input, host) => host.getCachedValue(${JSON.stringify(input.key)})`,
		});
	}

	if (input.operation === "set") {
		return scriptModuleSource({
			...input,
			inputSchema: "z.object({})",
			capabilities: ["setCachedValue"],
			sdkImports: ["setCachedValueResultSchema"],
			outputSchema: "setCachedValueResultSchema",
			run: `async (_input, host) => host.setCachedValue(${JSON.stringify(input.key)}, JSON.parse(${JSON.stringify(JSON.stringify(input.value))}), ${input.ttlSeconds})`,
		});
	}

	return scriptModuleSource({
		...input,
		inputSchema: "z.object({})",
		outputSchema: "getCachedValueResultSchema",
		capabilities: ["setCachedValue", "getCachedValue"],
		sdkImports: ["getCachedValueResultSchema", "unwrapHostResult"],
		run: `async (_input, host) => {
    unwrapHostResult(await host.setCachedValue(${JSON.stringify(input.key)}, JSON.parse(${JSON.stringify(JSON.stringify(input.value))}), ${input.ttlSeconds}));
    return host.getCachedValue(${JSON.stringify(input.key)});
  }`,
	});
}

export function undeclaredHostSandboxSource(input: SandboxSourceIdentity) {
	return scriptModuleSource({
		...input,
		capabilities: [],
		inputSchema: "z.object({})",
		outputSchema: "z.unknown()",
		run: "async (_input, host) => host.executeQueryEngine({})",
	});
}

export function trendingSandboxSource(
	input: SandboxSourceIdentity & {
		readonly items: ReadonlyArray<{ readonly externalId: string; readonly name: string }>;
	},
) {
	return `
import { defineDriver, defineManifest } from "@ryot/sandbox-sdk/core";
import { defineProvider } from "@ryot/sandbox-sdk/provider";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "provider",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: [],
  requiredAppConfigKeys: [],
  providerInformation: { source: "e2e" },
});

const trendingResultSchema = z.object({
  items: z.array(z.object({ externalId: z.string(), name: z.string() }).strict()),
}).strict();
const trendingResult = trendingResultSchema.parse(JSON.parse(${JSON.stringify(
		JSON.stringify({ items: input.items }),
	)}));

const trending = defineDriver(manifest, {
  input: z.object({}),
  output: trendingResultSchema,
  run: async () => trendingResult,
});

export default defineProvider({ manifest, drivers: { trending } });
`;
}
