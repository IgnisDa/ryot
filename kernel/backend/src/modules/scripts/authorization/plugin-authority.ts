import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { SandboxScriptKind } from "@ryot-app/contract/modules/scripts/schemas";
import { Schema } from "effect";

import { ScriptPluginRevision } from "./principal";

export const PluginSandboxAuthority = Schema.Struct({
	packageId: ScriptPluginRevision.fields.packageId,
	schemaScope: ScriptPluginRevision.fields.schemaScope,
	configSchema: ScriptPluginRevision.fields.configSchema,
	scriptKinds: Schema.Record(Schema.String, SandboxScriptKind),
	workflowScripts: ScriptPluginRevision.fields.workflowScripts,
	userBootstrapScriptSlugs: ScriptPluginRevision.fields.userBootstrapScriptSlugs,
});

export type PluginSandboxAuthority = Schema.Schema.Type<typeof PluginSandboxAuthority>;

export const pluginSandboxAuthority = (manifest: PluginManifest): PluginSandboxAuthority => ({
	configSchema: manifest.configSchema,
	packageId: manifest.metadata.packageId,
	userBootstrapScriptSlugs: manifest.userBootstrap.map(({ scriptSlug }) => scriptSlug),
	scriptKinds: Object.fromEntries(manifest.scripts.map(({ kind, slug }) => [slug, kind])),
	workflowScripts: Object.fromEntries(
		manifest.workflows.map(({ slug, scriptSlug }) => [slug, scriptSlug]),
	),
	schemaScope: {
		signalSchemaSlugs: manifest.signalSchemas.map(({ slug }) => slug),
		entitySchemaSlugs: manifest.entitySchemas.map(({ slug }) => slug),
		relationshipSchemaSlugs: manifest.relationshipSchemas.map(({ slug }) => slug),
		eventSchemas: manifest.entitySchemas.flatMap((entity) =>
			entity.eventSchemas.map((event) => ({
				eventSchemaSlug: event.slug,
				entitySchemaSlug: entity.slug,
			})),
		),
	},
});
