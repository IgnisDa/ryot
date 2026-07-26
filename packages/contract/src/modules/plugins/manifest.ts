import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Result, Schema, SchemaGetter } from "effect";

import { AppSchema, type AppPropertyDefinition } from "../../schema/property-schema";
import { HttpUrl, strictStruct } from "../../schema/utils";
import { OutputFieldKey, RyotQLDocument } from "../ryotql/language";
import { SANDBOX_HOST_CAPABILITIES } from "../sandbox/wire";
import { SavedViewCardMapping, SavedViewTableMapping } from "../saved-views/schemas";
import { isSupportedUploadFileExtension } from "../uploads/upload-policy";
import { pluginConfigEnvironmentKey } from "./plugin-config";

const strictParseOptions = {
	parseOptions: { onExcessProperty: "error" },
} satisfies Schema.Annotations.Filter;

export const CLIENT_API_VERSION = 1 as const;

const PluginClientSourceEntry = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((entry) =>
			canonicalRelativePosixPathIssue(entry) === null &&
			entry.startsWith("client/") &&
			(entry.endsWith(".ts") || entry.endsWith(".tsx"))
				? true
				: "Expected a canonical client/**/*.ts or client/**/*.tsx entry",
		),
	),
);

export const PluginClientEntry = strictStruct({
	entry: PluginClientSourceEntry,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
});

export type PluginClientEntry = Schema.Schema.Type<typeof PluginClientEntry>;

const hasDynamicChoices = (property: AppPropertyDefinition): boolean => {
	if (
		(property.type === "enum" || property.type === "enum-array") &&
		property.choices.kind === "dynamic"
	) {
		return true;
	}
	if (property.type === "array") {
		return hasDynamicChoices(property.items);
	}
	if (property.type === "object") {
		return Object.values(property.properties).some(hasDynamicChoices);
	}
	return false;
};

const hasUploadFormat = (property: AppPropertyDefinition): boolean => {
	if (property.type === "string") {
		return property.format?.kind === "upload";
	}
	if (property.type === "array") {
		return hasUploadFormat(property.items);
	}
	if (property.type === "object") {
		return Object.values(property.properties).some(hasUploadFormat);
	}
	return false;
};

const unsupportedUploadFileExtension = (property: AppPropertyDefinition): string | undefined => {
	if (property.type === "string" && property.format?.kind === "upload") {
		return property.format.allowedFileExtensions.find(
			(extension) => !isSupportedUploadFileExtension(extension),
		);
	}
	if (property.type === "array") {
		return unsupportedUploadFileExtension(property.items);
	}
	if (property.type === "object") {
		return Object.values(property.properties)
			.map(unsupportedUploadFileExtension)
			.find((extension) => extension !== undefined);
	}
	return undefined;
};

const PluginAppSchema = Schema.toType(AppSchema).pipe(
	Schema.check(
		Schema.makeFilter(
			(schema) =>
				Object.values(schema.fields).every((property) => !hasUploadFormat(property)) ||
				"Upload fields are only supported by import input schemas",
			strictParseOptions,
		),
	),
);
const PluginQueryDocument = Schema.toType(RyotQLDocument);

export const PluginMetadata = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	version: Schema.String,
	description: Schema.String,
});

export type PluginMetadata = Schema.Schema.Type<typeof PluginMetadata>;

export const PluginEventSchema = strictStruct({
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: PluginAppSchema,
});

export type PluginEventSchema = Schema.Schema.Type<typeof PluginEventSchema>;

export const PluginEntityUserStatePolicy = strictStruct({
	deniedOperations: Schema.Array(Schema.Literals(["clear", "merge"])),
});

export type PluginEntityUserStatePolicy = Schema.Schema.Type<typeof PluginEntityUserStatePolicy>;

export const PluginEntitySchema = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: PluginAppSchema,
	eventSchemas: Schema.Array(PluginEventSchema),
	userState: Schema.optional(PluginEntityUserStatePolicy),
	mergeIdentityProperties: Schema.optional(Schema.Array(Schema.String)),
});

export type PluginEntitySchema = Schema.Schema.Type<typeof PluginEntitySchema>;

