import {
	importInternalPropertyNames,
	isImportUploadTokenField,
} from "@ryot-app/contract/modules/imports/schemas";
import { integrationCommonPropertyNames } from "@ryot-app/contract/modules/integrations/schemas";
import {
	PluginManifest,
	type PluginManifest as PluginManifestValue,
	type PluginScript,
} from "@ryot-app/contract/modules/plugins/manifest";
import { reservedPluginSlugs } from "@ryot-app/contract/modules/plugins/schemas";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Cron, Data, Effect, Result, Schema } from "effect";

import {
	formatPropertyIssues,
	parseLabeledPropertySchemaInput,
	validateAppSchemaDefinition,
} from "#lib/property-schema/property-schema-runtime";
import type { DefinitionSnapshot } from "#modules/definition-registry/service";

export class PluginValidationError extends Data.TaggedError("PluginValidationError")<{
	readonly issues: ReadonlyArray<string>;
}> {}

const fail = (issue: string) => new PluginValidationError({ issues: [issue] });

const assertSlug = (kind: string, slug: string) =>
	slug.includes("/") ? Effect.fail(fail(`${kind} slug cannot contain '/': ${slug}`)) : Effect.void;

const assertReference = (kind: string, slug: string, available: ReadonlySet<string>) =>
	available.has(slug)
		? Effect.void
		: Effect.fail(fail(`${kind} references missing definition: ${slug}`));

const assertAutomationScript = (
	kind: string,
	scriptSlug: string,
	scripts: PluginManifestValue["scripts"],
) =>
	scripts.find(({ slug }) => slug === scriptSlug)?.kind === "automation"
		? Effect.void
		: Effect.fail(fail(`${kind} script ${scriptSlug} must be an automation script`));

export const decodePluginManifest = (input: unknown) =>
	Schema.decodeUnknownEffect(PluginManifest)(input).pipe(
		Effect.mapError((error) => new PluginValidationError({ issues: [String(error)] })),
	);

export const validatePluginSourcePaths = (
	files: Readonly<Record<string, Uint8Array>>,
	manifest: PluginManifestValue,
) =>
	Effect.gen(function* () {
		for (const path of Object.keys(files)) {
			const issue = canonicalRelativePosixPathIssue(path);
			if (issue) {
				return yield* fail(`Plugin file path '${path}' ${issue}`);
			}
		}
		for (const script of manifest.scripts) {
			const issue = canonicalRelativePosixPathIssue(script.entry);
			if (issue) {
				return yield* fail(`Plugin script entry '${script.entry}' ${issue}`);
			}
			if (!Object.hasOwn(files, script.entry)) {
				return yield* fail(`Plugin script entry is missing from files: ${script.entry}`);
			}
		}
		if (manifest.client) {
			for (const [entryLabel, entry] of Object.entries(manifest.client.exports ?? {}).map(
				([name, declaration]) => [`public export ${name}`, declaration.entry] as const,
			)) {
				if (!Object.hasOwn(files, entry)) {
					return yield* fail(`Plugin client ${entryLabel} entry is missing from files: ${entry}`);
				}
			}
		}
		return yield* Effect.void;
	});

export const PLUGIN_PACKAGE_LIMITS = {
	fileCount: 64,
	scriptCount: 32,
	totalBytes: 2 * 1024 * 1024,
} as const;

export type PluginPackageLimit = "file-count" | "total-bytes" | "script-count";

export class PluginPackageLimitError extends Data.TaggedError("PluginPackageLimitError")<{
	readonly limit: PluginPackageLimit;
}> {}

export class PluginSurfaceError extends Data.TaggedError("PluginSurfaceError")<{
	readonly surfaces: ReadonlyArray<string>;
}> {}

export class PluginSlugReservedError extends Data.TaggedError("PluginSlugReservedError")<{
	readonly pluginSlug: string;
}> {}

export const validatePluginPackageLimits = (
	files: Readonly<Record<string, Uint8Array>>,
	manifest: PluginManifestValue,
) =>
	Effect.gen(function* () {
		const entries = Object.entries(files);
		if (entries.length > PLUGIN_PACKAGE_LIMITS.fileCount) {
			return yield* new PluginPackageLimitError({ limit: "file-count" });
		}
		if (manifest.scripts.length > PLUGIN_PACKAGE_LIMITS.scriptCount) {
			return yield* new PluginPackageLimitError({ limit: "script-count" });
		}
		const totalBytes = entries.reduce(
			(total, [path, contents]) => total + utf8ByteLength(path) + contents.byteLength,
			0,
		);
		if (totalBytes > PLUGIN_PACKAGE_LIMITS.totalBytes) {
			return yield* new PluginPackageLimitError({ limit: "total-bytes" });
		}
		return yield* Effect.void;
	});

