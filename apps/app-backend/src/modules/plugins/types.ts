import type { PluginManifest, PluginScript } from "@ryot/plugin-kit/manifest";

export type PluginScriptMetadata = PluginScript extends infer Script
	? Script extends { readonly entry: string }
		? Omit<Script, "entry">
		: never
	: never;

export type PluginSource = {
	readonly manifest: unknown;
	readonly files: Readonly<Record<string, string>>;
};

export type NormalizedPluginScript = {
	readonly slug: string;
	readonly name: string;
	readonly entry: string;
	readonly source: string;
	readonly contentHash: string;
	readonly compiledCode: string;
	readonly compiledFormat: number;
	readonly metadata: PluginScriptMetadata;
};

export type NormalizedPlugin = {
	readonly sourceHash: string;
	readonly manifest: PluginManifest;
	readonly scripts: Array<NormalizedPluginScript>;
};

export type StoredPlugin = NormalizedPlugin & {
	readonly status: string;
};