export const PluginRelationshipSchema = strictStruct({
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: PluginAppSchema,
	sourceEntitySchemaSlug: Schema.NullOr(Schema.String),
	targetEntitySchemaSlug: Schema.NullOr(Schema.String),
});

export type PluginRelationshipSchema = Schema.Schema.Type<typeof PluginRelationshipSchema>;

export const PluginSignalAudiencePolicy = Schema.Union([
	strictStruct({ kind: Schema.Literal("actor") }),
	strictStruct({
		kind: Schema.Literal("related_users"),
		relationshipSchemaSlug: Schema.String,
		subjectSide: Schema.Literals(["source", "target"]),
	}),
]);

export type PluginSignalAudiencePolicy = Schema.Schema.Type<typeof PluginSignalAudiencePolicy>;

export const PluginSignalSchema = strictStruct({
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: PluginAppSchema,
	notificationScriptSlug: Schema.String,
	audiencePolicy: PluginSignalAudiencePolicy,
	catalogState: Schema.Literals(["active", "hidden"]),
});

export type PluginSignalSchema = Schema.Schema.Type<typeof PluginSignalSchema>;

const PluginSavedViewCardLayout = strictStruct({
	...SavedViewCardMapping.fields,
	entityIdField: OutputFieldKey,
	queryDocument: PluginQueryDocument,
});

const PluginSavedViewTableLayout = strictStruct({
	...SavedViewTableMapping.fields,
	entityIdField: OutputFieldKey,
	queryDocument: PluginQueryDocument,
});

export const PluginSavedView = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	sortOrder: Schema.Number,
	pluginSlug: Schema.NullOr(Schema.String),
	entitySchemaSlug: Schema.NullOr(Schema.String),
	layouts: strictStruct({
		grid: PluginSavedViewCardLayout,
		list: PluginSavedViewCardLayout,
		table: PluginSavedViewTableLayout,
	}),
});

export type PluginSavedView = Schema.Schema.Type<typeof PluginSavedView>;

const sandboxManifestString = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) =>
			value.length > 0 && value === value.trim()
				? true
				: "Expected a non-empty string without surrounding whitespace",
		),
	),
);

const sandboxManifestSlug = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) =>
			/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value) ? true : "Expected a sandbox manifest slug",
		),
	),
);

const normalizeHttpOrigin = (value: string) => {
	const parsed = Result.try(() => new URL(value));
	if (Result.isFailure(parsed)) {
		return null;
	}
	const url = parsed.success;
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.href !== `${url.origin}/` ||
		url.hostname.includes("*")
	) {
		return null;
	}
	return url.origin;
};

const httpOrigin = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) =>
			normalizeHttpOrigin(value) === null ? "Expected an HTTP(S) URL origin" : true,
		),
	),
	Schema.decode({
		decode: SchemaGetter.transform((value) => normalizeHttpOrigin(value) ?? value),
		encode: SchemaGetter.transform((value) => normalizeHttpOrigin(value) ?? value),
	}),
);
const safePositiveInteger = Schema.Number.pipe(
	Schema.check(
		Schema.makeFilter((value) =>
			Number.isSafeInteger(value) && value > 0 ? true : "Expected a safe positive integer",
		),
	),
);

export const PluginHttpRateLimit = strictStruct({
	key: sandboxManifestSlug,
	requests: safePositiveInteger,
	intervalMs: safePositiveInteger,
	origins: Schema.Array(httpOrigin).pipe(
		Schema.check(
			Schema.makeFilter((origins) =>
				origins.length > 0 ? true : "Expected at least one HTTP(S) URL origin",
			),
		),
	),
});

export type PluginHttpRateLimit = Schema.Schema.Type<typeof PluginHttpRateLimit>;

const PluginHttpRateLimits = Schema.Array(PluginHttpRateLimit).pipe(
	Schema.check(
		Schema.makeFilter((declarations) => {
			const keys = declarations.map(({ key }) => key);
			const origins = declarations.flatMap((declaration) => declaration.origins);
			return new Set(keys).size === keys.length && new Set(origins).size === origins.length
				? true
				: "Expected unique HTTP rate limit keys and origins";
		}, strictParseOptions),
	),
);

