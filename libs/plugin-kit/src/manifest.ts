import { DisplayConfiguration } from "@ryot/contract/display-configuration";
import { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import { AppSchema } from "@ryot/contract/schema/property-schema";
import { SANDBOX_HOST_CAPABILITIES } from "@ryot/sandbox-sdk/core";
import { Schema } from "effect";

const strictStruct = <Fields extends Record<string, Schema.Struct.Field>>(fields: Fields) =>
	Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "error" as const } });

export const PluginMetadata = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	version: Schema.String,
	accentColor: Schema.String,
	description: Schema.String,
});

export type PluginMetadata = Schema.Schema.Type<typeof PluginMetadata>;

export const PluginEventSchema = strictStruct({
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
});

export type PluginEventSchema = Schema.Schema.Type<typeof PluginEventSchema>;

export const PluginEntitySchema = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	accentColor: Schema.String,
	propertiesSchema: AppSchema,
	eventSchemas: Schema.Array(PluginEventSchema),
	mergeIdentityProperties: Schema.optional(Schema.Array(Schema.String)),
});

export type PluginEntitySchema = Schema.Schema.Type<typeof PluginEntitySchema>;

export const PluginRelationshipSchema = strictStruct({
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
	sourceEntitySchemaSlug: Schema.NullOr(Schema.String),
	targetEntitySchemaSlug: Schema.NullOr(Schema.String),
});

export type PluginRelationshipSchema = Schema.Schema.Type<typeof PluginRelationshipSchema>;

export const PluginSignalAudiencePolicy = Schema.Union(
	strictStruct({ kind: Schema.Literal("actor") }),
	strictStruct({
		kind: Schema.Literal("related_users"),
		relationshipSchemaSlug: Schema.String,
		subjectSide: Schema.Literal("source", "target"),
	}),
);

export type PluginSignalAudiencePolicy = Schema.Schema.Type<typeof PluginSignalAudiencePolicy>;

export const PluginSignalSchema = strictStruct({
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
	notificationScriptSlug: Schema.String,
	audiencePolicy: PluginSignalAudiencePolicy,
	catalogState: Schema.Literal("active", "hidden"),
});

export type PluginSignalSchema = Schema.Schema.Type<typeof PluginSignalSchema>;

export const PluginSavedView = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	sortOrder: Schema.Number,
	accentColor: Schema.String,
	queryDocument: QueryDocument,
	displayConfiguration: DisplayConfiguration,
	pluginSlug: Schema.NullOr(Schema.String),
});

export type PluginSavedView = Schema.Schema.Type<typeof PluginSavedView>;

const sandboxManifestString = Schema.String.pipe(
	Schema.filter((value) => value.length > 0 && value === value.trim(), {
		message: () => "Expected a non-empty string without surrounding whitespace",
	}),
);

const sandboxManifestSlug = Schema.String.pipe(
	Schema.filter((value) => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value), {
		message: () => "Expected a sandbox manifest slug",
	}),
);

const PluginScriptFields = {
	entry: Schema.String,
	slug: sandboxManifestSlug,
	name: sandboxManifestString,
	requiredAppConfigKeys: Schema.Array(sandboxManifestString),
};
const PluginScriptCapabilities = Schema.Array(Schema.Literal(...SANDBOX_HOST_CAPABILITIES));

export const PluginProviderOperation = Schema.Literal("details", "search", "resolve", "translate");

export type PluginProviderOperation = Schema.Schema.Type<typeof PluginProviderOperation>;

export const PluginProviderInformation = strictStruct({
	source: sandboxManifestString,
	canonicalLanguage: Schema.optional(sandboxManifestString),
});

export type PluginProviderInformation = Schema.Schema.Type<typeof PluginProviderInformation>;

export const PluginProvider = strictStruct({
	slug: sandboxManifestSlug,
	name: sandboxManifestString,
	information: PluginProviderInformation,
	operations: strictStruct({
		details: sandboxManifestSlug,
		search: Schema.optional(sandboxManifestSlug),
		resolve: Schema.optional(sandboxManifestSlug),
		translate: Schema.optional(sandboxManifestSlug),
	}),
});

