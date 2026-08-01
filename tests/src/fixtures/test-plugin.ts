import { randomUUID } from "node:crypto";

import type { ContractPayload } from "@ryot/contract/client";
import { PluginSlug, type SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import { getBackendClient } from "./contract-client";

type InstallPluginPayload = ContractPayload<"plugins", "install">;
type TestPluginManifest = InstallPluginPayload["manifest"];
type PluginScript = TestPluginManifest["scripts"][number];

export type TestPluginScript = {
	[Kind in PluginScript["kind"]]: Omit<Extract<PluginScript, { kind: Kind }>, "entry">;
}[PluginScript["kind"]];

type TestPluginManifestInput = Partial<
	Pick<
		TestPluginManifest,
		| "boot"
		| "crons"
		| "scripts"
		| "workflows"
		| "providers"
		| "operations"
		| "configSchema"
		| "importSources"
		| "entitySchemas"
		| "httpRateLimits"
		| "relationshipSchemas"
		| "integrationProviders"
	>
> & {
	pluginSlug: TestPluginManifest["metadata"]["slug"];
	linkToProviderSlug?: TestPluginManifest["bindings"]["schemaProviderLinks"][number]["providerSlug"];
	linkToEntitySchemaSlug?: TestPluginManifest["bindings"]["schemaProviderLinks"][number]["entitySchemaSlug"];
	eventAutomations?: TestPluginManifest["bindings"]["eventAutomations"];
};

export type InstalledTestPlugin = {
	slug: string;
	active: boolean;
	pluginSlug: PluginSlug;
	scriptId: SandboxScriptId;
	scriptIds: Record<string, SandboxScriptId>;
	files: InstallPluginPayload["files"];
	manifest: TestPluginManifest;
};

type InstalledScriptRegistration = {
	installed: InstalledTestPlugin;
	targetSlug: string;
};

const installedByScriptId = new Map<string, InstalledScriptRegistration>();
const definitionManifests = new Map<string, TestPluginManifest>();

export const testPluginManifest = (input: TestPluginManifestInput): TestPluginManifest => ({
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
	httpRateLimits: input.httpRateLimits ?? [],
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
	boot?: TestPluginManifest["boot"];
	crons?: TestPluginManifest["crons"];
	providers?: TestPluginManifest["providers"];
	operations?: TestPluginManifest["operations"];
	configSchema?: TestPluginManifest["configSchema"];
	entitySchemas?: TestPluginManifest["entitySchemas"];
	httpRateLimits?: TestPluginManifest["httpRateLimits"];
}) =>
	Effect.gen(function* () {
		const entry = `scripts/${input.script.kind}.sandbox.ts`;
		const pluginSlug = input.pluginSlug ?? `e2e-plugin-${randomUUID()}`;
		const pluginSlugId = PluginSlug.make(pluginSlug);
		const manifest = testPluginManifest({
			pluginSlug,
			providers: input.providers ?? [],
			configSchema: input.configSchema,
			httpRateLimits: input.httpRateLimits,
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
	files: InstallPluginPayload["files"];
	linkToEntitySchemaSlug?: string;
	crons?: TestPluginManifest["crons"];
	scripts: TestPluginManifest["scripts"];
	workflows?: TestPluginManifest["workflows"];
	providers?: TestPluginManifest["providers"];
	operations?: TestPluginManifest["operations"];
	configSchema?: TestPluginManifest["configSchema"];
	importSources?: TestPluginManifest["importSources"];
	entitySchemas?: TestPluginManifest["entitySchemas"];
	httpRateLimits?: TestPluginManifest["httpRateLimits"];
	eventAutomations?: TestPluginManifest["bindings"]["eventAutomations"];
	relationshipSchemas?: TestPluginManifest["relationshipSchemas"];
	integrationProviders?: TestPluginManifest["integrationProviders"];
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
			httpRateLimits: input.httpRateLimits,
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
	entitySchemas?: TestPluginManifest["entitySchemas"];
	relationshipSchemas?: TestPluginManifest["relationshipSchemas"];
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
