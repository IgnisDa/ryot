import type { PluginManifest, PluginScript } from "@ryot/contract/modules/plugins/manifest";

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
	readonly sourceFiles: Readonly<Record<string, string>>;
};

export type StoredPluginIdentity = {
	readonly id: string;
	readonly slug: string;
	readonly ownerId: string | null;
	readonly scope: "system" | "user";
};

export type StoredPlugin = NormalizedPlugin & StoredPluginIdentity & { readonly status: string };
