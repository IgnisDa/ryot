import { randomUUID } from "node:crypto";

import { PluginSlug, type SandboxScriptId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import type {
	PluginManifest,
	PluginCron,
	PluginConfigSchema,
	PluginEventAutomation,
	PluginImportSource,
	PluginOperationAuth,
	PluginProviderInformation,
	PluginProviderOperation,
} from "@ryot/plugin-kit/manifest";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import { getBackendClient } from "./contract-client";

export type InstalledTestPlugin = {
	slug: string;
	active: boolean;
	pluginSlug: PluginSlug;
	scriptId: SandboxScriptId;
	scriptIds: Record<string, SandboxScriptId>;
	files: Record<string, string>;
	manifest: ReturnType<typeof testPluginManifest>;
};

type InstalledScriptRegistration = {
	installed: InstalledTestPlugin;
	targetSlug: string;
};

const installedByScriptId = new Map<string, InstalledScriptRegistration>();
const definitionManifests = new Map<string, ReturnType<typeof testPluginManifest>>();

type TestPluginScriptBase = {
	name: string;
	slug: string;
	capabilities: ReadonlyArray<string>;
	requiredPluginConfigKeys: ReadonlyArray<string>;
	requiredSystemConfigKeys: ReadonlyArray<string>;
};

export type TestPluginScript =
	| (TestPluginScriptBase & { kind: "operation" })
	| (TestPluginScriptBase & { kind: "automation" })
	| (TestPluginScriptBase & { kind: "workflow" })
	| (TestPluginScriptBase & { kind: "script"; providerSlug?: string })
	| (TestPluginScriptBase & {
			kind: "provider";
			providerSlug: string;
			providerOperation: PluginProviderOperation;
	  });

export type TestPluginProvider = {
	name: string;
	slug: string;
	information: PluginProviderInformation;
	operations: {
		details: string;
		search?: string;
		resolve?: string;
		translate?: string;
	};
};

export type TestPluginOperation = {
	slug: string;
	scriptSlug: string;
	description: string;
	auth: PluginOperationAuth;
};

export const testPluginManifest = (input: {
	pluginSlug: string;
	linkToProviderSlug?: string;
	linkToEntitySchemaSlug?: string;
	crons?: ReadonlyArray<PluginCron>;
	configSchema?: PluginConfigSchema;
	providers?: ReadonlyArray<TestPluginProvider>;
	operations?: ReadonlyArray<TestPluginOperation>;
	importSources?: ReadonlyArray<PluginImportSource>;
	eventAutomations?: ReadonlyArray<PluginEventAutomation>;
	integrationProviders?: PluginManifest["integrationProviders"];
	scripts?: ReadonlyArray<TestPluginScript & { entry: string }>;
	workflows?: ReadonlyArray<{ slug: string; scriptSlug: string }>;
	boot?: ReadonlyArray<{ slug: string; scriptSlug: string; description: string }>;
	relationshipSchemas?: ReadonlyArray<{
		name: string;
		slug: string;
		propertiesSchema: AppSchema;
		sourceEntitySchemaSlug: string | null;
		targetEntitySchemaSlug: string | null;
	}>;
	entitySchemas?: ReadonlyArray<{
		icon: string;
		name: string;
		slug: string;
		accentColor: string;
		propertiesSchema: AppSchema;
		eventSchemas: ReadonlyArray<{ name: string; slug: string; propertiesSchema: AppSchema }>;
	}>;
}) => ({
	savedViews: [],
	userBootstrap: [],
	signalSchemas: [],
	boot: input.boot ?? [],
	crons: input.crons ?? [],
	scripts: input.scripts ?? [],
	workflows: input.workflows ?? [],
	providers: input.providers ?? [],
	operations: input.operations ?? [],
	importSources: input.importSources ?? [],
	entitySchemas: input.entitySchemas ?? [],
	relationshipSchemas: input.relationshipSchemas ?? [],
	integrationProviders: input.integrationProviders ?? [],
	configSchema: input.configSchema ?? { fields: {}, unknownKeys: "strict" as const },
	metadata: {
		version: "1.0.0",
		icon: "flask-conical",
		slug: input.pluginSlug,
		accentColor: "#64748b",
		name: "E2E Test Plugin",
		description: "Generic plugin fixture for end-to-end tests",
	},
	bindings: {
		entityAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		eventAutomations: input.eventAutomations ?? [],
		schemaProviderLinks: input.linkToEntitySchemaSlug
			? [
					{
						entitySchemaSlug: input.linkToEntitySchemaSlug,
						providerSlug: input.linkToProviderSlug ?? input.providers?.[0]?.slug ?? "",
					},
				]
			: [],
	},
});

const findInstalledScriptId = (scriptSlug: string, source: string) =>
	Effect.gen(function* () {
		const scripts = yield* getBackendClient().call(
			(c) => c.testSupport.listSandboxScripts({ query: {} }),
			adminHeaders,
		);
		const script = scripts.find(
			(candidate) => candidate.slug === scriptSlug && candidate.source === source,
		);
		if (!script) {
			throw new Error(`Installed test plugin script '${scriptSlug}' was not found`);
		}
		return script.id;
	});

export const installTestPlugin = (input: {
	source: string;
	pluginSlug?: string;
	script: TestPluginScript;
	linkToEntitySchemaSlug?: string;
	configSchema?: PluginConfigSchema;
	boot?: Parameters<typeof testPluginManifest>[0]["boot"];
	crons?: Parameters<typeof testPluginManifest>[0]["crons"];
	providers?: Parameters<typeof testPluginManifest>[0]["providers"];
	operations?: Parameters<typeof testPluginManifest>[0]["operations"];
	entitySchemas?: Parameters<typeof testPluginManifest>[0]["entitySchemas"];
}) =>
	Effect.gen(function* () {
		const entry = `scripts/${input.script.kind}.sandbox.ts`;
		const pluginSlug = input.pluginSlug ?? `e2e-plugin-${randomUUID()}`;
		const pluginSlugId = PluginSlug.make(pluginSlug);
		const manifest = testPluginManifest({
			pluginSlug,
			providers: input.providers ?? [],
			configSchema: input.configSchema,
			scripts: [{ ...input.script, entry }],
			...(input.boot ? { boot: input.boot } : {}),
			...(input.crons ? { crons: input.crons } : {}),
			...(input.operations ? { operations: input.operations } : {}),
			...(input.entitySchemas ? { entitySchemas: input.entitySchemas } : {}),
			...(input.linkToEntitySchemaSlug && input.providers?.[0]
				? {
						linkToEntitySchemaSlug: input.linkToEntitySchemaSlug,
						linkToProviderSlug: input.providers[0].slug,
					}
				: {}),
		});
		const files = { [entry]: input.source };
		yield* getBackendClient().call(
			(c) => c.plugins.install({ payload: { files, manifest } }),
			adminHeaders,
		);
		const scriptId = yield* findInstalledScriptId(input.script.slug, input.source);
		const installed = {
			files,
			manifest,
			scriptId,
			active: true,
			slug: input.script.slug,
			pluginSlug: pluginSlugId,
			scriptIds: { [input.script.slug]: scriptId },
		};
		installedByScriptId.set(scriptId, { installed, targetSlug: input.script.slug });
		return installed;
	});

export const installTestPluginBundle = (input: {
	pluginSlug?: string;
	files: Record<string, string>;
	linkToEntitySchemaSlug?: string;
	configSchema?: PluginConfigSchema;
	providers?: ReadonlyArray<TestPluginProvider>;
	operations?: ReadonlyArray<TestPluginOperation>;
	crons?: Parameters<typeof testPluginManifest>[0]["crons"];
	scripts: ReadonlyArray<TestPluginScript & { entry: string }>;
	workflows?: Parameters<typeof testPluginManifest>[0]["workflows"];
	importSources?: Parameters<typeof testPluginManifest>[0]["importSources"];
	entitySchemas?: Parameters<typeof testPluginManifest>[0]["entitySchemas"];
	eventAutomations?: Parameters<typeof testPluginManifest>[0]["eventAutomations"];
	relationshipSchemas?: Parameters<typeof testPluginManifest>[0]["relationshipSchemas"];
	integrationProviders?: Parameters<typeof testPluginManifest>[0]["integrationProviders"];
}) =>
	Effect.gen(function* () {
		const pluginSlug = input.pluginSlug ?? `e2e-plugin-${randomUUID()}`;
		const pluginSlugId = PluginSlug.make(pluginSlug);
		const manifest = testPluginManifest({
			pluginSlug,
			crons: input.crons,
			scripts: input.scripts,
			workflows: input.workflows,
			providers: input.providers ?? [],
			configSchema: input.configSchema,
			operations: input.operations ?? [],
			importSources: input.importSources,
			entitySchemas: input.entitySchemas,
			eventAutomations: input.eventAutomations,
			relationshipSchemas: input.relationshipSchemas,
			integrationProviders: input.integrationProviders,
			...(input.linkToEntitySchemaSlug
				? {
						linkToProviderSlug: input.providers?.[0]?.slug,
						linkToEntitySchemaSlug: input.linkToEntitySchemaSlug,
					}
				: {}),
		});
		yield* getBackendClient().call(
			(c) => c.plugins.install({ payload: { files: input.files, manifest } }),
			adminHeaders,
		);
		const scriptIds = Object.fromEntries(
			yield* Effect.all(
				input.scripts.map((script) =>
					findInstalledScriptId(script.slug, input.files[script.entry] ?? "").pipe(
						Effect.map((scriptId) => [script.slug, scriptId] as const),
					),
				),
			),
		);
		const scriptId =
			scriptIds[input.providers?.[0]?.operations.details ?? ""] ??
			scriptIds[input.scripts[0]?.slug ?? ""];
		if (!scriptId) {
			return yield* Effect.die(new Error("Test plugin bundle requires at least one script"));
		}
		const installed: InstalledTestPlugin = {
			manifest,
			scriptId,
			scriptIds,
			active: true,
			files: input.files,
			pluginSlug: pluginSlugId,
			slug: input.providers?.[0]?.slug ?? input.scripts[0]?.slug ?? pluginSlug,
		};
		for (const [targetSlug, id] of Object.entries(scriptIds)) {
			installedByScriptId.set(id, { installed, targetSlug });
		}
		return installed;
	});

const mergeBySlug = <Definition extends { readonly slug: string }>(
	current: ReadonlyArray<Definition>,
	additions: ReadonlyArray<Definition>,
) => [
	...new Map(
		[...current, ...additions].map((definition) => [definition.slug, definition]),
	).values(),
];

export const installTestDefinitions = (input: {
	pluginSlug: string;
	entitySchemas?: Parameters<typeof testPluginManifest>[0]["entitySchemas"];
	relationshipSchemas?: Parameters<typeof testPluginManifest>[0]["relationshipSchemas"];
}) =>
	Effect.gen(function* () {
		const current = definitionManifests.get(input.pluginSlug);
		const manifest = testPluginManifest({
			pluginSlug: input.pluginSlug,
			entitySchemas: mergeBySlug(current?.entitySchemas ?? [], input.entitySchemas ?? []),
			relationshipSchemas: mergeBySlug(
				current?.relationshipSchemas ?? [],
				input.relationshipSchemas ?? [],
			),
		});
		yield* getBackendClient().call(
			(c) => c.plugins.install({ payload: { files: {}, manifest } }),
			adminHeaders,
		);
		definitionManifests.set(input.pluginSlug, manifest);
		return manifest;
	});

export const reinstallTestPluginScript = (
	targetScriptId: string,
	source: string,
	script: TestPluginScript,
) =>
	Effect.gen(function* () {
		const registration = installedByScriptId.get(targetScriptId);
		if (!registration) {
			throw new Error(`Installed test plugin for script '${targetScriptId}' was not found`);
		}
		const { installed } = registration;
		const targetSlug = registration.targetSlug;
		const targetIndex = installed.manifest.scripts.findIndex(({ slug }) => slug === targetSlug);
		const target = installed.manifest.scripts[targetIndex];
		if (!target) {
			throw new Error(`Installed test plugin '${installed.pluginSlug}' has no script entry`);
		}
		const files = { ...installed.files, [target.entry]: source };
		const scripts = [...installed.manifest.scripts];
		scripts[targetIndex] = { ...script, entry: target.entry };
		const manifest = { ...installed.manifest, scripts };
		yield* getBackendClient().call(
			(c) => c.plugins.install({ payload: { files, manifest } }),
			adminHeaders,
		);
		const scriptId = yield* findInstalledScriptId(script.slug, source);
		const updatesPrimaryScript = installed.scriptId === installed.scriptIds[targetSlug];
		installed.files = files;
		installed.manifest = manifest;
		if (updatesPrimaryScript) {
			installed.scriptId = scriptId;
		}
		delete installed.scriptIds[targetSlug];
		installed.scriptIds[script.slug] = scriptId;
		registration.targetSlug = script.slug;
		installedByScriptId.set(scriptId, registration);
		return installed;
	});

export const uninstallTestPluginStrict = (installed: InstalledTestPlugin) =>
	Effect.gen(function* () {
		if (!installed.active) {
			return;
		}
		yield* getBackendClient().call(
			(c) => c.plugins.uninstall({ params: { pluginSlug: installed.pluginSlug } }),
			adminHeaders,
		);
		installed.active = false;
		for (const [scriptId, registration] of installedByScriptId) {
			if (registration.installed === installed) {
				installedByScriptId.delete(scriptId);
			}
		}
	});

export const uninstallTestPlugin = (installed: InstalledTestPlugin) =>
	uninstallTestPluginStrict(installed).pipe(
		Effect.catch((error) =>
			Effect.logWarning(
				`[test-plugin] cleanup failed for '${installed.pluginSlug}' (non-fatal)`,
				error,
			),
		),
	);
