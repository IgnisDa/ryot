import { randomUUID } from "node:crypto";

import type { ContractPayload } from "@ryot-app/contract/client";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginSlug, type SandboxScriptId } from "@ryot-app/contract/schema/brands";
import type { PluginArchivePackage } from "@ryot-app/plugin-archive";
import { Effect, Encoding } from "effect";

import { requirePresent } from "~/support/assertions";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getApiClient } from "./contract-client";
import { pollUntil } from "./polling";
import { entityBrowserSettings, rowsDataSources } from "./saved-views";
import { uploadPrivatePluginPackage } from "./temporary-archive";

type TestPluginManifest = PluginManifest;
type PluginScript = TestPluginManifest["scripts"][number];
type PluginProvider = TestPluginManifest["providers"][number];
type InstallPluginPayload = ContractPayload<"plugins", "install">;

export type TestPluginScript = {
	[Kind in PluginScript["kind"]]: Omit<Extract<PluginScript, { kind: Kind }>, "entry">;
}[PluginScript["kind"]];

type TestPluginManifestInput = Partial<
	Pick<
		TestPluginManifest,
		| "boot"
		| "crons"
		| "savedViews"
		| "scripts"
		| "workflows"
		| "operations"
		| "configSchema"
		| "importSources"
		| "entitySchemas"
		| "userBootstrap"
		| "httpRateLimits"
		| "relationshipSchemas"
		| "integrationProviders"
	>
> & {
	providers?: ReadonlyArray<PluginProvider>;
	clientDefinition?: TestPluginManifest["client"];
	bindings?: Partial<TestPluginManifest["bindings"]>;
	pluginSlug: TestPluginManifest["metadata"]["slug"];
	eventAutomations?: TestPluginManifest["bindings"]["eventAutomations"];
};

type TestPluginOwner = { client?: undefined; scope: "system" } | { client: Client; scope?: "user" };

export type InstalledTestPlugin = {
	slug: string;
	client?: Client;
	active: boolean;
	pluginSlug: PluginSlug;
	scope: "system" | "user";
	scriptId: SandboxScriptId;
	manifest: TestPluginManifest;
	files: PluginArchivePackage["files"];
	scriptIds: Record<string, SandboxScriptId>;
};

type InstalledScriptRegistration = { targetSlug: string; installed: InstalledTestPlugin };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const installedByScriptId = new Map<string, InstalledScriptRegistration>();
const definitionManifests = new Map<string, { client: Client; manifest: TestPluginManifest }>();

export const encodePluginSourceFiles = (files: Readonly<Record<string, string>>) =>
	Object.fromEntries(
		Object.entries(files).map(([path, contents]) => [path, encoder.encode(contents)]),
	);

export const encodeTestSupportPluginFiles = (files: Readonly<Record<string, Uint8Array>>) =>
	Object.fromEntries(
		Object.entries(files).map(([path, contents]) => [path, Encoding.encodeBase64(contents)]),
	);

export const findTestEntitySchema = (slug: string) => {
	for (const [pluginSlug, { manifest }] of definitionManifests) {
		const schema = manifest.entitySchemas.find((candidate) => candidate.slug === slug);
		if (schema) {
			return { schema, pluginSlug };
		}
	}
	return undefined;
};

export const testPluginManifest = (input: TestPluginManifestInput): TestPluginManifest => ({
	signalSchemas: [],
	boot: input.boot ?? [],
	crons: input.crons ?? [],
	scripts: input.scripts ?? [],
	workflows: input.workflows ?? [],
	savedViews: input.savedViews ?? [],
	operations: input.operations ?? [],
	providers: [...(input.providers ?? [])],
	userBootstrap: input.userBootstrap ?? [],
	importSources: input.importSources ?? [],
	entitySchemas: input.entitySchemas ?? [],
	httpRateLimits: input.httpRateLimits ?? [],
	relationshipSchemas: input.relationshipSchemas ?? [],
	integrationProviders: input.integrationProviders ?? [],
	...(input.clientDefinition ? { client: input.clientDefinition } : {}),
	configSchema: input.configSchema ?? { fields: {}, unknownKeys: "strict" as const },
	metadata: {
		version: "1.0.0",
		icon: "flask-conical",
		slug: input.pluginSlug,
		name: "E2E Test Plugin",
		description: "Generic plugin fixture for end-to-end tests",
	},
	bindings: {
		entityAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		providerEntityImportAutomations: [],
		eventAutomations: input.eventAutomations ?? [],
		...input.bindings,
	},
});

export const testPluginSavedView = (input: {
	readonly slug: string;
	readonly name?: string;
}): TestPluginManifest["savedViews"][number] => ({
	icon: "star",
	sortOrder: 0,
	pluginSlug: null,
	slug: input.slug,
	dataSources: rowsDataSources,
	settings: entityBrowserSettings,
	name: input.name ?? "E2E Plugin View",
	renderer: { kind: "kernel", name: "entity-browser" },
});