const userRejectedCollections = [
	"boot",
	"userBootstrap",
	"httpRateLimits",
] as const satisfies ReadonlyArray<
	{
		[Key in keyof PluginManifestValue]: PluginManifestValue[Key] extends ReadonlyArray<unknown>
			? Key
			: never;
	}[keyof PluginManifestValue]
>;

export const validatePluginManifestPolicy = (
	manifest: PluginManifestValue,
	policy:
		| { readonly scope: "system" }
		| { readonly scope: "user"; readonly systemSlugs: ReadonlySet<string> },
) =>
	Effect.gen(function* () {
		const pluginSlug = manifest.metadata.slug;
		if (reservedPluginSlugs.has(pluginSlug)) {
			return yield* new PluginSlugReservedError({ pluginSlug });
		}
		if (policy.scope === "system") {
			return yield* Effect.void;
		}
		const surfaces = userRejectedCollections.filter((field) => manifest[field].length > 0);
		if (surfaces.length > 0) {
			return yield* new PluginSurfaceError({ surfaces });
		}
		if (policy.systemSlugs.has(pluginSlug)) {
			return yield* new PluginSlugReservedError({ pluginSlug });
		}
		return yield* Effect.void;
	});

export const validatePluginManifestReferences = (
	manifest: PluginManifestValue,
	snapshot: DefinitionSnapshot,
) =>
	Effect.gen(function* () {
		const bootSlugs = new Set<string>();
		const cronSlugs = new Set<string>();
		const scriptSlugs = new Set<string>();
		const workflowSlugs = new Set<string>();
		const operationSlugs = new Set<string>();
		const userBootstrapSlugs = new Set<string>();
		yield* assertSlug("plugin", manifest.metadata.slug);
		for (const definition of manifest.entitySchemas) {
			yield* assertSlug("entity schema", definition.slug);
			for (const eventSchema of definition.eventSchemas) {
				yield* assertSlug("event schema", eventSchema.slug);
			}
		}
		for (const definition of manifest.relationshipSchemas) {
			yield* assertSlug("relationship schema", definition.slug);
		}
		for (const definition of manifest.signalSchemas) {
			yield* assertSlug("signal schema", definition.slug);
			yield* assertReference(
				"Notification hook",
				definition.notificationHookSlug,
				new Set(manifest.hooks.map(({ slug }) => slug)),
			);
		}
		for (const definition of manifest.savedViews) {
			yield* assertSlug("saved view", definition.slug);
		}
		for (const provider of manifest.providers) {
			yield* assertSlug("provider", provider.slug);
			yield* assertReference(
				"Provider root entity schema",
				provider.rootEntitySchemaSlug,
				new Set(Object.keys(snapshot.entitySchemas)),
			);
		}
		for (const script of manifest.scripts) {
			yield* assertSlug("script", script.slug);
			if (scriptSlugs.has(script.slug)) {
				return yield* fail(`Duplicate script slug: ${script.slug}`);
			}
			scriptSlugs.add(script.slug);
		}
		for (const boot of manifest.boot) {
			yield* assertSlug("boot", boot.slug);
			if (bootSlugs.has(boot.slug)) {
				return yield* fail(`Duplicate boot slug: ${boot.slug}`);
			}
			bootSlugs.add(boot.slug);
			yield* assertReference("Boot", boot.scriptSlug, scriptSlugs);
		}
		for (const entry of manifest.userBootstrap) {
			yield* assertSlug("user bootstrap", entry.slug);
			if (userBootstrapSlugs.has(entry.slug)) {
				return yield* fail(`Duplicate user bootstrap slug: ${entry.slug}`);
			}
			userBootstrapSlugs.add(entry.slug);
			yield* assertReference("User bootstrap", entry.scriptSlug, scriptSlugs);
			if (manifest.scripts.find(({ slug }) => slug === entry.scriptSlug)?.kind !== "script") {
				return yield* fail(
					`User bootstrap ${entry.slug} script ${entry.scriptSlug} must be a direct script`,
				);
			}
		}
		for (const cron of manifest.crons) {
			yield* assertSlug("cron", cron.slug);
			if (cronSlugs.has(cron.slug)) {
				return yield* fail(`Duplicate cron slug: ${cron.slug}`);
			}
			cronSlugs.add(cron.slug);
			yield* assertReference("Cron", cron.scriptSlug, scriptSlugs);
			if ("cron" in cron.schedule && Result.isFailure(Cron.parse(cron.schedule.cron))) {
				return yield* fail(`Cron ${cron.slug} has invalid schedule: ${cron.schedule.cron}`);
			}
		}
		for (const operation of manifest.operations) {
			yield* assertSlug("operation", operation.slug);
			if (operationSlugs.has(operation.slug)) {
				return yield* fail(`Duplicate operation slug: ${operation.slug}`);
			}
			operationSlugs.add(operation.slug);
			yield* assertReference("Operation", operation.scriptSlug, scriptSlugs);
		}
		for (const workflow of manifest.workflows) {
			yield* assertSlug("workflow", workflow.slug);
			if (workflowSlugs.has(workflow.slug)) {
				return yield* fail(`Duplicate workflow slug: ${workflow.slug}`);
			}
			workflowSlugs.add(workflow.slug);
			yield* assertReference("Workflow", workflow.scriptSlug, scriptSlugs);
			if (manifest.scripts.find(({ slug }) => slug === workflow.scriptSlug)?.kind !== "workflow") {
				return yield* fail(
					`Workflow ${workflow.slug} script ${workflow.scriptSlug} must be a workflow script`,
				);
			}
		}

		for (const source of manifest.importSources) {
			yield* assertSlug("import source", source.slug);
			yield* assertReference("Import source", source.workflowSlug, workflowSlugs);
		}
		for (const provider of manifest.integrationProviders) {
			yield* assertSlug("integration provider", provider.slug);
			if (provider.lot !== "push") {
				yield* assertReference("Integration provider", provider.scriptSlug, scriptSlugs);
				if (manifest.scripts.find(({ slug }) => slug === provider.scriptSlug)?.kind !== "script") {
					return yield* fail(
						`Integration provider ${provider.slug} script ${provider.scriptSlug} must be a direct script`,
					);
				}
			}
		}

		const eventSchemaSlugs = new Set(
			Object.values(snapshot.entitySchemas).flatMap((entitySchema) =>
				Object.keys(entitySchema.eventSchemas).map(
					(eventSchemaSlug) => `${entitySchema.slug}:${eventSchemaSlug}`,
				),
			),
		);
		for (const hook of manifest.hooks) {
			yield* assertReference("Automation hook", hook.scriptSlug, scriptSlugs);
			yield* assertAutomationScript("Automation hook", hook.scriptSlug, manifest.scripts);
			for (const target of hook.targets) {
				if (target.resource === "entity" || target.resource === "provider-entity-import") {
					yield* assertReference(
						"Automation hook",
						target.entitySchemaSlug,
						new Set(Object.keys(snapshot.entitySchemas)),
					);
				}
				if (target.resource === "event") {
					yield* assertReference(
						"Automation hook",
						`${target.entitySchemaSlug}:${target.eventSchemaSlug}`,
						eventSchemaSlugs,
					);
				}
				if (target.resource === "relationship") {
					yield* assertReference(
						"Automation hook",
						target.relationshipSchemaSlug,
						new Set(Object.keys(snapshot.relationshipSchemas)),
					);
				}
				if (target.resource === "signal") {
					yield* assertReference(
						"Automation hook",
						target.signalSchemaSlug,
						new Set(Object.keys(snapshot.signalSchemas)),
					);
				}
			}
		}
		return yield* Effect.void;
	});

