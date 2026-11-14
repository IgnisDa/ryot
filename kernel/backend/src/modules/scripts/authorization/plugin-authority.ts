import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { SandboxScriptKind } from "@ryot-app/contract/modules/scripts/schemas";
import { Schema } from "effect";

import { PluginSchemaScope, ScriptPluginRevision } from "./principal";

export const PluginSandboxAuthority = Schema.Struct({
	schemaScope: PluginSchemaScope,
	packageId: ScriptPluginRevision.fields.packageId,
	configSchema: ScriptPluginRevision.fields.configSchema,
	scriptKinds: Schema.Record(Schema.String, SandboxScriptKind),
	workflowScripts: ScriptPluginRevision.fields.workflowScripts,
	userBootstrapScriptSlugs: ScriptPluginRevision.fields.userBootstrapScriptSlugs,
});

export type PluginSandboxAuthority = Schema.Schema.Type<typeof PluginSandboxAuthority>;

export const pluginSandboxAuthority = (manifest: PluginManifest): PluginSandboxAuthority => ({
	configSchema: manifest.configSchema,
	packageId: manifest.metadata.packageId,
	scriptKinds: Object.fromEntries(manifest.scripts.map(({ kind, slug }) => [slug, kind])),
	workflowScripts: Object.fromEntries(
		manifest.workflows.map(({ slug, scriptSlug }) => [slug, scriptSlug]),
	),
	userBootstrapScriptSlugs: manifest.userBootstrap.flatMap((entry) =>
		"scriptSlug" in entry ? [entry.scriptSlug] : [],
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
