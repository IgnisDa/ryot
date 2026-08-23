import { randomUUID } from "node:crypto";

import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	type PluginConfigRevisionId,
	type PluginId,
	PluginSlug,
	type PluginRevisionId,
	type SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import type { PluginArchivePackage } from "@ryot-app/plugin-archive";
import { Effect, Encoding } from "effect";

import { requirePresent } from "~/support/assertions";

import { adminHeaders } from "./admin";
import { listAdminSystemPlugins } from "./admin-system-plugins";
import type { Client } from "./auth";
import { getApiClient } from "./contract-client";
import { listInstalledPlugins } from "./plugins";
import { pollUntil } from "./polling";
import { entityBrowserSettings, rowsDataSources } from "./saved-views";
import { uploadPrivatePluginPackage } from "./temporary-archive";

type TestPluginManifest = PluginManifest;
type PluginScript = TestPluginManifest["scripts"][number];
type PluginProvider = TestPluginManifest["providers"][number];
type InstallPluginPayload = ContractPayload<"plugins", "install">;
type PluginOperationResult = ContractSuccess<"testSupport", "installSystemPlugin">;

export type TestPluginScript = PluginScript extends infer Script
	? Script extends { readonly entry: string }
		? Omit<Script, "entry">
		: never
	: never;

type TestPluginManifestInput = Partial<
	Pick<
		TestPluginManifest,
		| "crons"
		| "hooks"
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
	pluginSlug: TestPluginManifest["metadata"]["slug"];
};

type TestPluginOwner = { client?: undefined; scope: "system" } | { client: Client; scope?: "user" };

export type InstalledTestPlugin = {
	slug: string;
	client?: Client;
	active: boolean;
	pluginId: PluginId;
	pluginSlug: PluginSlug;
	scope: "system" | "user";
	sourceHash: string;
	scriptId: SandboxScriptId;
	installationId: string | null;
	configRevisionId: PluginConfigRevisionId | null;
	activePluginRevisionId: PluginRevisionId;
	manifest: TestPluginManifest;
	files: PluginArchivePackage["files"];
	scriptIds: Record<string, SandboxScriptId>;
};

type InstalledScriptRegistration = { targetSlug: string; installed: InstalledTestPlugin };

const encoder = new TextEncoder();
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
	crons: input.crons ?? [],
	hooks: input.hooks ?? [],
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

const operationScriptIds = (result: PluginOperationResult) =>
	Object.fromEntries(result.scripts.map(({ id, slug }) => [slug, id]));

const installedSourceHash = (
	scope: "system" | "user",
	pluginId: PluginId,
	pluginSlug: PluginSlug,
	client?: Client,
) =>
	Effect.gen(function* () {
		if (scope === "system") {
			const plugins = yield* listAdminSystemPlugins;
			const plugin = requirePresent(
				plugins.find(({ id }) => id === pluginId),
				`System plugin '${pluginSlug}' was not found after installation`,
			);
			return requirePresent(plugin.sourceHash, `System plugin '${pluginSlug}' has no source hash`);
		}
		const owner = requirePresent(client, "User test plugin has no client");
		const plugins = yield* listInstalledPlugins(owner, { includeDisabled: true });
		const plugin = requirePresent(
			plugins.find(({ slug }) => slug === pluginSlug),
			`Private plugin '${pluginSlug}' was not found after installation`,
		);
		return plugin.sourceHash;
	});

const requireFixtureUserId = (client: Client) =>
	requirePresent(client.userId, "Private test plugin client has no fixture user ID");

export const installTestPlugin = (
	input: {
		source: string;
		pluginSlug?: string;
		script: TestPluginScript;
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
		const manifest = testPluginManifest({
			pluginSlug,
			providers: input.providers ?? [],
			configSchema: input.configSchema,
			httpRateLimits: input.httpRateLimits,
			scripts: [{ ...input.script, entry }],
			...(input.crons ? { crons: input.crons } : {}),
			...(input.savedViews ? { savedViews: input.savedViews } : {}),
			...(input.operations ? { operations: input.operations } : {}),
			...(input.entitySchemas ? { entitySchemas: input.entitySchemas } : {}),
			...(input.integrationProviders ? { integrationProviders: input.integrationProviders } : {}),
		});
		const files = { [entry]: encoder.encode(input.source) };
		let operationResult: PluginOperationResult;
		if (input.scope === "system") {
			operationResult = yield* getApiClient().call(
				(c) =>
					c.testSupport.installSystemPlugin({
						payload: { manifest, files: encodeTestSupportPluginFiles(files) },
					}),
				adminHeaders(),
			);
		} else {
			const uploadToken = yield* uploadPrivatePluginPackage(input.client, { files, manifest });
			operationResult = yield* getApiClient().call(
				(c) =>
					c.testSupport.installPrivatePlugin({
						payload: { uploadToken, config: input.config ?? {} },
						params: { userId: requireFixtureUserId(input.client) },
					}),
				adminHeaders(),
			);
			yield* pollUntil(
				`private test plugin '${pluginSlug}' installation`,
				listInstalledPlugins(input.client, { includeDisabled: true }).pipe(
					Effect.map((installations) => {
						const installation = installations.find(({ slug }) => slug === pluginSlug);
						return installation?.health === "ready" ? installation : null;
					}),
				),
			);
		}
		const scriptIds = operationScriptIds(operationResult);
		const scriptId = requirePresent(
			scriptIds[input.script.slug],
			`Installed test plugin script '${input.script.slug}' was not returned`,
		);
		const sourceHash = yield* installedSourceHash(
			input.scope === "system" ? "system" : "user",
			operationResult.pluginId,
			PluginSlug.make(pluginSlug),
			input.client,
		);
		const installed: InstalledTestPlugin = {
			files,
			manifest,
			scriptId,
			scriptIds,
			sourceHash,
			active: true,
			client: input.client,
			slug: input.script.slug,
			pluginId: operationResult.pluginId,
			pluginSlug: PluginSlug.make(pluginSlug),
			installationId: operationResult.installationId,
			configRevisionId: operationResult.configRevisionId,
			scope: input.scope === "system" ? "system" : "user",
			activePluginRevisionId: operationResult.activePluginRevisionId,
		};
		installedByScriptId.set(scriptId, { installed, targetSlug: input.script.slug });
		return installed;
	});

