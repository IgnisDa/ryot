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
import { pluginPackageSegments, type PluginPackageId } from "@ryot-app/contract/schema/brands";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Cron, Data, Effect, Result, Schema } from "effect";

import {
	formatPropertyIssues,
	parseLabeledPropertySchemaInput,
	parseAppSchemaPropertiesSafe,
	validateAppSchemaDefinition,
} from "#lib/property-schema/property-schema-runtime";
import type { DefinitionSnapshot } from "#modules/definition-registry/snapshot";

export class PluginValidationError extends Data.TaggedError("PluginValidationError")<{
	readonly issues: ReadonlyArray<string>;
}> {}

const reservedPluginPublisher = "ryot";
const fail = (issue: string) => new PluginValidationError({ issues: [issue] });
const encodeEventSchemaReference = Schema.encodeSync(
	Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
);

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

export const validatePluginScriptEntries = (manifest: PluginManifestValue) =>
	Effect.gen(function* () {
		for (const script of manifest.scripts) {
			const issue = canonicalRelativePosixPathIssue(script.entry);
			if (issue) {
				return yield* fail(`Plugin script entry '${script.entry}' ${issue}`);
			}
		}
		return yield* Effect.void;
	});

export class PluginSurfaceError extends Data.TaggedError("PluginSurfaceError")<{
	readonly surfaces: ReadonlyArray<string>;
}> {}

export class PluginPackageReservedError extends Data.TaggedError("PluginPackageReservedError")<{
	readonly packageId: PluginPackageId;
}> {}

const userRejectedCollections = [
	"httpRateLimits",
	"oauthProviders",
] as const satisfies ReadonlyArray<
	{
		[Key in keyof PluginManifestValue]-?: NonNullable<
			PluginManifestValue[Key]
		> extends ReadonlyArray<unknown>
			? Key
			: never;
	}[keyof PluginManifestValue]
>;

export const validatePluginManifestPolicy = (
	manifest: PluginManifestValue,
	policy:
		| { readonly scope: "system" }
		| { readonly scope: "user"; readonly systemPackageIds: ReadonlySet<PluginPackageId> },
) =>
	Effect.gen(function* () {
		if (manifest.userSettingsSchema) {
			const definitionIssues = validateAppSchemaDefinition(manifest.userSettingsSchema);
			if (definitionIssues.length > 0) {
				return yield* fail(
					`Invalid plugin user settings schema: ${formatPropertyIssues(definitionIssues)}`,
				);
			}
			const defaults = parseAppSchemaPropertiesSafe({
				properties: {},
				propertiesSchema: manifest.userSettingsSchema,
			});
			if (!defaults.success) {
				return yield* fail(
					`Plugin user settings must have valid defaults: ${formatPropertyIssues(defaults.issues)}`,
				);
			}
		}
		if (policy.scope === "system") {
			return yield* Effect.void;
		}
		const surfaces = userRejectedCollections.filter((field) => (manifest[field] ?? []).length > 0);
		if (surfaces.length > 0) {
			return yield* new PluginSurfaceError({ surfaces });
		}
		if (
			policy.systemPackageIds.has(manifest.metadata.packageId) ||
			pluginPackageSegments(manifest.metadata.packageId).publisher === reservedPluginPublisher
		) {
			return yield* new PluginPackageReservedError({ packageId: manifest.metadata.packageId });
		}
		return yield* Effect.void;
	});