export const validateIntegrationProviderSettingsSchemas = (manifest: PluginManifestValue) =>
	Effect.forEach(
		manifest.integrationProviders,
		(provider) => {
			const reservedField = Object.keys(provider.settingsSchema.fields).find((field) =>
				integrationCommonPropertyNames.has(field),
			);
			if (reservedField) {
				return Effect.fail(
					fail(
						`Integration provider ${provider.slug} in plugin ${manifest.metadata.slug} declares reserved settings field: ${reservedField}`,
					),
				);
			}
			return parseLabeledPropertySchemaInput(
				provider.settingsSchema,
				`Integration provider ${provider.slug} settings`,
			).pipe(
				Effect.mapError((error) =>
					fail(
						`Integration provider ${provider.slug} in plugin ${manifest.metadata.slug} has an invalid settingsSchema: ${formatPropertyIssues(error.issues)}`,
					),
				),
			);
		},
		{ discard: true },
	);

export const validateImportSourceInputSchemas = (manifest: PluginManifestValue) =>
	Effect.forEach(
		manifest.importSources,
		(source) => {
			const reservedField = Object.keys(source.inputSchema.fields).find(
				(field) => field === "source" || importInternalPropertyNames.has(field),
			);
			if (reservedField) {
				return Effect.fail(
					fail(
						`Import source ${source.slug} in plugin ${manifest.metadata.slug} declares reserved input field: ${reservedField}`,
					),
				);
			}
			const invalidUploadTokenField = Object.entries(source.inputSchema.fields).find(
				([field, property]) =>
					isImportUploadTokenField(field) &&
					(property.type !== "string" || property.format?.kind !== "upload"),
			)?.[0];
			if (invalidUploadTokenField) {
				return Effect.fail(
					fail(
						`Import source ${source.slug} in plugin ${manifest.metadata.slug} declares upload token field without upload format: ${invalidUploadTokenField}`,
					),
				);
			}
			const issues = validateAppSchemaDefinition(source.inputSchema, { allowUpload: true });
			return issues.length === 0
				? Effect.void
				: Effect.fail(
						fail(
							`Import source ${source.slug} in plugin ${manifest.metadata.slug} has an invalid inputSchema: ${formatPropertyIssues(issues)}`,
						),
					);
		},
		{ discard: true },
	);

