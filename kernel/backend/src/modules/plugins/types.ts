import type { PluginClientArtifact } from "@ryot/contract/modules/plugins/client";
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
	readonly clientArtifactHash: string | null;
	readonly scripts: Array<NormalizedPluginScript>;
	readonly clientArtifact: PluginClientArtifact | null;
	readonly sourceFiles: Readonly<Record<string, string>>;
};

export type PluginPersistenceIdentity =
	| { readonly slug: string; readonly ownerId: null; readonly scope: "system" }
	| { readonly slug: string; readonly ownerId: string; readonly scope: "user" };

export type StoredPluginIdentity = PluginPersistenceIdentity & { readonly id: string };

export type StoredPlugin = NormalizedPlugin & StoredPluginIdentity & { readonly status: string };