export type PluginProvider = Schema.Schema.Type<typeof PluginProvider>;

export const PluginScript = Schema.Union(
	strictStruct({
		...PluginScriptFields,
		kind: Schema.Literal("script"),
		capabilities: PluginScriptCapabilities,
		providerSlug: Schema.optional(sandboxManifestSlug),
	}),
	strictStruct({
		...PluginScriptFields,
		kind: Schema.Literal("activity"),
		capabilities: PluginScriptCapabilities,
		providerSlug: Schema.optional(sandboxManifestSlug),
	}),
	strictStruct({
		...PluginScriptFields,
		kind: Schema.Literal("operation"),
		capabilities: PluginScriptCapabilities,
	}),
	strictStruct({
		...PluginScriptFields,
		kind: Schema.Literal("workflow"),
		capabilities: Schema.Tuple(),
	}),
	strictStruct({
		...PluginScriptFields,
		kind: Schema.Literal("automation"),
		capabilities: PluginScriptCapabilities,
	}),
	strictStruct({
		...PluginScriptFields,
		kind: Schema.Literal("provider"),
		capabilities: PluginScriptCapabilities,
		providerSlug: sandboxManifestSlug,
		providerOperation: PluginProviderOperation,
	}),
);

export type PluginScript = Schema.Schema.Type<typeof PluginScript>;

const PluginCronFields = {
	slug: sandboxManifestSlug,
	schedule: sandboxManifestString,
	description: sandboxManifestString,
};

export const PluginCron = Schema.Union(
	strictStruct({
		...PluginCronFields,
		lot: Schema.Literal("script"),
		scriptSlug: sandboxManifestSlug,
	}),
	strictStruct({
		...PluginCronFields,
		lot: Schema.Literal("workflow"),
		workflowSlug: sandboxManifestSlug,
	}),
);

export type PluginCron = Schema.Schema.Type<typeof PluginCron>;

export const PluginBoot = strictStruct({
	slug: sandboxManifestSlug,
	scriptSlug: sandboxManifestSlug,
	description: sandboxManifestString,
});

export type PluginBoot = Schema.Schema.Type<typeof PluginBoot>;

export const PluginOperationAuth = Schema.Literal("user", "integration");

export type PluginOperationAuth = Schema.Schema.Type<typeof PluginOperationAuth>;

export const PluginOperation = strictStruct({
	slug: sandboxManifestSlug,
	auth: PluginOperationAuth,
	scriptSlug: sandboxManifestSlug,
	description: sandboxManifestString,
});

export type PluginOperation = Schema.Schema.Type<typeof PluginOperation>;

export const PluginWorkflow = strictStruct({
	slug: sandboxManifestSlug,
	scriptSlug: sandboxManifestSlug,
});

export type PluginWorkflow = Schema.Schema.Type<typeof PluginWorkflow>;

const PluginIntegrationProviderFields = {
	slug: sandboxManifestSlug,
	settingsSchema: AppSchema,
	name: sandboxManifestString,
	description: sandboxManifestString,
};

export const PluginIntegrationProvider = Schema.Union(
	strictStruct({
		...PluginIntegrationProviderFields,
		scriptSlug: sandboxManifestSlug,
		lot: Schema.Literal("yank", "sink"),
	}),
	strictStruct({ ...PluginIntegrationProviderFields, lot: Schema.Literal("push") }),
);

export type PluginIntegrationProvider = Schema.Schema.Type<typeof PluginIntegrationProvider>;

const PluginImportSourceFields = {
	slug: sandboxManifestSlug,
	name: sandboxManifestString,
	workflowSlug: sandboxManifestSlug,
	description: sandboxManifestString,
	requiredAppConfigKeys: Schema.Array(sandboxManifestString),
};

const PluginNamedImportArtifact = strictStruct({
	key: sandboxManifestString,
	required: Schema.Boolean,
	uploadTokenField: sandboxManifestString,
	allowedFileExtensions: Schema.Array(sandboxManifestString),
});

