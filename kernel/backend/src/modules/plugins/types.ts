import type { PluginClientArtifact } from "@ryot-app/client-plugin-contract";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginArchiveCompiledScript } from "@ryot-app/plugin-archive";
import type { PluginScriptMetadata } from "@ryot-app/sandbox-compiler/plugin-manifest";

export type { PluginScriptMetadata };

export type PluginSource = {
	readonly manifest: unknown;
	readonly compiledScripts?: ReadonlyArray<PluginArchiveCompiledScript>;
	readonly compiledClient?: PluginClientArtifact;
};

export type PluginScriptDescriptor = {
	readonly slug: string;
	readonly name: string;
	readonly entry: string;
	readonly contentHash: string;
	readonly metadata: PluginScriptMetadata;
};

export type NormalizedPluginScript = PluginScriptDescriptor & {
	readonly compiledCode: string;
	readonly compiledFormat: number;
};

export type PluginRevision = {
	readonly sourceHash: string;
	readonly manifest: PluginManifest;
	readonly scripts: ReadonlyArray<PluginScriptDescriptor>;
};

export type NormalizedPlugin = Omit<PluginRevision, "scripts"> & {
	readonly scripts: ReadonlyArray<NormalizedPluginScript>;
	readonly compiledClient?: PluginClientArtifact;
};

export type PluginPersistenceIdentity = (
	| { readonly ownerId: null; readonly scope: "system" }
	| { readonly ownerId: string; readonly scope: "user" }
) & { readonly packageId: PluginManifest["metadata"]["packageId"]; readonly pluginId?: string };

export type StoredPluginIdentity = Omit<
	PluginPersistenceIdentity,
	"pluginId" | "ownerId" | "scope"
> &
	(
		| { readonly ownerId: null; readonly scope: "system" }
		| { readonly ownerId: string; readonly scope: "user" }
	) & { readonly id: string; readonly activationId: string };

export type StoredPlugin = PluginRevision & StoredPluginIdentity & { readonly status: string };
