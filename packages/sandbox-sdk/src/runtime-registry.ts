export const SANDBOX_SDK_ROOT_IMPORT = "@ryot-app/sandbox-sdk/core";
export const SANDBOX_SDK_AUTOMATION_IMPORT = "@ryot-app/sandbox-sdk/automation";
export const SANDBOX_SDK_PROVIDER_IMPORT = "@ryot-app/sandbox-sdk/provider";
export const SANDBOX_SDK_WORKFLOW_IMPORT = "@ryot-app/sandbox-sdk/workflow";
export const SANDBOX_SDK_FILESYSTEM_IMPORT = "@ryot-app/sandbox-sdk/filesystem";
export const SANDBOX_SDK_IMPORT_WIRE_IMPORT = "@ryot-app/sandbox-sdk/imports";

export const PLUGIN_KIT_EFFECT_IMPORT = "@ryot-app/plugin-kit/effect";
export const PLUGIN_KIT_RYOTQL_IMPORT = "@ryot-app/plugin-kit/ryotql";
export const PLUGIN_KIT_SCHEMA_IMPORT = "@ryot-app/plugin-kit/schema";

export const SANDBOX_RUNTIME_REGISTRY = [
	{
		name: "effect",
		packageName: "effect",
		sdkImport: "@ryot-app/sandbox-sdk/effect",
		aliases: ["effect", PLUGIN_KIT_EFFECT_IMPORT],
	},
	{
		aliases: [],
		name: "cheerio",
		packageName: "cheerio",
		sdkImport: "@ryot-app/sandbox-sdk/cheerio",
	},
	{
		aliases: [],
		name: "youtubei",
		packageName: "youtubei.js",
		sdkImport: "@ryot-app/sandbox-sdk/youtubei",
		sourceAliases: [
			{ specifier: "youtubei.js/web", entryRelativePath: "dist/src/platform/deno.js" },
		],
	},
	{ aliases: [], name: "fflate", packageName: "fflate", sdkImport: "@ryot-app/sandbox-sdk/fflate" },
	{
		aliases: [],
		name: "papaparse",
		packageName: "papaparse",
		sdkImport: "@ryot-app/sandbox-sdk/papaparse",
	},
	{
		aliases: [],
		name: "fast-xml-parser",
		packageName: "fast-xml-parser",
		sdkImport: "@ryot-app/sandbox-sdk/fast-xml-parser",
	},
	{
		name: "ryotql",
		packageName: "@ryot-app/ryotql",
		aliases: [PLUGIN_KIT_RYOTQL_IMPORT],
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