export const PluginImportSource = Schema.Union(
	strictStruct({ ...PluginImportSourceFields, input: Schema.Literal("payload") }),
	strictStruct({
		...PluginImportSourceFields,
		lot: Schema.Literal("single"),
		input: Schema.Literal("file"),
		allowedFileExtensions: Schema.Array(sandboxManifestString),
	}),
	strictStruct({
		...PluginImportSourceFields,
		lot: Schema.Literal("named"),
		input: Schema.Literal("file"),
		artifacts: Schema.Array(PluginNamedImportArtifact),
	}).pipe(
		Schema.filter(
			({ artifacts }) =>
				artifacts.length > 0 &&
				new Set(artifacts.map(({ key }) => key)).size === artifacts.length &&
				new Set(artifacts.map(({ uploadTokenField }) => uploadTokenField)).size ===
					artifacts.length,
		),
	),
);

export type PluginImportSource = Schema.Schema.Type<typeof PluginImportSource>;

export const PluginSchemaProviderLink = strictStruct({
	entitySchemaSlug: Schema.String,
	providerSlug: sandboxManifestSlug,
});

export type PluginSchemaProviderLink = Schema.Schema.Type<typeof PluginSchemaProviderLink>;

export const PluginLifecycleOperation = Schema.Literal("create", "delete", "update");

export type PluginLifecycleOperation = Schema.Schema.Type<typeof PluginLifecycleOperation>;

export const PluginEntityAutomation = strictStruct({
	scriptSlug: Schema.String,
	entitySchemaSlug: Schema.String,
	operation: PluginLifecycleOperation,
});

export type PluginEntityAutomation = Schema.Schema.Type<typeof PluginEntityAutomation>;

export const PluginRelationshipAutomation = strictStruct({
	scriptSlug: Schema.String,
	operation: PluginLifecycleOperation,
	relationshipSchemaSlug: Schema.String,
});

export type PluginRelationshipAutomation = Schema.Schema.Type<typeof PluginRelationshipAutomation>;

export const PluginEventAutomation = strictStruct({
	scriptSlug: Schema.String,
	eventSchemaSlug: Schema.String,
	position: Schema.optional(Schema.Number),
	kind: Schema.Literal("policy", "subscription"),
	metadata: Schema.optional(
		strictStruct({ inheritedProperties: Schema.optional(Schema.Array(Schema.String)) }),
	),
});

export type PluginEventAutomation = Schema.Schema.Type<typeof PluginEventAutomation>;

export const PluginSignalAutomation = strictStruct({
	scriptSlug: Schema.String,
	signalSchemaSlug: Schema.String,
});

export type PluginSignalAutomation = Schema.Schema.Type<typeof PluginSignalAutomation>;

export const PluginBindings = strictStruct({
	eventAutomations: Schema.Array(PluginEventAutomation),
	entityAutomations: Schema.Array(PluginEntityAutomation),
	signalAutomations: Schema.Array(PluginSignalAutomation),
	schemaProviderLinks: Schema.Array(PluginSchemaProviderLink),
	relationshipAutomations: Schema.Array(PluginRelationshipAutomation),
});

export type PluginBindings = Schema.Schema.Type<typeof PluginBindings>;

const PluginManifestFields = strictStruct({
	metadata: PluginMetadata,
	bindings: PluginBindings,
	boot: Schema.Array(PluginBoot),
	crons: Schema.Array(PluginCron),
	scripts: Schema.Array(PluginScript),
	workflows: Schema.Array(PluginWorkflow),
	providers: Schema.Array(PluginProvider),
	savedViews: Schema.Array(PluginSavedView),
	operations: Schema.Array(PluginOperation),
	entitySchemas: Schema.Array(PluginEntitySchema),
	signalSchemas: Schema.Array(PluginSignalSchema),
	importSources: Schema.Array(PluginImportSource),
	relationshipSchemas: Schema.Array(PluginRelationshipSchema),
	integrationProviders: Schema.Array(PluginIntegrationProvider),
});