const pluginConfigFieldTypes = new Set(["enum", "string", "number", "integer", "boolean"]);

export const PluginConfigSchema = PluginAppSchema.pipe(
	Schema.check(
		Schema.makeFilter(
			(schema) =>
				schema.unknownKeys === "strict" &&
				schema.rules === undefined &&
				Object.values(schema.fields).every(
					(field) =>
						pluginConfigFieldTypes.has(field.type) &&
						field.translatable === undefined &&
						((field.type !== "number" && field.type !== "integer") ||
							field.normalize === undefined),
				)
					? true
					: "Expected a strict, top-level plugin config schema without translation, normalization, or rules",
			strictParseOptions,
		),
	),
);

export type PluginConfigSchema = Schema.Schema.Type<typeof PluginConfigSchema>;

const PluginScriptFields = {
	entry: Schema.String,
	slug: sandboxManifestSlug,
	name: sandboxManifestString,
	requiredPluginConfigKeys: Schema.Array(sandboxManifestString),
	requiredSystemConfigKeys: Schema.Array(sandboxManifestString),
};
const PluginScriptCapabilities = Schema.Array(Schema.Literals([...SANDBOX_HOST_CAPABILITIES]));

export const PluginProviderOperation = Schema.Literals([
	"details",
	"search",
	"search-options",
	"resolve",
	"translate",
]);

export type PluginProviderOperation = Schema.Schema.Type<typeof PluginProviderOperation>;

export const PluginProviderInformation = strictStruct({
	source: sandboxManifestString,
	canonicalLanguage: Schema.optional(sandboxManifestString),
});

export type PluginProviderInformation = Schema.Schema.Type<typeof PluginProviderInformation>;

export const PluginProvider = strictStruct({
	slug: sandboxManifestSlug,
	name: sandboxManifestString,
	rootEntitySchemaSlug: Schema.String,
	information: PluginProviderInformation,
	operations: strictStruct({
		details: sandboxManifestSlug,
		search: Schema.optional(sandboxManifestSlug),
		resolve: Schema.optional(sandboxManifestSlug),
		translate: Schema.optional(sandboxManifestSlug),
		searchOptions: Schema.optional(sandboxManifestSlug),
	}),
});

export type PluginProvider = Schema.Schema.Type<typeof PluginProvider>;

export const PluginScript = Schema.Union([
	strictStruct({
		...PluginScriptFields,
		capabilities: PluginScriptCapabilities,
		kind: Schema.Literal("script"),
		providerSlug: Schema.optional(sandboxManifestSlug),
	}),
	strictStruct({
		...PluginScriptFields,
		capabilities: PluginScriptCapabilities,
		kind: Schema.Literal("operation"),
	}),
	strictStruct({
		...PluginScriptFields,
		capabilities: Schema.Tuple([]),
		kind: Schema.Literal("workflow"),
	}),
	strictStruct({
		...PluginScriptFields,
		capabilities: PluginScriptCapabilities,
		kind: Schema.Literal("automation"),
	}),
	Schema.Union([
		strictStruct({
			...PluginScriptFields,
			providerSlug: sandboxManifestSlug,
			capabilities: PluginScriptCapabilities,
			kind: Schema.Literal("provider"),
			providerOperation: Schema.Literal("search"),
			searchOptionsSchema: Schema.optional(PluginAppSchema),
		}),
		strictStruct({
			...PluginScriptFields,
			providerSlug: sandboxManifestSlug,
			capabilities: PluginScriptCapabilities,
			kind: Schema.Literal("provider"),
			providerOperation: Schema.Literals(["details", "resolve", "translate", "search-options"]),
		}),
	]),
]);

export type PluginScript = Schema.Schema.Type<typeof PluginScript>;

const PluginCronFields = {
	slug: sandboxManifestSlug,
	description: sandboxManifestString,
	schedule: Schema.Union([
		strictStruct({ cron: sandboxManifestString }),
		strictStruct({ tier: Schema.Literal("infrequent") }),
	]),
};

