import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Result, Schema, SchemaGetter } from "effect";

import { JsonValue } from "../../schema/json";
import { AppSchema, type AppPropertyDefinition } from "../../schema/property-schema";
import { HttpUrl, strictStruct } from "../../schema/utils";
import {
	AutomationAfterInputProjection,
	AutomationPolicyInputProjection,
	AutomationRetryPolicy,
	AutomationSource,
} from "../automations/lifecycle";
import { RyotQLDocument } from "../ryotql/language";
import { POLICY_SAFE_SANDBOX_CAPABILITIES, SANDBOX_HOST_CAPABILITIES } from "../sandbox/wire";
import { AuthoredSavedViewRenderer } from "../saved-views/schemas";
import { isSupportedUploadFileExtension } from "../uploads/upload-policy";
import { pluginConfigEnvironmentKey } from "./plugin-config";

export const CLIENT_API_VERSION = 1 as const;

export const comparePluginRoutePaths = (left: string, right: string) => {
	const leftSegments = left.split("/");
	const rightSegments = right.split("/");
	for (let index = 0; index < Math.max(leftSegments.length, rightSegments.length); index += 1) {
		const leftSegment = leftSegments[index] ?? "";
		const rightSegment = rightSegments[index] ?? "";
		const dynamicOrder = Number(leftSegment.startsWith("$")) - Number(rightSegment.startsWith("$"));
		if (dynamicOrder !== 0) {
			return dynamicOrder;
		}
		const segmentOrder = leftSegment.localeCompare(rightSegment);
		if (segmentOrder !== 0) {
			return segmentOrder;
		}
	}
	return left.localeCompare(right);
};

const pluginManifestSlug = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) =>
			/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value) ? true : "Expected a plugin manifest slug",
		),
	),
);

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
		),
	),
);

const PluginClientExportFields = {
	entry: PluginClientSourceEntry,
	automaticEntityPresentations: Schema.Boolean,
};

export const PluginClientExport = Schema.Union([
	strictStruct({ ...PluginClientExportFields, kind: Schema.Literal("component") }),
	strictStruct({ ...PluginClientExportFields, kind: Schema.Literal("presentation") }),
	strictStruct({
		...PluginClientExportFields,
		kind: Schema.Literal("page"),
		settingsSchema: PluginAppSchema,
	}),
]);

export type PluginClientExport = Schema.Schema.Type<typeof PluginClientExport>;

const PluginClientExports = Schema.Record(Schema.String, PluginClientExport).pipe(
	Schema.check(
		Schema.makeFilter((exports) =>
			Object.keys(exports).every((name) => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name))
				? true
				: "Expected canonical public client export names",
		),
	),
);

const PluginClientDependencies = Schema.Array(pluginManifestSlug).pipe(
	Schema.check(
		Schema.makeFilter((dependencies) =>
			new Set(dependencies).size === dependencies.length
				? true
				: "Expected unique plugin client dependencies",
		),
	),
);

export const PluginClientEntry = strictStruct({
	homeView: Schema.NullOr(pluginManifestSlug),
	exports: Schema.optional(PluginClientExports),
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	notFoundPage: Schema.optional(pluginManifestSlug),
	pluginDependencies: Schema.optional(PluginClientDependencies),
	routes: Schema.optional(Schema.Record(Schema.String, pluginManifestSlug)),
	entities: Schema.optional(
		Schema.Record(
			pluginManifestSlug,
			strictStruct({
				detailPage: Schema.optional(pluginManifestSlug),
				gridPresentation: Schema.optional(pluginManifestSlug),
				listPresentation: Schema.optional(pluginManifestSlug),
			}),
		),
	),
});

export type PluginClientEntry = Schema.Schema.Type<typeof PluginClientEntry>;

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
	notificationHookSlug: pluginManifestSlug,
	audiencePolicy: PluginSignalAudiencePolicy,
	catalogState: Schema.Literals(["active", "hidden"]),
});

export type PluginSignalSchema = Schema.Schema.Type<typeof PluginSignalSchema>;

export const PluginSavedView = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	sortOrder: Schema.Number,
	renderer: AuthoredSavedViewRenderer,
	pluginSlug: Schema.NullOr(Schema.String),
	dataSources: Schema.NullOr(PluginQueryDocument),
	settings: Schema.Record(Schema.String, JsonValue),
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

const sandboxManifestSlug = pluginManifestSlug;

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
		}),
	),
);

const pluginConfigFieldTypes = new Set(["enum", "string", "number", "integer", "boolean"]);