export const PluginManifest = PluginManifestFields.pipe(
	Schema.filter(
		(manifest) => {
			const scriptSlugs = new Set(manifest.scripts.map(({ slug }) => slug));
			const workflowSlugs = new Set(manifest.workflows.map(({ slug }) => slug));
			const providerSlugs = new Set(manifest.providers.map(({ slug }) => slug));
			if (scriptSlugs.size !== manifest.scripts.length) {
				return false;
			}
			if (providerSlugs.size !== manifest.providers.length) {
				return false;
			}
			if (workflowSlugs.size !== manifest.workflows.length) {
				return false;
			}
			if (
				new Set(manifest.importSources.map(({ slug }) => slug)).size !==
				manifest.importSources.length
			) {
				return false;
			}
			if (
				new Set(manifest.integrationProviders.map(({ slug }) => slug)).size !==
				manifest.integrationProviders.length
			) {
				return false;
			}
			if (manifest.importSources.some(({ workflowSlug }) => !workflowSlugs.has(workflowSlug))) {
				return false;
			}
			if (
				manifest.workflows.some(
					(workflow) =>
						manifest.scripts.find(({ slug }) => slug === workflow.scriptSlug)?.kind !== "workflow",
				)
			) {
				return false;
			}

			if (
				manifest.scripts.some(
					(script) =>
						"providerSlug" in script &&
						script.providerSlug !== undefined &&
						!providerSlugs.has(script.providerSlug),
				)
			) {
				return false;
			}
			const providerScripts = manifest.scripts.filter((script) => script.kind === "provider");

			const operationAssignments = manifest.providers.flatMap((provider) =>
				Object.entries(provider.operations).map(([operation, scriptSlug]) => ({
					operation,
					providerSlug: provider.slug,
					scriptSlug,
				})),
			);
			if (
				new Set(operationAssignments.map(({ scriptSlug }) => scriptSlug)).size !==
				operationAssignments.length
			) {
				return false;
			}

			if (
				operationAssignments.some(({ operation, providerSlug, scriptSlug }) => {
					const script = providerScripts.find((candidate) => candidate.slug === scriptSlug);
					return (
						!script ||
						script.providerSlug !== providerSlug ||
						script.providerOperation !== operation
					);
				})
			) {
				return false;
			}

			if (
				providerScripts.some(
					(script) =>
						!operationAssignments.some(
							(assignment) =>
								assignment.scriptSlug === script.slug &&
								assignment.providerSlug === script.providerSlug &&
								assignment.operation === script.providerOperation,
						),
				)
			) {
				return false;
			}

			const referencedScriptSlugs = [
				...manifest.boot.map(({ scriptSlug }) => scriptSlug),
				...manifest.crons.flatMap((cron) => (cron.lot === "script" ? [cron.scriptSlug] : [])),
				...manifest.operations.map(({ scriptSlug }) => scriptSlug),
				...manifest.workflows.map(({ scriptSlug }) => scriptSlug),
				...manifest.bindings.eventAutomations.map(({ scriptSlug }) => scriptSlug),
				...manifest.bindings.entityAutomations.map(({ scriptSlug }) => scriptSlug),
				...manifest.bindings.signalAutomations.map(({ scriptSlug }) => scriptSlug),
				...manifest.bindings.relationshipAutomations.map(({ scriptSlug }) => scriptSlug),
				...manifest.integrationProviders.flatMap((provider) =>
					provider.lot === "push" ? [] : [provider.scriptSlug],
				),
			];

			return (
				referencedScriptSlugs.every((scriptSlug) => scriptSlugs.has(scriptSlug)) &&
				manifest.crons.every(
					(cron) => cron.lot === "script" || workflowSlugs.has(cron.workflowSlug),
				) &&
				manifest.bindings.schemaProviderLinks.every(({ providerSlug }) =>
					providerSlugs.has(providerSlug),
				)
			);
		},
		{ message: () => "Expected valid plugin provider and script references" },
	),
);

export type PluginManifest = Schema.Schema.Type<typeof PluginManifest>;

export const definePlugin = <const Manifest extends PluginManifest>(
	manifest: Manifest & Record<Exclude<keyof Manifest, keyof PluginManifest>, never>,
) => manifest;