export const installTestPluginBundle = (
	input: {
		baseUrl?: string;
		pluginSlug?: string;
		crons?: TestPluginManifest["crons"];
		hooks?: TestPluginManifest["hooks"];
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
	} & TestPluginOwner,
) =>
	Effect.gen(function* () {
		const files = encodePluginSourceFiles(input.files);
		const pluginSlug = input.pluginSlug ?? `e2e-plugin-${randomUUID()}`;
		const manifest = testPluginManifest({
			pluginSlug,
			crons: input.crons,
			hooks: input.hooks,
			scripts: input.scripts,
			workflows: input.workflows,
			savedViews: input.savedViews,
			providers: input.providers ?? [],
			configSchema: input.configSchema,
			operations: input.operations ?? [],
			importSources: input.importSources,
			entitySchemas: input.entitySchemas,
			httpRateLimits: input.httpRateLimits,
			clientDefinition: input.clientDefinition,
			relationshipSchemas: input.relationshipSchemas,
			integrationProviders: input.integrationProviders,
		});
		let operationResult: PluginOperationResult;
		if (input.scope === "system") {
			operationResult = yield* getApiClient(input.baseUrl).call(
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
			operationResult = yield* getApiClient(input.baseUrl).call(
				(c) =>
					c.testSupport.installPrivatePlugin({
						payload: { uploadToken, config: input.config ?? {} },
						params: { userId: requireFixtureUserId(input.client) },
					}),
				adminHeaders(),
			);
			yield* pollUntil(
				`private test plugin '${pluginSlug}' installation`,
				listInstalledPlugins(input.client, { includeDisabled: true }).pipe(
					Effect.map((installations) => {
						const installation = installations.find(({ slug }) => slug === pluginSlug);
						return installation?.health === "ready" ? installation : null;
					}),
				),
			);
		}
		const scriptIds = operationScriptIds(operationResult);
		const scriptId =
			scriptIds[input.providers?.[0]?.operations.details ?? ""] ??
			scriptIds[input.scripts[0]?.slug ?? ""];
		if (!scriptId) {
			return yield* Effect.die(new Error("Test plugin bundle requires at least one script"));
		}
		const sourceHash = yield* installedSourceHash(
			input.scope === "system" ? "system" : "user",
			operationResult.pluginId,
			PluginSlug.make(pluginSlug),
			input.client,
		);
		const installed: InstalledTestPlugin = {
			files,
			manifest,
			scriptId,
			scriptIds,
			sourceHash,
			active: true,
			client: input.client,
			pluginId: operationResult.pluginId,
			pluginSlug: PluginSlug.make(pluginSlug),
			installationId: operationResult.installationId,
			configRevisionId: operationResult.configRevisionId,
			scope: input.scope === "system" ? "system" : "user",
			activePluginRevisionId: operationResult.activePluginRevisionId,
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
				listInstalledPlugins(input.client, { includeDisabled: true }).pipe(
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
		let operationResult: PluginOperationResult;
		if (installed.scope === "system") {
			operationResult = yield* getApiClient().call(
				(c) =>
					c.testSupport.installSystemPlugin({
						payload: { manifest, files: encodeTestSupportPluginFiles(files) },
					}),
				adminHeaders(),
			);
		} else {
			const client = requirePresent(installed.client, "User test plugin has no client");
			const uploadToken = yield* uploadPrivatePluginPackage(client, { files, manifest });
			operationResult = yield* getApiClient().call(
				(c) =>
					c.testSupport.updatePrivatePlugin({
						payload: { uploadToken },
						params: { pluginSlug: installed.pluginSlug, userId: requireFixtureUserId(client) },
					}),
				adminHeaders(),
			);
		}
		const nextScriptIds = operationScriptIds(operationResult);
		const scriptId = requirePresent(
			nextScriptIds[script.slug],
			`Updated test plugin script '${script.slug}' was not returned`,
		);
		const updatesPrimaryScript = installed.scriptId === installed.scriptIds[targetSlug];
		const sourceHash = yield* installedSourceHash(
			installed.scope,
			operationResult.pluginId,
			installed.pluginSlug,
			installed.client,
		);
		const nextInstalled: InstalledTestPlugin = {
			...installed,
			files,
			manifest,
			sourceHash,
			scriptIds: nextScriptIds,
			pluginSlug: installed.pluginSlug,
			pluginId: operationResult.pluginId,
			installationId: operationResult.installationId,
			configRevisionId: operationResult.configRevisionId,
			scriptId: updatesPrimaryScript ? scriptId : installed.scriptId,
			activePluginRevisionId: operationResult.activePluginRevisionId,
		};
		for (const [registeredId, current] of installedByScriptId) {
			if (current.installed === installed) {
				installedByScriptId.set(registeredId, { ...current, installed: nextInstalled });
			}
		}
		for (const [scriptSlug, id] of Object.entries(nextScriptIds)) {
			installedByScriptId.set(id, { targetSlug: scriptSlug, installed: nextInstalled });
		}
		return nextInstalled;
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
			if (registration.installed.pluginId === installed.pluginId) {
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