export const PluginConfigSchema = PluginAppSchema.pipe(
	Schema.check(
		Schema.makeFilter((schema) =>
			schema.unknownKeys === "strict" &&
			schema.rules === undefined &&
			Object.values(schema.fields).every(
				(field) =>
					pluginConfigFieldTypes.has(field.type) &&
					field.translatable === undefined &&
					((field.type !== "number" && field.type !== "integer") || field.normalize === undefined),
			)
				? true
				: "Expected a strict, top-level plugin config schema without translation, normalization, or rules",
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
		kind: Schema.Literal("script"),
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
		capabilities: Schema.Tuple([]),
		kind: Schema.Literal("workflow"),
	}),
	strictStruct({
		...PluginScriptFields,
		kind: Schema.Literal("automation"),
		capabilities: PluginScriptCapabilities,
		automationType: Schema.Literal("automation"),
		inputProjection: AutomationAfterInputProjection,
	}),
	strictStruct({
		...PluginScriptFields,
		kind: Schema.Literal("automation"),
		automationType: Schema.Literal("policy"),
		inputProjection: AutomationPolicyInputProjection,
		capabilities: Schema.Array(Schema.Literals([...POLICY_SAFE_SANDBOX_CAPABILITIES])),
	}),
	Schema.Union([
		strictStruct({
			...PluginScriptFields,
			kind: Schema.Literal("provider"),
			providerSlug: sandboxManifestSlug,
			capabilities: PluginScriptCapabilities,
			providerOperation: Schema.Literal("search"),
			searchOptionsSchema: Schema.optional(PluginAppSchema),
		}),
		strictStruct({
			...PluginScriptFields,
			kind: Schema.Literal("provider"),
			providerSlug: sandboxManifestSlug,
			capabilities: PluginScriptCapabilities,
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

export const PluginCron = strictStruct({ ...PluginCronFields, scriptSlug: sandboxManifestSlug });

export type PluginCron = Schema.Schema.Type<typeof PluginCron>;

export const PluginUserBootstrap = strictStruct({
	slug: sandboxManifestSlug,
	scriptSlug: sandboxManifestSlug,
	description: sandboxManifestString,
});

export type PluginUserBootstrap = Schema.Schema.Type<typeof PluginUserBootstrap>;

export const PluginOperationAuth = Schema.Literals(["user", "integration"]);

export type PluginOperationAuth = Schema.Schema.Type<typeof PluginOperationAuth>;

const PluginOperationFields = {
	slug: sandboxManifestSlug,
	scriptSlug: sandboxManifestSlug,
	description: sandboxManifestString,
};

export const PluginOperation = Schema.Union([
	strictStruct({
		...PluginOperationFields,
		auth: Schema.Literal("user"),
		demoAccess: Schema.Literals(["allowed", "protected"]),
	}),
	strictStruct({ ...PluginOperationFields, auth: Schema.Literal("integration") }),
]);

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
		}),
	),
	Schema.check(
		Schema.makeFilter((schema) =>
			schema.unknownKeys === "strict" &&
			Object.values(schema.fields).every((property) => !hasDynamicChoices(property)) &&
			Object.values(schema.fields).every(
				(property) => property.type === "string" || !hasUploadFormat(property),
			)
				? true
				: "Expected a strict import input schema with static choices and only top-level uploads",
		),
	),
);

export const PluginImportExportHelp = strictStruct({
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

export const PluginHookTarget = Schema.Union([
	strictStruct({
		resource: Schema.Literal("entity"),
		operation: PluginLifecycleOperation,
		entitySchemaSlug: pluginManifestSlug,
	}),
	strictStruct({
		resource: Schema.Literal("event"),
		operation: PluginLifecycleOperation,
		eventSchemaSlug: pluginManifestSlug,
		entitySchemaSlug: pluginManifestSlug,
	}),
	strictStruct({
		operation: PluginLifecycleOperation,
		resource: Schema.Literal("relationship"),
		relationshipSchemaSlug: pluginManifestSlug,
	}),
	strictStruct({
		entitySchemaSlug: pluginManifestSlug,
		operation: Schema.Literal("complete"),
		resource: Schema.Literal("provider-entity-import"),
	}),
	strictStruct({
		operation: Schema.Literal("emit"),
		resource: Schema.Literal("signal"),
		signalSchemaSlug: pluginManifestSlug,
	}),
]);
export type PluginHookTarget = typeof PluginHookTarget.Type;
const hookFields = {
	slug: pluginManifestSlug,
	name: sandboxManifestString,
	scriptSlug: sandboxManifestSlug,
	metadata: Schema.optional(JsonValue),
	targets: Schema.Array(PluginHookTarget).pipe(Schema.check(Schema.isMinLength(1))),
	causationSources: Schema.optional(
		Schema.Array(AutomationSource).pipe(Schema.check(Schema.isMinLength(1))),
	),
};
export const PluginHook = Schema.Union([
	strictStruct({
		...hookFields,
		stage: Schema.Literal("before"),
		batchFrequency: Schema.optional(Schema.Literals(["item", "once-per-subject"])),
		position: Schema.optional(
			Schema.Number.pipe(Schema.check(Schema.makeFilter((n) => Number.isSafeInteger(n)))),
		),
	}).pipe(
		Schema.check(
			Schema.makeFilter(
				(hook) =>
					(hook.targets.every(
						(target) =>
							target.resource !== "signal" && target.resource !== "provider-entity-import",
					) &&
						(hook.batchFrequency === undefined ||
							hook.targets.every((target) => target.resource === "event"))) ||
					"Before hooks require mutation targets; batch frequency requires only event targets",
			),
		),
	),
	strictStruct({
		...hookFields,
		stage: Schema.Literal("after"),
		retry: Schema.optional(AutomationRetryPolicy),
		delivery: Schema.Literals(["required", "async"]),
		frequency: Schema.optional(Schema.Literals(["item", "batch"])),
		executionScope: Schema.optional(Schema.Literals(["user", "global"])),
	}).pipe(
		Schema.check(
			Schema.makeFilter(
				(hook) =>
					hook.frequency !== "batch" ||
					hook.targets.every(
						(target) =>
							target.resource === "entity" ||
							target.resource === "event" ||
							target.resource === "relationship",
					) ||
					"Batch hooks require entity, event or relationship targets",
			),
		),
	),
]);
export type PluginHook = typeof PluginHook.Type;
export const DEFAULT_POLICY_HOOK_POSITION = 1_000;

const PluginManifestAuthoredFields = {
	metadata: PluginMetadata,
	hooks: Schema.Array(PluginHook),
	crons: Schema.Array(PluginCron),
	configSchema: PluginConfigSchema,
	httpRateLimits: PluginHttpRateLimits,
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

export const KERNEL_DECLARED_SCHEMA_SURFACE = {
	relationshipSchemas: [{ slug: "member-of" }],
	signalSchemas: [{ slug: "integration.disabled" }],
	entitySchemas: [
		{
			slug: "collection",
			eventSchemas: [
				{ slug: "review" },
				{ slug: "add-entity-to-collection" },
				{ slug: "remove-entity-from-collection" },
			],
		},
	],
} as const;

const hasValidHookTargets = (manifest: typeof AuthoredPluginManifestFields.Type) => {
	if (new Set(manifest.hooks.map(({ slug }) => slug)).size !== manifest.hooks.length) {
		return false;
	}
	const entitySchemas = [
		...KERNEL_DECLARED_SCHEMA_SURFACE.entitySchemas,
		...manifest.entitySchemas,
	];
	const relationshipSchemas = [
		...KERNEL_DECLARED_SCHEMA_SURFACE.relationshipSchemas,
		...manifest.relationshipSchemas,
	];
	const signalSchemas = [
		...KERNEL_DECLARED_SCHEMA_SURFACE.signalSchemas,
		...manifest.signalSchemas,
	];
	for (const hook of manifest.hooks) {
		for (const target of hook.targets) {
			switch (target.resource) {
				case "entity":
				case "provider-entity-import":
					if (!entitySchemas.some(({ slug }) => slug === target.entitySchemaSlug)) {
						return false;
					}
					break;
				case "event":
					if (
						!entitySchemas.some(
							(entity) =>
								entity.slug === target.entitySchemaSlug &&
								entity.eventSchemas.some(({ slug }) => slug === target.eventSchemaSlug),
						)
					) {
						return false;
					}
					break;
				case "relationship":
					if (!relationshipSchemas.some(({ slug }) => slug === target.relationshipSchemaSlug)) {
						return false;
					}
					break;
				case "signal":
					if (!signalSchemas.some(({ slug }) => slug === target.signalSchemaSlug)) {
						return false;
					}
			}
		}
	}
	return manifest.signalSchemas.every((signal) =>
		manifest.hooks.some(
			(hook) =>
				hook.slug === signal.notificationHookSlug &&
				hook.stage === "after" &&
				hook.targets.some(
					(target) => target.resource === "signal" && target.signalSchemaSlug === signal.slug,
				),
		),
	);
};

const hasValidClientManifestReferences = (
	manifest: Pick<
		typeof AuthoredPluginManifestFields.Type,
		"client" | "entitySchemas" | "metadata" | "savedViews"
	>,
) => {
	const clientExports = manifest.client?.exports ?? {};
	if (manifest.client !== undefined && Object.keys(clientExports).length === 0) {
		return false;
	}
	const entitySchemaSlugs = new Set(manifest.entitySchemas.map(({ slug }) => slug));
	for (const [entitySchemaSlug, registrations] of Object.entries(manifest.client?.entities ?? {})) {
		if (!entitySchemaSlugs.has(entitySchemaSlug)) {
			return false;
		}
		if (
			registrations.detailPage !== undefined &&
			clientExports[registrations.detailPage]?.kind !== "page"
		) {
			return false;
		}
		for (const exportName of [registrations.gridPresentation, registrations.listPresentation]) {
			if (exportName !== undefined && clientExports[exportName]?.kind !== "presentation") {
				return false;
			}
		}
	}
	for (const exportName of [
		...Object.values(manifest.client?.routes ?? {}),
		...(manifest.client?.notFoundPage === undefined ? [] : [manifest.client.notFoundPage]),
	]) {
		if (clientExports[exportName]?.kind !== "page") {
			return false;
		}
	}
	if (
		manifest.client !== undefined &&
		manifest.client.homeView !== null &&
		!manifest.savedViews.some(
			(view) =>
				view.slug === manifest.client?.homeView && view.pluginSlug === manifest.metadata.slug,
		)
	) {
		return false;
	}
	for (const view of manifest.savedViews) {
		if (
			view.renderer.kind === "plugin" &&
			clientExports[view.renderer.exportName]?.kind !== "page"
		) {
			return false;
		}
	}
	return true;
};

const hasValidAuthoredPluginManifestReferences = (
	manifest: typeof AuthoredPluginManifestFields.Type,
) => {
	if (!hasValidClientManifestReferences(manifest) || !hasValidHookTargets(manifest)) {
		return false;
	}
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
		),
	),
);

export type AuthoredPluginManifest = Schema.Schema.Type<typeof AuthoredPluginManifest>;

const hasValidPluginManifestReferences = (manifest: typeof PluginManifestFields.Type) => {
	if (!hasValidClientManifestReferences(manifest) || !hasValidHookTargets(manifest)) {
		return false;
	}
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
		manifest.hooks.some((hook) => {
			const script = manifest.scripts.find(({ slug }) => slug === hook.scriptSlug);
			if (script?.kind !== "automation") {
				return true;
			}
			if (hook.stage === "before") {
				return (
					script.automationType !== "policy" ||
					hook.targets.some((target) => {
						if (
							target.resource !== "entity" &&
							target.resource !== "event" &&
							target.resource !== "relationship"
						) {
							return true;
						}
						return script.inputProjection[target.resource] === undefined;
					}) ||
					script.capabilities.some(
						(capability) => !POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability),
					)
				);
			}
			return (
				script.automationType !== "automation" ||
				hook.targets.some((target) => {
					const projectionKey =
						target.resource === "provider-entity-import" ? "providerEntityImport" : target.resource;
					return script.inputProjection[projectionKey] === undefined;
				}) ||
				((hook.retry?.maxAttempts ?? 1) > 1 &&
					script.capabilities.some(
						(capability) => capability === "httpCall" || capability === "sendNotification",
					) &&
					hook.retry?.externalIdempotency !== "run-id")
			);
		})
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
		operationAssignments.some(({ operation, scriptSlug, providerSlug }) => {
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
		...manifest.userBootstrap.map(({ scriptSlug }) => scriptSlug),
		...manifest.crons.map(({ scriptSlug }) => scriptSlug),
		...manifest.operations.map(({ scriptSlug }) => scriptSlug),
		...manifest.workflows.map(({ scriptSlug }) => scriptSlug),
		...manifest.hooks.map(({ scriptSlug }) => scriptSlug),
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
		),
	),
);

export type PluginManifest = Schema.Schema.Type<typeof PluginManifest>;

export const definePlugin = <const Manifest extends AuthoredPluginManifest>(
	manifest: Manifest & Record<Exclude<keyof Manifest, keyof AuthoredPluginManifest>, never>,
) => manifest;
