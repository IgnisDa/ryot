import { randomUUID } from "node:crypto";

import type { ProviderInformation } from "@ryot/contract/modules/sandbox/schemas";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import { getBackendClient } from "./contract-client";

export type InstalledTestPlugin = {
	active: boolean;
	files: Record<string, string>;
	manifest: ReturnType<typeof testPluginManifest>;
	pluginSlug: string;
	slug: string;
	scriptId: string;
};

const installedByScriptId = new Map<string, InstalledTestPlugin>();
const definitionManifests = new Map<string, ReturnType<typeof testPluginManifest>>();

type TestPluginScriptBase = {
	name: string;
	slug: string;
	capabilities: ReadonlyArray<string>;
	requiredAppConfigKeys: ReadonlyArray<string>;
};

export type TestPluginScript =
	| (TestPluginScriptBase & { kind: "automation" })
	| (TestPluginScriptBase & { kind: "provider"; providerInformation: ProviderInformation });

export const testPluginManifest = (input: {
	pluginSlug: string;
	scripts?: ReadonlyArray<TestPluginScript & { entry: string }>;
	entitySchemas?: ReadonlyArray<{
		icon: string;
		name: string;
		slug: string;
		accentColor: string;
		propertiesSchema: AppSchema;
		eventSchemas: ReadonlyArray<{ name: string; slug: string; propertiesSchema: AppSchema }>;
	}>;
	relationshipSchemas?: ReadonlyArray<{
		name: string;
		slug: string;
		propertiesSchema: AppSchema;
		sourceEntitySchemaSlug: string | null;
		targetEntitySchemaSlug: string | null;
	}>;
	linkToEntitySchemaSlug?: string;
}) => ({
	metadata: {
		icon: "flask-conical",
		name: "E2E Test Plugin",
		slug: input.pluginSlug,
		version: "1.0.0",
		accentColor: "#64748b",
		description: "Generic plugin fixture for end-to-end tests",
	},
	scripts: input.scripts ?? [],
	savedViews: [],
	entitySchemas: input.entitySchemas ?? [],
	signalSchemas: [],
	relationshipSchemas: input.relationshipSchemas ?? [],
	bindings: {
		eventAutomations: [],
		entityAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		schemaScriptLinks: input.linkToEntitySchemaSlug
			? [
					{
						scriptSlug: input.scripts?.[0]?.slug ?? "",
						entitySchemaSlug: input.linkToEntitySchemaSlug,
					},
				]
			: [],
	},
});

const findInstalledScriptId = (scriptSlug: string, source: string) =>
	Effect.gen(function* () {
		const scripts = yield* getBackendClient().call(
			(c) => c.testSupport.listSandboxScripts({ urlParams: {} }),
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
	script: TestPluginScript;
	pluginSlug?: string;
	entitySchemas?: Parameters<typeof testPluginManifest>[0]["entitySchemas"];
	linkToEntitySchemaSlug?: string;
}) =>
	Effect.gen(function* () {
		const entry = `scripts/${input.script.kind}.sandbox.ts`;
		const pluginSlug = input.pluginSlug ?? `e2e-plugin-${randomUUID()}`;
		const manifest = testPluginManifest({
			pluginSlug,
			scripts: [{ ...input.script, entry }],
			...(input.entitySchemas ? { entitySchemas: input.entitySchemas } : {}),
			...(input.linkToEntitySchemaSlug
				? { linkToEntitySchemaSlug: input.linkToEntitySchemaSlug }
				: {}),
		});
		const files = { [entry]: input.source };
		yield* getBackendClient().call(
			(c) => c.plugins.install({ payload: { files, manifest } }),
			adminHeaders,
		);
		const scriptId = yield* findInstalledScriptId(input.script.slug, input.source);
		const installed = {
			active: true,
			files,
			manifest,
			pluginSlug,
			slug: input.script.slug,
			scriptId,
		};
		installedByScriptId.set(scriptId, installed);
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
		const installed = installedByScriptId.get(targetScriptId);
		if (!installed) {
			throw new Error(`Installed test plugin for script '${targetScriptId}' was not found`);
		}
		const entry = installed.manifest.scripts[0]?.entry;
		if (!entry) {
			throw new Error(`Installed test plugin '${installed.pluginSlug}' has no script entry`);
		}
		const files = { [entry]: source };
		const manifest = { ...installed.manifest, scripts: [{ ...script, entry }] };
		yield* getBackendClient().call(
			(c) => c.plugins.install({ payload: { files, manifest } }),
			adminHeaders,
		);
		const scriptId = yield* findInstalledScriptId(script.slug, source);
		installedByScriptId.delete(targetScriptId);
		installed.files = files;
		installed.slug = script.slug;
		installed.manifest = manifest;
		installed.scriptId = scriptId;
		installedByScriptId.set(scriptId, installed);
		return installed;
	});

export const uninstallTestPluginStrict = (installed: InstalledTestPlugin) =>
	Effect.gen(function* () {
		if (!installed.active) {
			return;
		}
		yield* getBackendClient().call(
			(c) => c.plugins.uninstall({ path: { pluginSlug: installed.pluginSlug } }),
			adminHeaders,
		);
		installed.active = false;
		installedByScriptId.delete(installed.scriptId);
	});

export const uninstallTestPlugin = (installed: InstalledTestPlugin) =>
	uninstallTestPluginStrict(installed).pipe(
		Effect.catchAll((error) =>
			Effect.logError(
				`[test-plugin] cleanup failed for '${installed.pluginSlug}' (non-fatal)`,
				error,
			),
		),
	);
