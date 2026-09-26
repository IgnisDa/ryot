export const SANDBOX_SDK_ROOT_IMPORT = "@ryot-app/sandbox-sdk/core";
export const SANDBOX_SDK_AUTOMATION_IMPORT = "@ryot-app/sandbox-sdk/automation";
export const SANDBOX_SDK_PROVIDER_IMPORT = "@ryot-app/sandbox-sdk/provider";
export const SANDBOX_SDK_WORKFLOW_IMPORT = "@ryot-app/sandbox-sdk/workflow";
export const SANDBOX_SDK_FILESYSTEM_IMPORT = "@ryot-app/sandbox-sdk/filesystem";
export const SANDBOX_SDK_IMPORT_WIRE_IMPORT = "@ryot-app/sandbox-sdk/imports";

export const PLUGIN_KIT_EFFECT_IMPORT = "@ryot-app/plugin-kit/effect";
export const PLUGIN_KIT_RYOTQL_IMPORT = "@ryot-app/plugin-kit/ryotql";
export const PLUGIN_KIT_SCHEMA_IMPORT = "@ryot-app/plugin-kit/schema";

const sharedRuntimeExternals = ["effect", "dependency-runtime", "filesystem"] as const;

export const SANDBOX_RUNTIME_REGISTRY = [
	{
		runner: true,
		name: "effect",
		subpathAliases: true,
		runtimeExternals: [],
		packageName: "effect",
		sdkImport: "@ryot-app/sandbox-sdk/effect",
		aliases: ["effect", PLUGIN_KIT_EFFECT_IMPORT],
	},
	{
		aliases: [],
		runner: true,
		runtimeExternals: [],
		name: "dependency-runtime",
		packageName: "@ryot-app/sandbox-sdk",
		sdkImport: "@ryot-app/sandbox-sdk/dependency-runtime",
	},
	{
		aliases: [],
		runner: true,
		name: "filesystem",
		runtimeExternals: ["effect"],
		packageName: "@ryot-app/sandbox-sdk",
		sdkImport: SANDBOX_SDK_FILESYSTEM_IMPORT,
	},
	{
		aliases: [],
		runner: false,
		name: "cheerio",
		packageName: "cheerio",
		runtimeExternals: sharedRuntimeExternals,
		sdkImport: "@ryot-app/sandbox-sdk/cheerio",
	},
	{
		aliases: [],
		runner: false,
		name: "youtubei",
		packageName: "youtubei.js",
		runtimeExternals: sharedRuntimeExternals,
		sdkImport: "@ryot-app/sandbox-sdk/youtubei",
		sourceAliases: [
			{ specifier: "youtubei.js/web", entryRelativePath: "dist/src/platform/web.js" },
		],
	},
	{
		aliases: [],
		runner: false,
		name: "fflate",
		packageName: "fflate",
		runtimeExternals: sharedRuntimeExternals,
		sdkImport: "@ryot-app/sandbox-sdk/fflate",
	},
	{
		aliases: [],
		runner: false,
		name: "papaparse",
		packageName: "papaparse",
		runtimeExternals: sharedRuntimeExternals,
		sdkImport: "@ryot-app/sandbox-sdk/papaparse",
	},
	{
		aliases: [],
		runner: false,
		name: "fast-xml-parser",
		packageName: "fast-xml-parser",
		runtimeExternals: sharedRuntimeExternals,
		sdkImport: "@ryot-app/sandbox-sdk/fast-xml-parser",
	},
	{
		runner: true,
		name: "ryotql",
		packageName: "@ryot-app/ryotql",
		aliases: [PLUGIN_KIT_RYOTQL_IMPORT],
		runtimeExternals: sharedRuntimeExternals,
		sdkImport: "@ryot-app/sandbox-sdk/ryotql",
	},
] as const;

export const SANDBOX_RUNTIME_EXTERNAL_SPECIFIERS = [
	...SANDBOX_RUNTIME_REGISTRY.map(({ sdkImport }) => sdkImport),
	...SANDBOX_RUNTIME_REGISTRY.flatMap(({ aliases }) => aliases),
] as const;

export const PLUGIN_KIT_IMPORTS = [
	PLUGIN_KIT_EFFECT_IMPORT,
	PLUGIN_KIT_RYOTQL_IMPORT,
	PLUGIN_KIT_SCHEMA_IMPORT,
] as const;