const findInstalledScriptId = (scriptSlug: string, source: string, baseUrl?: string) =>
	Effect.gen(function* () {
		const scripts = yield* getApiClient(baseUrl).call(
			(c) => c.testSupport.listSandboxScripts({ query: {} }),
			adminHeaders(),
		);
		const script = scripts.find(
			(candidate) => candidate.slug === scriptSlug && candidate.source === source,
		);
		if (!script) {
			throw new Error(`Installed test plugin script '${scriptSlug}' was not found`);
		}
		return script.id;
	});

export const installTestPlugin = (
	input: {
		source: string;
		pluginSlug?: string;
		script: TestPluginScript;
		boot?: TestPluginManifest["boot"];
		crons?: TestPluginManifest["crons"];
		config?: InstallPluginPayload["config"];
		providers?: ReadonlyArray<PluginProvider>;
		savedViews?: TestPluginManifest["savedViews"];
		operations?: TestPluginManifest["operations"];
		configSchema?: TestPluginManifest["configSchema"];
		entitySchemas?: TestPluginManifest["entitySchemas"];
		httpRateLimits?: TestPluginManifest["httpRateLimits"];
		integrationProviders?: TestPluginManifest["integrationProviders"];
	} & TestPluginOwner,
) =>
	Effect.gen(function* () {
		const entry = `backend/scripts/${input.script.kind}.sandbox.ts`;
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
			...(input.savedViews ? { savedViews: input.savedViews } : {}),
			...(input.operations ? { operations: input.operations } : {}),
			...(input.entitySchemas ? { entitySchemas: input.entitySchemas } : {}),
			...(input.integrationProviders ? { integrationProviders: input.integrationProviders } : {}),
		});
		const files = { [entry]: encoder.encode(input.source) };
		if (input.scope === "system") {
			yield* getApiClient().call(
				(c) =>
					c.testSupport.installSystemPlugin({
						payload: { manifest, files: encodeTestSupportPluginFiles(files) },
					}),
				adminHeaders(),
			);
		} else {
			const uploadToken = yield* uploadPrivatePluginPackage(input.client, { files, manifest });
			yield* input.client.call((c) =>
				c.plugins.install({ payload: { uploadToken, config: input.config ?? {} } }),
			);
			yield* pollUntil(
				`private test plugin '${pluginSlug}' installation`,
				input.client
					.call((c) => c.plugins.list())
					.pipe(
						Effect.map((installations) => {
							const installation = installations.find(({ slug }) => slug === pluginSlug);
							return installation?.health === "ready" ? installation : null;
						}),
					),
			);
		}
		const scriptId = yield* findInstalledScriptId(input.script.slug, input.source);
		const installed = {
			files,
			manifest,
			scriptId,
			active: true,
			client: input.client,
			slug: input.script.slug,
			pluginSlug: pluginSlugId,
			scope: input.scope ?? "user",
			scriptIds: { [input.script.slug]: scriptId },
		};
		installedByScriptId.set(scriptId, { installed, targetSlug: input.script.slug });
		return installed;
	});

