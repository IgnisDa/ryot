import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginArchiveCompiledScript } from "@ryot-app/plugin-archive";
import type { PluginScriptMetadata } from "@ryot-app/plugin-backend-compiler/plugin-manifest";
import type { PluginClientArtifact } from "@ryot-app/plugin-client-contract";

export type { PluginScriptMetadata };

export type PluginPersistenceIdentity = PluginOwnership & { readonly pluginId?: string };

export type StoredPlugin = PluginRevision & StoredPluginIdentity & { readonly status: string };

export type NormalizedPluginScript = PluginScriptDescriptor & {
	readonly compiledCode: string;
	readonly compiledFormat: number;
};

export type PluginRevision = {
	readonly contentHash: string;
	readonly manifest: PluginManifest;
	readonly scripts: ReadonlyArray<PluginScriptDescriptor>;
};

export type StoredPluginIdentity = PluginOwnership & {
	readonly id: string;
	readonly activationId: string;
	readonly packageId: PluginManifest["metadata"]["packageId"];
};

export type NormalizedPlugin = Omit<PluginRevision, "scripts"> & {
	readonly compiledClient?: PluginClientArtifact;
	readonly scripts: ReadonlyArray<NormalizedPluginScript>;
};

export type PluginSource = {
	readonly manifest: unknown;
	readonly compiledClient?: PluginClientArtifact;
	readonly compiledScripts?: ReadonlyArray<PluginArchiveCompiledScript>;
};

export type PluginScriptDescriptor = {
	readonly slug: string;
	readonly name: string;
	readonly entry: string;
	readonly contentHash: string;
	readonly metadata: PluginScriptMetadata;
};

type PluginOwnership =
	| { readonly ownerId: null; readonly scope: "system" }
	| { readonly scope: "user"; readonly ownerId: string };
