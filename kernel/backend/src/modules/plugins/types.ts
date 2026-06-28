import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginScriptMetadata } from "@ryot-app/sandbox-compiler/plugin-manifest";

export type { PluginScriptMetadata };

export type PluginSource = {
	readonly manifest: unknown;
	readonly files: Readonly<Record<string, Uint8Array>>;
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

export type PluginRevision = {
	readonly sourceHash: string;
	readonly manifest: PluginManifest;
	readonly scripts: Array<NormalizedPluginScript>;
};

export type NormalizedPlugin = PluginRevision & {
	readonly files: Readonly<Record<string, Uint8Array>>;
};

export type PluginPersistenceIdentity =
	| { readonly slug: string; readonly ownerId: null; readonly scope: "system" }
	| { readonly slug: string; readonly ownerId: string; readonly scope: "user" };

export type StoredPluginIdentity = PluginPersistenceIdentity & { readonly id: string };

export type StoredPlugin = PluginRevision & StoredPluginIdentity & { readonly status: string };