export const installTestPluginBundle = (
	input: {
		baseUrl?: string;
		pluginSlug?: string;
		crons?: TestPluginManifest["crons"];
		scripts: TestPluginManifest["scripts"];
		files: Readonly<Record<string, string>>;
		config?: InstallPluginPayload["config"];
		providers?: ReadonlyArray<PluginProvider>;
		workflows?: TestPluginManifest["workflows"];
		savedViews?: TestPluginManifest["savedViews"];
		operations?: TestPluginManifest["operations"];
		clientDefinition?: TestPluginManifest["client"];
		configSchema?: TestPluginManifest["configSchema"];
		importSources?: TestPluginManifest["importSources"];
		entitySchemas?: TestPluginManifest["entitySchemas"];
		httpRateLimits?: TestPluginManifest["httpRateLimits"];
		relationshipSchemas?: TestPluginManifest["relationshipSchemas"];
		integrationProviders?: TestPluginManifest["integrationProviders"];
		eventAutomations?: TestPluginManifest["bindings"]["eventAutomations"];
	} & TestPluginOwner,
) =>
	Effect.gen(function* () {
		const files = encodePluginSourceFiles(input.files);
		const pluginSlug = input.pluginSlug ?? `e2e-plugin-${randomUUID()}`;
		const pluginSlugId = PluginSlug.make(pluginSlug);
		const manifest = testPluginManifest({
			pluginSlug,
			crons: input.crons,
			scripts: input.scripts,
			workflows: input.workflows,
			savedViews: input.savedViews,
			providers: input.providers ?? [],
			configSchema: input.configSchema,
			operations: input.operations ?? [],
			importSources: input.importSources,
			entitySchemas: input.entitySchemas,
			httpRateLimits: input.httpRateLimits,
			eventAutomations: input.eventAutomations,
			clientDefinition: input.clientDefinition,
			relationshipSchemas: input.relationshipSchemas,
			integrationProviders: input.integrationProviders,
		});
		if (input.scope === "system") {
			yield* getApiClient(input.baseUrl).call(
				(c) =>
					c.testSupport.installSystemPlugin({
						payload: { manifest, files: encodeTestSupportPluginFiles(files) },
					}),
				adminHeaders(),
			);
		} else {
			const uploadToken = yield* uploadPrivatePluginPackage(
				input.client,
				{ files, manifest },
				input.baseUrl,
			);
			yield* input.client.call((c) =>
				c.plugins.install({ payload: { uploadToken, config: input.config ?? {} } }),
			);
			yield* pollUntil(
				`private test plugin '${pluginSlug}' installation`,
				input.client
					.call((c) => c.plugins.list())
					.pipe(
						Effect.map((installations) => {
							const installation = installations.find(({ slug }) => slug === pluginSlug);
							return installation?.health === "ready" ? installation : null;
						}),
					),
			);
		}
		const scriptIds = Object.fromEntries(
			yield* Effect.forEach(input.scripts, (script) =>
				findInstalledScriptId(
					script.slug,
					decoder.decode(files[script.entry] ?? new Uint8Array()),
					input.baseUrl,
				).pipe(Effect.map((scriptId) => [script.slug, scriptId] as const)),
			),
		);
		const scriptId =
			scriptIds[input.providers?.[0]?.operations.details ?? ""] ??
			scriptIds[input.scripts[0]?.slug ?? ""];
		if (!scriptId) {
			return yield* Effect.die(new Error("Test plugin bundle requires at least one script"));
		}
		const installed: InstalledTestPlugin = {
			files,
			manifest,
			scriptId,
			scriptIds,
			active: true,
			client: input.client,
			pluginSlug: pluginSlugId,
			scope: input.scope ?? "user",
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
	client: Client;
	pluginSlug: string;
	entitySchemas?: TestPluginManifest["entitySchemas"];
	relationshipSchemas?: TestPluginManifest["relationshipSchemas"];
}) =>
	Effect.gen(function* () {
		const current = definitionManifests.get(input.pluginSlug);
		const manifest = testPluginManifest({
			pluginSlug: input.pluginSlug,
			entitySchemas: mergeBySlug(current?.manifest.entitySchemas ?? [], input.entitySchemas ?? []),
			relationshipSchemas: mergeBySlug(
				current?.manifest.relationshipSchemas ?? [],
				input.relationshipSchemas ?? [],
			),
		});
		if (current) {
			const uploadToken = yield* uploadPrivatePluginPackage(input.client, { manifest, files: {} });
			yield* input.client.call((c) =>
				c.plugins.update({
					payload: { uploadToken },
					params: { pluginSlug: PluginSlug.make(input.pluginSlug) },
				}),
			);
		} else {
			const uploadToken = yield* uploadPrivatePluginPackage(input.client, { manifest, files: {} });
			yield* input.client.call((c) => c.plugins.install({ payload: { config: {}, uploadToken } }));
			yield* pollUntil(
				`private definition plugin '${input.pluginSlug}' installation`,
				input.client
					.call((c) => c.plugins.list())
					.pipe(
						Effect.map((installations) => {
							const installation = installations.find(({ slug }) => slug === input.pluginSlug);
							return installation?.health === "ready" ? installation : null;
						}),
					),
			);
		}
		definitionManifests.set(input.pluginSlug, { manifest, client: input.client });
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
		const files = { ...installed.files, [target.entry]: encoder.encode(source) };
		const scripts = [...installed.manifest.scripts];
		scripts[targetIndex] = { ...script, entry: target.entry };
		const manifest = { ...installed.manifest, scripts };
		if (installed.scope === "system") {
			yield* getApiClient().call(
				(c) =>
					c.testSupport.installSystemPlugin({
						payload: { manifest, files: encodeTestSupportPluginFiles(files) },
					}),
				adminHeaders(),
			);
		} else {
			const client = requirePresent(installed.client, "User test plugin has no client");
			const uploadToken = yield* uploadPrivatePluginPackage(client, { files, manifest });
			yield* client.call((c) =>
				c.plugins.update({
					payload: { uploadToken },
					params: { pluginSlug: installed.pluginSlug },
				}),
			);
		}
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
		if (installed.scope === "system") {
			yield* getApiClient().call(
				(c) =>
					c.testSupport.uninstallSystemPlugin({ params: { pluginSlug: installed.pluginSlug } }),
				adminHeaders(),
			);
		} else {
			const client = requirePresent(installed.client, "User test plugin has no client");
			yield* client.call((c) =>
				c.plugins.uninstall({ params: { pluginSlug: installed.pluginSlug } }),
			);
		}
		installed.active = false;
		for (const [scriptId, registration] of installedByScriptId) {
			if (registration.installed === installed) {
				installedByScriptId.delete(scriptId);
			}
		}
	});

export const uninstallTestPlugin = (installed: InstalledTestPlugin) =>
	uninstallTestPluginStrict(installed).pipe(
		Effect.catchTag("PluginConflictError", (error) =>
			error.reason.code === "workflow-referenced"
				? Effect.logWarning(
						`[test-plugin] cleanup deferred for '${installed.pluginSlug}' (workflow still running)`,
						error,
					)
				: Effect.void,
		),
		Effect.catch((error) =>
			Effect.logWarning(
				`[test-plugin] cleanup failed for '${installed.pluginSlug}' (non-fatal)`,
				error,
			),
		),
	);
