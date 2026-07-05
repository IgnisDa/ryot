import type { PluginManifest, PluginScript } from "@ryot/plugin-kit/manifest";

export type PluginSource = {
	readonly packageRoot: string;
	readonly manifest: unknown;
};

export type NormalizedPluginScript = {
	readonly slug: string;
	readonly name: string;
	readonly entry: string;
	readonly source: string;
	readonly contentHash: string;
	readonly compiledCode: string;
	readonly compiledFormat: number;
	readonly metadata: Omit<PluginScript, "entry">;
};

export type NormalizedPlugin = {
	readonly sourceHash: string;
	readonly manifest: PluginManifest;
	readonly scripts: Array<NormalizedPluginScript>;
};

export type StoredPlugin = NormalizedPlugin & {
	readonly status: string;
};