export const validatePluginManifestReferences = (manifest: PluginManifestValue) =>
	Effect.gen(function* () {
		const entities = new Set(manifest.entitySchemas.map(({ slug }) => slug));
		const relationships = new Set(manifest.relationshipSchemas.map(({ slug }) => slug));
		const signals = new Set(manifest.signalSchemas.map(({ slug }) => slug));
		for (const [kind, definitions] of [
			["entity schema", manifest.entitySchemas],
			["relationship schema", manifest.relationshipSchemas],
			["signal schema", manifest.signalSchemas],
			["saved view", manifest.savedViews],
			["provider", manifest.providers],
			["hook", manifest.hooks],
			["import source", manifest.importSources],
			["integration provider", manifest.integrationProviders],
		] as const) {
			const slugs = new Set<string>();
			for (const { slug } of definitions) {
				if (slugs.has(slug)) {
					return yield* fail(`Duplicate ${kind} slug: ${slug}`);
				}
				slugs.add(slug);
			}
		}
		const cronSlugs = new Set<string>();
		const scriptSlugs = new Set<string>();
		const workflowSlugs = new Set<string>();
		const operationSlugs = new Set<string>();
		const userBootstrapSlugs = new Set<string>();
		for (const definition of manifest.entitySchemas) {
			yield* assertSlug("entity schema", definition.slug);
			const events = new Set<string>();
			for (const eventSchema of definition.eventSchemas) {
				if (events.has(eventSchema.slug)) {
					return yield* fail(
						`Duplicate event schema slug for ${definition.slug}: ${eventSchema.slug}`,
					);
				}
				events.add(eventSchema.slug);
				yield* assertSlug("event schema", eventSchema.slug);
			}
		}
		for (const definition of manifest.relationshipSchemas) {
			yield* assertSlug("relationship schema", definition.slug);
			for (const slug of [definition.sourceEntitySchemaSlug, definition.targetEntitySchemaSlug]) {
				if (slug !== null) {
					yield* assertReference("Relationship endpoint", slug, entities);
				}
			}
		}
		for (const definition of manifest.signalSchemas) {
			yield* assertSlug("signal schema", definition.slug);
			if (definition.audiencePolicy.kind === "related_users") {
				yield* assertReference(
					"Signal audience",
					definition.audiencePolicy.relationshipSchemaSlug,
					relationships,
				);
			}
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
				entities,
			);
		}
		for (const script of manifest.scripts) {
			yield* assertSlug("script", script.slug);
			if (scriptSlugs.has(script.slug)) {
				return yield* fail(`Duplicate script slug: ${script.slug}`);
			}
			scriptSlugs.add(script.slug);
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
				if (
					manifest.scripts.find(({ slug }) => slug === provider.scriptSlug)?.kind !== "workflow"
				) {
					return yield* fail(
						`Integration provider ${provider.slug} script ${provider.scriptSlug} must be a workflow script`,
					);
				}
			}
		}

		const eventSchemaSlugs = new Set(
			manifest.entitySchemas.flatMap((entitySchema) =>
				entitySchema.eventSchemas.map(({ slug }) =>
					encodeEventSchemaReference([entitySchema.slug, slug]),
				),
			),
		);
		for (const hook of manifest.hooks) {
			yield* assertSlug("automation hook", hook.slug);
			yield* assertReference("Automation hook", hook.scriptSlug, scriptSlugs);
			yield* assertAutomationScript("Automation hook", hook.scriptSlug, manifest.scripts);
			for (const target of hook.targets) {
				if ("owner" in target) {
					if (hook.stage !== "after" || hook.executionScope === "global") {
						return yield* fail("Kernel collection observers require user-scoped after hooks");
					}
					continue;
				}
				if (target.resource === "entity" || target.resource === "provider-entity-import") {
					yield* assertReference("Automation hook", target.entitySchemaSlug, entities);
				}
				if (target.resource === "event") {
					yield* assertReference(
						"Automation hook",
						encodeEventSchemaReference([target.entitySchemaSlug, target.eventSchemaSlug]),
						eventSchemaSlugs,
					);
				}
				if (target.resource === "relationship") {
					yield* assertReference("Automation hook", target.relationshipSchemaSlug, relationships);
				}
				if (target.resource === "signal") {
					yield* assertReference("Automation hook", target.signalSchemaSlug, signals);
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
						`Integration provider ${provider.slug} in plugin ${manifest.metadata.packageId} declares reserved settings field: ${reservedField}`,
					),
				);
			}
			return parseLabeledPropertySchemaInput(
				provider.settingsSchema,
				`Integration provider ${provider.slug} settings`,
			).pipe(
				Effect.mapError((error) =>
					fail(
						`Integration provider ${provider.slug} in plugin ${manifest.metadata.packageId} has an invalid settingsSchema: ${formatPropertyIssues(error.issues)}`,
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
						`Import source ${source.slug} in plugin ${manifest.metadata.packageId} declares reserved input field: ${reservedField}`,
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
						`Import source ${source.slug} in plugin ${manifest.metadata.packageId} declares upload token field without upload format: ${invalidUploadTokenField}`,
					),
				);
			}
			const issues = validateAppSchemaDefinition(source.inputSchema, { allowUpload: true });
			return issues.length === 0
				? Effect.void
				: Effect.fail(
						fail(
							`Import source ${source.slug} in plugin ${manifest.metadata.packageId} has an invalid inputSchema: ${formatPropertyIssues(issues)}`,
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
		for (const provider of plugin.manifest.integrationProviders) {
			if (provider.lot === "push") {
				continue;
			}
			const script = plugin.scripts.find(({ slug }) => slug === provider.scriptSlug);
			if (!script) {
				return yield* fail(
					`Integration provider ${provider.slug} references missing compiled script: ${provider.scriptSlug}`,
				);
			}
			if (script.metadata.kind !== "workflow") {
				return yield* fail(
					`Integration provider ${provider.slug} script ${provider.scriptSlug} must be a workflow script`,
				);
			}
		}
		return yield* Effect.void;
	});

type ScriptDescriptor = Pick<PluginScript, "kind" | "slug">;

export const validateSignalSchemaFormatterReferences = (
	snapshot: DefinitionSnapshot,
	kernelScripts: ReadonlyArray<ScriptDescriptor>,
	kernelSignalSlugs: ReadonlySet<string>,
) =>
	Effect.gen(function* () {
		const kernelScriptSlugs = new Set(kernelScripts.map(({ slug }) => slug));
		const scriptSlugs = new Set<string>();
		for (const script of kernelScripts) {
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