export const PluginCron = strictStruct({
	...PluginCronFields,
	scriptSlug: sandboxManifestSlug,
});

export type PluginCron = Schema.Schema.Type<typeof PluginCron>;

export const PluginBoot = strictStruct({
	slug: sandboxManifestSlug,
	scriptSlug: sandboxManifestSlug,
	description: sandboxManifestString,
});

export type PluginBoot = Schema.Schema.Type<typeof PluginBoot>;

export const PluginUserBootstrap = strictStruct({
	slug: sandboxManifestSlug,
	scriptSlug: sandboxManifestSlug,
	description: sandboxManifestString,
});

export type PluginUserBootstrap = Schema.Schema.Type<typeof PluginUserBootstrap>;

export const PluginOperationAuth = Schema.Literals(["user", "integration"]);

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
	name: sandboxManifestString,
	settingsSchema: PluginAppSchema,
	description: sandboxManifestString,
	requiresProKey: Schema.optional(Schema.Boolean),
};

export const PluginIntegrationProvider = Schema.Union([
	strictStruct({
		...PluginIntegrationProviderFields,
		scriptSlug: sandboxManifestSlug,
		lot: Schema.Literals(["yank", "sink"]),
	}),
	strictStruct({ ...PluginIntegrationProviderFields, lot: Schema.Literal("push") }),
]);

export type PluginIntegrationProvider = Schema.Schema.Type<typeof PluginIntegrationProvider>;

const PluginImportSourceFields = {
	slug: sandboxManifestSlug,
	name: sandboxManifestString,
	workflowSlug: sandboxManifestSlug,
	description: sandboxManifestString,
	requiredPluginConfigKeys: Schema.Array(sandboxManifestString),
};

const ImportInputSchema = Schema.toType(AppSchema).pipe(
	Schema.check(
		Schema.makeFilter((schema) => {
			const extension = Object.values(schema.fields)
				.map(unsupportedUploadFileExtension)
				.find((value) => value !== undefined);
			return extension === undefined
				? true
				: `Unsupported import upload file extension: ${extension}`;
		}, strictParseOptions),
	),
	Schema.check(
		Schema.makeFilter(
			(schema) =>
				schema.unknownKeys === "strict" &&
				Object.values(schema.fields).every((property) => !hasDynamicChoices(property)) &&
				Object.values(schema.fields).every(
					(property) => property.type === "string" || !hasUploadFormat(property),
				)
					? true
					: "Expected a strict import input schema with static choices and only top-level uploads",
			strictParseOptions,
		),
	),
);

const PluginImportExportHelp = strictStruct({
	docsUrl: Schema.optional(HttpUrl),
	steps: Schema.optional(
		Schema.Array(sandboxManifestString).pipe(Schema.check(Schema.isMinLength(1))),
	),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				value.docsUrl !== undefined ||
				value.steps !== undefined ||
				"Expected import export help documentation or steps",
			strictParseOptions,
		),
	),
);

export const PluginImportSource = strictStruct({
	...PluginImportSourceFields,
	inputSchema: ImportInputSchema,
	exportHelp: Schema.optional(PluginImportExportHelp),
});

export type PluginImportSource = Schema.Schema.Type<typeof PluginImportSource>;

export const PluginLifecycleOperation = Schema.Literals(["create", "delete", "update"]);

export type PluginLifecycleOperation = Schema.Schema.Type<typeof PluginLifecycleOperation>;

export const PluginEntityAutomation = strictStruct({
	scriptSlug: Schema.String,
	entitySchemaSlug: Schema.String,
	operation: PluginLifecycleOperation,
});

export type PluginEntityAutomation = Schema.Schema.Type<typeof PluginEntityAutomation>;

export const PluginProviderEntityImportAutomation = strictStruct({
	scriptSlug: sandboxManifestSlug,
	entitySchemaSlug: Schema.String,
});

export type PluginProviderEntityImportAutomation = Schema.Schema.Type<
	typeof PluginProviderEntityImportAutomation