export const validatePluginExecutableScripts = (plugin: {
	readonly manifest: PluginManifestValue;
	readonly scripts: ReadonlyArray<{
		readonly slug: string;
		readonly metadata: { readonly kind?: PluginScript["kind"] };
	}>;
}) =>
	Effect.gen(function* () {
		for (const entry of plugin.manifest.userBootstrap) {
			const script = plugin.scripts.find(({ slug }) => slug === entry.scriptSlug);
			if (!script) {
				return yield* fail(
					`User bootstrap ${entry.slug} references missing compiled script: ${entry.scriptSlug}`,
				);
			}
			if (script.metadata.kind !== "script") {
				return yield* fail(
					`User bootstrap ${entry.slug} script ${entry.scriptSlug} must be a direct script`,
				);
			}
		}
		for (const operation of plugin.manifest.operations) {
			const script = plugin.scripts.find(({ slug }) => slug === operation.scriptSlug);
			if (!script) {
				return yield* fail(
					`Operation ${operation.slug} references missing compiled script: ${operation.scriptSlug}`,
				);
			}
			if (script.metadata.kind !== "operation") {
				return yield* fail(
					`Operation ${operation.slug} script ${operation.scriptSlug} must be an operation script`,
				);
			}
		}
		for (const workflow of plugin.manifest.workflows) {
			const script = plugin.scripts.find(({ slug }) => slug === workflow.scriptSlug);
			if (!script) {
				return yield* fail(
					`Workflow ${workflow.slug} references missing compiled script: ${workflow.scriptSlug}`,
				);
			}
			if (script.metadata.kind !== "workflow") {
				return yield* fail(
					`Workflow ${workflow.slug} script ${workflow.scriptSlug} must be a workflow script`,
				);
			}
		}
		return yield* Effect.void;
	});

type ScriptDescriptor = Pick<PluginScript, "kind" | "slug">;

export const validateSignalSchemaFormatterReferences = (
	snapshot: DefinitionSnapshot,
	pluginScripts: ReadonlyArray<ScriptDescriptor>,
	kernelScripts: ReadonlyArray<ScriptDescriptor>,
	kernelSignalSlugs: ReadonlySet<string>,
) =>
	Effect.gen(function* () {
		const scripts = [...pluginScripts, ...kernelScripts];
		const kernelScriptSlugs = new Set(kernelScripts.map(({ slug }) => slug));
		const scriptSlugs = new Set<string>();
		for (const script of scripts) {
			if (scriptSlugs.has(script.slug)) {
				return yield* fail(`Duplicate script slug: ${script.slug}`);
			}
			scriptSlugs.add(script.slug);
		}
		for (const signalSchema of Object.values(snapshot.signalSchemas)) {
			if (signalSchema.pluginId != null) {
				continue;
			}
			if (
				kernelScriptSlugs.has(signalSchema.notificationHookSlug) &&
				!kernelSignalSlugs.has(signalSchema.slug)
			) {
				return yield* fail(
					`Signal schema ${signalSchema.slug} cannot reference kernel source-zero formatter: ${signalSchema.notificationHookSlug}`,
				);
			}
			const matches = kernelScripts.filter(
				({ slug }) => slug === signalSchema.notificationHookSlug,
			);
			if (matches.length === 0) {
				return yield* fail(
					`Signal schema ${signalSchema.slug} notification hook references missing script: ${signalSchema.notificationHookSlug}`,
				);
			}
			if (!matches.some(({ kind }) => kind === "automation")) {
				return yield* fail(
					`Signal schema ${signalSchema.slug} notification hook ${signalSchema.notificationHookSlug} must reference an automation script`,
				);
			}
		}
		return yield* Effect.void;
	});