>;

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
	kind: Schema.Literals(["policy", "subscription"]),
	metadata: Schema.optional(
		strictStruct({
			batchMode: Schema.optional(Schema.Literal("subject")),
			inheritedProperties: Schema.optional(Schema.Array(Schema.String)),
			origins: Schema.optional(
				Schema.Array(
					Schema.Literals([
						"api",
						"import",
						"bootstrap",
						"automation",
						"integration",
						"provider_refresh",
					]),
				),
			),
		}),
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
	relationshipAutomations: Schema.Array(PluginRelationshipAutomation),
	providerEntityImportAutomations: Schema.Array(PluginProviderEntityImportAutomation),
});

export type PluginBindings = Schema.Schema.Type<typeof PluginBindings>;

const PluginManifestAuthoredFields = {
	metadata: PluginMetadata,
	bindings: PluginBindings,
	configSchema: PluginConfigSchema,
	boot: Schema.Array(PluginBoot),
	httpRateLimits: PluginHttpRateLimits,
	crons: Schema.Array(PluginCron),
	workflows: Schema.Array(PluginWorkflow),
	providers: Schema.Array(PluginProvider),
	savedViews: Schema.Array(PluginSavedView),
	operations: Schema.Array(PluginOperation),
	client: Schema.optional(PluginClientEntry),
	entitySchemas: Schema.Array(PluginEntitySchema),
	signalSchemas: Schema.Array(PluginSignalSchema),
	importSources: Schema.Array(PluginImportSource),
	userBootstrap: Schema.Array(PluginUserBootstrap),
	relationshipSchemas: Schema.Array(PluginRelationshipSchema),
	integrationProviders: Schema.Array(PluginIntegrationProvider),
};

const AuthoredPluginManifestFields = strictStruct(PluginManifestAuthoredFields);

const PluginManifestFields = strictStruct({
	...PluginManifestAuthoredFields,
	scripts: Schema.Array(PluginScript),
});

const hasValidAuthoredPluginManifestReferences = (
	manifest: typeof AuthoredPluginManifestFields.Type,
) => {
	const workflowSlugs = new Set(manifest.workflows.map(({ slug }) => slug));
	const configKeys = new Set(Object.keys(manifest.configSchema.fields));
	const configEnvironmentKeys = [...configKeys].map((key) =>
		pluginConfigEnvironmentKey(manifest.metadata.slug, key),
	);
	if (new Set(configEnvironmentKeys).size !== configEnvironmentKeys.length) {
		return false;
	}
	if (
		!manifest.importSources
			.flatMap(({ requiredPluginConfigKeys }) => requiredPluginConfigKeys)
			.every((key) => configKeys.has(key))
	) {
		return false;
	}
	if (new Set(manifest.providers.map(({ slug }) => slug)).size !== manifest.providers.length) {
		return false;
	}
	if (workflowSlugs.size !== manifest.workflows.length) {
		return false;
	}
	if (
		new Set(manifest.userBootstrap.map(({ slug }) => slug)).size !== manifest.userBootstrap.length
	) {
		return false;
	}
	if (
		new Set(manifest.importSources.map(({ slug }) => slug)).size !== manifest.importSources.length
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
	const assignedScriptSlugs = manifest.providers.flatMap((provider) =>
		Object.values(provider.operations),
	);
	return new Set(assignedScriptSlugs).size === assignedScriptSlugs.length;
};

export const AuthoredPluginManifest = AuthoredPluginManifestFields.pipe(
	Schema.check(
		Schema.makeFilter(
			(manifest) =>
				hasValidAuthoredPluginManifestReferences(manifest) ||
				"Expected valid plugin config, provider, workflow, and import-source references",
			strictParseOptions,
		),
	),
);

export type AuthoredPluginManifest = Schema.Schema.Type<typeof AuthoredPluginManifest>;

const hasValidPluginManifestReferences = (manifest: typeof PluginManifestFields.Type) => {
	const scriptSlugs = new Set(manifest.scripts.map(({ slug }) => slug));
	const workflowSlugs = new Set(manifest.workflows.map(({ slug }) => slug));
	const providerSlugs = new Set(manifest.providers.map(({ slug }) => slug));
	const userBootstrapSlugs = new Set(manifest.userBootstrap.map(({ slug }) => slug));
	const configKeys = new Set(Object.keys(manifest.configSchema.fields));
	const configEnvironmentKeys = [...configKeys].map((key) =>
		pluginConfigEnvironmentKey(manifest.metadata.slug, key),
	);
	if (new Set(configEnvironmentKeys).size !== configEnvironmentKeys.length) {
		return false;
	}
	const requiredConfigKeys = [
		...manifest.scripts.flatMap(({ requiredPluginConfigKeys }) => requiredPluginConfigKeys),
		...manifest.importSources.flatMap(({ requiredPluginConfigKeys }) => requiredPluginConfigKeys),
	];
	if (!requiredConfigKeys.every((key) => configKeys.has(key))) {
		return false;
	}
	if (scriptSlugs.size !== manifest.scripts.length) {
		return false;
	}
	if (providerSlugs.size !== manifest.providers.length) {
		return false;
	}
	if (workflowSlugs.size !== manifest.workflows.length) {
		return false;
	}
	if (userBootstrapSlugs.size !== manifest.userBootstrap.length) {
		return false;
	}
	if (
		new Set(manifest.importSources.map(({ slug }) => slug)).size !== manifest.importSources.length
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
		manifest.userBootstrap.some(
			(entry) => manifest.scripts.find(({ slug }) => slug === entry.scriptSlug)?.kind !== "script",
		)
	) {
		return false;
	}
	if (
		manifest.bindings.providerEntityImportAutomations.some(
			(binding) =>
				manifest.scripts.find(({ slug }) => slug === binding.scriptSlug)?.kind !== "automation",
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
			scriptSlug,
			providerSlug: provider.slug,
			operation: operation === "searchOptions" ? "search-options" : operation,
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
				!script || script.providerSlug !== providerSlug || script.providerOperation !== operation
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
	if (
		providerScripts.some(
			(script) =>
				script.providerOperation === "search" &&
				script.searchOptionsSchema !== undefined &&
				Object.values(script.searchOptionsSchema.fields).some(hasDynamicChoices) &&
				!operationAssignments.some(
					(assignment) =>
						assignment.providerSlug === script.providerSlug &&
						assignment.operation === "search-options",
				),
		)
	) {
		return false;
	}

	const referencedScriptSlugs = [
		...manifest.boot.map(({ scriptSlug }) => scriptSlug),
		...manifest.userBootstrap.map(({ scriptSlug }) => scriptSlug),
		...manifest.crons.map(({ scriptSlug }) => scriptSlug),
		...manifest.operations.map(({ scriptSlug }) => scriptSlug),
		...manifest.workflows.map(({ scriptSlug }) => scriptSlug),
		...manifest.bindings.eventAutomations.map(({ scriptSlug }) => scriptSlug),
		...manifest.bindings.entityAutomations.map(({ scriptSlug }) => scriptSlug),
		...manifest.bindings.providerEntityImportAutomations.map(({ scriptSlug }) => scriptSlug),
		...manifest.bindings.signalAutomations.map(({ scriptSlug }) => scriptSlug),
		...manifest.bindings.relationshipAutomations.map(({ scriptSlug }) => scriptSlug),
		...manifest.integrationProviders.flatMap((provider) =>
			provider.lot === "push" ? [] : [provider.scriptSlug],
		),
	];

	return referencedScriptSlugs.every((scriptSlug) => scriptSlugs.has(scriptSlug));
};

export const PluginManifest = PluginManifestFields.pipe(
	Schema.check(
		Schema.makeFilter(
			(manifest) =>
				hasValidPluginManifestReferences(manifest) ||
				"Expected valid plugin config, provider, and script references",
			strictParseOptions,
		),
	),
);

export type PluginManifest = Schema.Schema.Type<typeof PluginManifest>;

export const definePlugin = <const Manifest extends AuthoredPluginManifest>(
	manifest: Manifest & Record<Exclude<keyof Manifest, keyof AuthoredPluginManifest>, never>,
) => manifest;
