import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import type { EntitySchemaReference } from "@ryot-app/contract/modules/plugins/references";
import type { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import {
	PluginConfigRevisionId,
	PluginId,
	PluginPackageId,
	PluginRevisionId,
} from "@ryot-app/contract/schema/brands";
import type { PluginArchivePackage } from "@ryot-app/plugin-archive";
import { PluginClientArtifactFromBase64 } from "@ryot-app/plugin-client-contract";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	join,
	literal,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/ryotql";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Result, Schema } from "effect";

import { requirePresent } from "~/support/assertions";
import { getSharedHarnessTarget, type HarnessTarget } from "~/support/harness-target";

import { listAdminSandboxScripts } from "./admin-sandbox-scripts";
import { listAdminSystemPlugins } from "./admin-system-plugins";
import type { Client } from "./auth";
import { compilePluginPackage, type PluginPackageInput } from "./compiled-package";
import { getApiClient } from "./contract-client";
import { listInstalledPlugins } from "./plugins";
import { pollUntil } from "./polling";
import { executeAdminRyotQLRecipe } from "./ryotql";
import { authoredEntityBrowserSettings, rowsDataSources } from "./saved-views";
import { uploadPrivatePluginPackage } from "./temporary-archive";

type TestPluginManifest = ContractPayload<"testSupport", "installSystemPlugin">["manifest"];
type PluginScript = TestPluginManifest["scripts"][number];
type GeneratedDependencyFields =
	| "runtimeImports"
	| "optionalPluginConfigKeys"
	| "executableDependencies"
	| "oauthConnectionFields";
type FixtureScript = PluginScript extends infer Script
	? Script extends PluginScript
		? Omit<Script, GeneratedDependencyFields> & Partial<Pick<Script, GeneratedDependencyFields>>
		: never
	: never;
type PluginProvider = TestPluginManifest["providers"][number];
type InstallPluginPayload = ContractPayload<"plugins", "install">;
type PluginOperationResult = ContractSuccess<"testSupport", "installSystemPlugin">;

export type TestPluginScript = PluginScript extends infer Script
	? Script extends PluginScript
		? Omit<Script, "entry" | GeneratedDependencyFields> &
				Partial<Pick<Script, GeneratedDependencyFields>>
		: never
	: never;

type TestPluginManifestInput = Partial<
	Pick<
		TestPluginManifest,
		| "crons"
		| "hooks"
		| "savedViews"
		| "workflows"
		| "operations"
		| "configSchema"
		| "importSources"
		| "entitySchemas"
		| "userBootstrap"
		| "httpRateLimits"
		| "relationshipSchemas"
		| "integrationProviders"
		| "signalSchemas"
	>
> & {
	scripts?: ReadonlyArray<FixtureScript>;
	providers?: ReadonlyArray<PluginProvider>;
	clientDefinition?: TestPluginManifest["client"];
	pluginSlug: string;
	packageId?: TestPluginManifest["metadata"]["packageId"];
};

type TestPluginOwner =
	| { client?: undefined; scope: "system"; target?: HarnessTarget }
	| { client: Client; scope?: "user" };

export type InstalledTestPlugin = {
	target: HarnessTarget;
	slug: string;
	client?: Client;
	active: boolean;
	pluginId: PluginId;
	activationId: string;
	pluginSlug: string;
	scope: "system" | "user";
	contentHash: string;
	scriptId: SandboxScriptId;
	installationId: string | null;
	configRevisionId: PluginConfigRevisionId | null;
	activePluginRevisionId: PluginRevisionId;
	manifest: TestPluginManifest;
	files: PluginPackageInput["files"];
	scriptIds: Record<string, SandboxScriptId>;
};

type InstalledScriptRegistration = { targetSlug: string; installed: InstalledTestPlugin };
type TestDefinitionRegistration = {
	client: Client;
	installationId: string;
	manifest: TestPluginManifest;
	pluginId: PluginId;
	pluginSlug: string;
	contentHash: string;
};

const encoder = new TextEncoder();
const installedByScriptId = new Map<string, InstalledScriptRegistration>();
const definitionManifests = new Map<string, TestDefinitionRegistration>();

export const testPluginPackageId = () => PluginPackageId.make(`test/${crypto.randomUUID()}`);

export const encodePluginSourceFiles = (files: Readonly<Record<string, string>>) =>
	Object.fromEntries(
		Object.entries(files).map(([path, contents]) => [path, encoder.encode(contents)]),
	);

export const installTestSupportSystemPlugin = (
	input: (PluginPackageInput | PluginArchivePackage) & { target?: HarnessTarget },
) =>
	Effect.gen(function* () {
		const pluginPackage = "files" in input ? yield* compilePluginPackage(input) : input;
		return yield* getApiClient(input.target).adminCall((c) =>
			c.testSupport.installSystemPlugin({
				payload: {
					manifest: pluginPackage.manifest,
					compiledScripts: pluginPackage.compiledScripts,
					...(pluginPackage.compiledClient === undefined
						? {}
						: {
								compiledClient: Schema.encodeUnknownSync(PluginClientArtifactFromBase64)(
									pluginPackage.compiledClient,
								),
							}),
				},
			}),
		);
	});

export const updateTestSupportSystemPlugin = (
	input: (PluginPackageInput | PluginArchivePackage) & {
		readonly pluginId: PluginId;
		readonly contentHash: string;
		readonly target?: HarnessTarget;
	},
) =>
	Effect.gen(function* () {
		const pluginPackage = "files" in input ? yield* compilePluginPackage(input) : input;
		return yield* getApiClient(input.target).adminCall((contract) =>
			contract.testSupport.updateSystemPlugin({
				params: { pluginId: input.pluginId },
				payload: {
					contentHash: input.contentHash,
					manifest: pluginPackage.manifest,
					compiledScripts: pluginPackage.compiledScripts,
					...(pluginPackage.compiledClient === undefined
						? {}
						: {
								compiledClient: Schema.encodeUnknownSync(PluginClientArtifactFromBase64)(
									pluginPackage.compiledClient,
								),
							}),
				},
			}),
		);
	});

export const findTestEntitySchema = (client: Client, reference: EntitySchemaReference) => {
	for (const registration of definitionManifests.values()) {
		if (
			reference.owner.kind !== "plugin" ||
			registration.pluginId !== reference.owner.pluginId ||
			registration.client.baseUrl !== client.baseUrl ||
			registration.client.userId !== client.userId
		) {
			continue;
		}
		const schema = registration.manifest.entitySchemas.find(
			(candidate) => candidate.slug === reference.slug,
		);
		if (schema) {
			return { schema, pluginSlug: registration.pluginSlug };
		}
	}
	return undefined;
};

export const testPluginManifest = (input: TestPluginManifestInput): TestPluginManifest => ({
	crons: input.crons ?? [],
	hooks: input.hooks ?? [],
	workflows: input.workflows ?? [],
	savedViews: input.savedViews ?? [],
	operations: input.operations ?? [],
	providers: [...(input.providers ?? [])],
	signalSchemas: input.signalSchemas ?? [],
	userBootstrap: input.userBootstrap ?? [],
	importSources: input.importSources ?? [],
	entitySchemas: input.entitySchemas ?? [],
	httpRateLimits: input.httpRateLimits ?? [],
	relationshipSchemas: input.relationshipSchemas ?? [],
	integrationProviders: input.integrationProviders ?? [],
	scripts: (input.scripts ?? []).map((script) =>
		Object.assign(
			{
				runtimeImports: [],
				oauthConnectionFields: [],
				executableDependencies: [],
				optionalPluginConfigKeys: [],
			},
			script,
		),
	),
	...(input.clientDefinition ? { client: input.clientDefinition } : {}),
	configSchema: input.configSchema ?? { fields: {}, unknownKeys: "strict" as const },
	metadata: {
		version: "1.0.0",
		icon: "flask-conical",
		name: "E2E Test Plugin",
		packageId: input.packageId ?? testPluginPackageId(),
		description: "Generic plugin fixture for end-to-end tests",
	},
});

export const testPluginEntitySchema = (input: {
	readonly slug: string;
	readonly name?: string;
	readonly propertiesSchema?: TestPluginManifest["entitySchemas"][number]["propertiesSchema"];
}): TestPluginManifest["entitySchemas"][number] => ({
	icon: "box",
	slug: input.slug,
	eventSchemas: [],
	name: input.name ?? "E2E Entity",
	propertiesSchema: input.propertiesSchema ?? {
		fields: { description: { type: "string", label: "Description", description: "Description" } },
	},
});

export const testPluginSavedView = (input: {
	readonly slug: string;
	readonly name?: string;
}): TestPluginManifest["savedViews"][number] => ({
	icon: "star",
	sortOrder: 0,
	slug: input.slug,
	dataSources: rowsDataSources,
	name: input.name ?? "E2E Plugin View",
	settings: authoredEntityBrowserSettings,
	renderer: { kind: "kernel", name: "entity-browser" },
});

const operationScriptIds = (result: PluginOperationResult) =>
	Object.fromEntries(result.scripts.map(({ id, slug }) => [slug, id]));

const installedSourceHash = (
	scope: "system" | "user",
	pluginId: PluginId,
	installationId: string | null,
	client?: Client,
	target?: HarnessTarget,
) =>
	Effect.gen(function* () {
		if (scope === "system") {
			const plugins = yield* listAdminSystemPlugins(target);
			const plugin = requirePresent(
				plugins.find(({ id }) => id === pluginId),
				`System plugin '${pluginId}' was not found after installation`,
			);
			return requirePresent(plugin.contentHash, `System plugin '${pluginId}' has no source hash`);
		}
		const owner = requirePresent(client, "User test plugin has no client");
		const plugins = yield* listInstalledPlugins(owner, { includeHidden: true });
		const plugin = requirePresent(
			plugins.find(
				({ pluginId: installedPluginId, installationId: installedInstallationId }) =>
					installedPluginId === pluginId && installedInstallationId === installationId,
			),
			`Private plugin installation '${installationId}' was not found after installation`,
		);
		return plugin.contentHash;
	});

const privateInstallationTable = table("pluginInstallation", "installation");
const privatePluginTable = table("plugin", "plugin");

const privatePluginOperationRecipe = defineRecipe((installationId: string) => ({
	map: ({ operation }) => Result.succeed(operation),
	queries: {
		operation: selectedOptionalRow(privateInstallationTable, {
			orderBy: [ascending(column(privateInstallationTable, "id"))],
			where: eq(column(privateInstallationTable, "id"), literal(installationId)),
			joins: [
				join(
					"inner",
					privatePluginTable,
					eq(column(privatePluginTable, "id"), column(privateInstallationTable, "pluginId")),
				),
			],
			selection: {
				pluginId: selectedField(column(privatePluginTable, "id"), PluginId),
				installationId: selectedField(column(privateInstallationTable, "id"), Schema.String),
				activationId: selectedField(column(privatePluginTable, "activationId"), Schema.String),
				activePluginRevisionId: selectedField(
					column(privatePluginTable, "activeRevisionId"),
					PluginRevisionId,
				),
				configRevisionId: selectedField(
					column(privateInstallationTable, "activeConfigRevisionId"),
					Schema.NullOr(PluginConfigRevisionId),
				),
			},
		}),
	},
}));

const privatePluginOperationResult = (installationId: string, target: HarnessTarget) =>
	Effect.gen(function* () {
		const operation = requirePresent(
			yield* executeAdminRyotQLRecipe(privatePluginOperationRecipe(installationId), target),
			`Private plugin installation '${installationId}' was not found`,
		);
		const scripts = yield* listAdminSandboxScripts(operation.activePluginRevisionId, target);
		return { ...operation, scripts: scripts.map(({ id, slug }) => ({ id, slug })) };
	});

export const installTestPlugin = (
	input: {
		source: string;
		pluginSlug?: string;
		packageId?: TestPluginManifest["metadata"]["packageId"];
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
		const target =
			input.scope === "system" ? (input.target ?? getSharedHarnessTarget()) : input.client.target;
		const pluginSlug = input.pluginSlug ?? `e2e-plugin-${crypto.randomUUID()}`;
		const manifest = testPluginManifest({
			pluginSlug,
			packageId: input.packageId,
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
			operationResult = yield* installTestSupportSystemPlugin({ files, target, manifest });
		} else {
			const uploadToken = yield* uploadPrivatePluginPackage(input.client, { files, manifest });
			const installed = yield* input.client.call((c) =>
				c.plugins.install({ payload: { uploadToken, config: input.config ?? {} } }),
			);
			operationResult = yield* privatePluginOperationResult(installed.id, target);
			const installationId = requirePresent(
				operationResult.installationId,
				"Private test plugin installation ID missing",
			);
			yield* pollUntil(
				`private test plugin installation '${installationId}'`,
				listInstalledPlugins(input.client, { includeHidden: true }).pipe(
					Effect.map((installations) => {
						const installation = installations.find(
							({ pluginId, installationId: installedId }) =>
								pluginId === operationResult.pluginId && installedId === installationId,
						);
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
		const contentHash = yield* installedSourceHash(
			input.scope === "system" ? "system" : "user",
			operationResult.pluginId,
			operationResult.installationId,
			input.client,
			target,
		);
		const installed: InstalledTestPlugin = {
			files,
			target,
			manifest,
			scriptId,
			scriptIds,
			pluginSlug,
			contentHash,
			active: true,
			client: input.client,
			slug: input.script.slug,
			pluginId: operationResult.pluginId,
			activationId: operationResult.activationId,
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
		pluginSlug?: string;
		packageId?: TestPluginManifest["metadata"]["packageId"];
		crons?: TestPluginManifest["crons"];
		hooks?: TestPluginManifest["hooks"];
		scripts: ReadonlyArray<FixtureScript>;
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
		signalSchemas?: TestPluginManifest["signalSchemas"];
		integrationProviders?: TestPluginManifest["integrationProviders"];
	} & TestPluginOwner,
) =>
	Effect.gen(function* () {
		const files = encodePluginSourceFiles(input.files);
		const target =
			input.scope === "system" ? (input.target ?? getSharedHarnessTarget()) : input.client.target;
		const pluginSlug = input.pluginSlug ?? `e2e-plugin-${crypto.randomUUID()}`;
		const manifest = testPluginManifest({
			pluginSlug,
			crons: input.crons,
			hooks: input.hooks,
			scripts: input.scripts,
			packageId: input.packageId,
			workflows: input.workflows,
			savedViews: input.savedViews,
			providers: input.providers ?? [],
			configSchema: input.configSchema,
			operations: input.operations ?? [],
			importSources: input.importSources,
			entitySchemas: input.entitySchemas,
			signalSchemas: input.signalSchemas,
			httpRateLimits: input.httpRateLimits,
			clientDefinition: input.clientDefinition,
			relationshipSchemas: input.relationshipSchemas,
			integrationProviders: input.integrationProviders,
		});
		let operationResult: PluginOperationResult;
		if (input.scope === "system") {
			operationResult = yield* installTestSupportSystemPlugin({ files, target, manifest });
		} else {
			const uploadToken = yield* uploadPrivatePluginPackage(input.client, { files, manifest });
			const installed = yield* input.client.call((c) =>
				c.plugins.install({ payload: { uploadToken, config: input.config ?? {} } }),
			);
			operationResult = yield* privatePluginOperationResult(installed.id, target);
			const installationId = requirePresent(
				operationResult.installationId,
				"Private test plugin installation ID missing",
			);
			yield* pollUntil(
				`private test plugin installation '${installationId}'`,
				listInstalledPlugins(input.client, { includeHidden: true }).pipe(
					Effect.map((installations) => {
						const installation = installations.find(
							({ pluginId, installationId: installedId }) =>
								pluginId === operationResult.pluginId && installedId === installationId,
						);
						return installation?.health === "ready" ? installation : null;
					}),
				),
			);
		}
		const scriptIds = operationScriptIds(operationResult);
		const details = manifest.scripts.find(
			(script) =>
				script.kind === "provider" &&
				script.providerOperation === "details" &&
				script.providerSlug === input.providers?.[0]?.slug,
		);
		const scriptId = scriptIds[details?.slug ?? ""] ?? scriptIds[input.scripts[0]?.slug ?? ""];
		if (!scriptId) {
			return yield* Effect.die(new Error("Test plugin bundle requires at least one script"));
		}
		const contentHash = yield* installedSourceHash(
			input.scope === "system" ? "system" : "user",
			operationResult.pluginId,
			operationResult.installationId,
			input.client,
			target,
		);
		const installed: InstalledTestPlugin = {
			files,
			target,
			manifest,
			scriptId,
			scriptIds,
			pluginSlug,
			contentHash,
			active: true,
			client: input.client,
			pluginId: operationResult.pluginId,
			activationId: operationResult.activationId,
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
		const registrationKey = stableStringify([
			input.client.baseUrl,
			requirePresent(input.client.userId, "Private test plugin client has no fixture user ID"),
			input.pluginSlug,
		]);
		const current = definitionManifests.get(registrationKey);
		let installationId = current?.installationId;
		let pluginId = current?.pluginId;
		const manifest = testPluginManifest({
			pluginSlug: input.pluginSlug,
			packageId: current?.manifest.metadata.packageId,
			entitySchemas: mergeBySlug(current?.manifest.entitySchemas ?? [], input.entitySchemas ?? []),
			relationshipSchemas: mergeBySlug(
				current?.manifest.relationshipSchemas ?? [],
				input.relationshipSchemas ?? [],
			),
		});
		if (current) {
			const uploadToken = yield* uploadPrivatePluginPackage(input.client, { manifest, files: {} });
			const updated = yield* input.client.call((c) =>
				c.plugins.update({
					params: { installationId: current.installationId },
					payload: { uploadToken, contentHash: current.contentHash },
				}),
			);
			installationId = updated.id;
			pluginId = updated.pluginId;
		} else {
			const uploadToken = yield* uploadPrivatePluginPackage(input.client, { manifest, files: {} });
			const installed = yield* input.client.call((c) =>
				c.plugins.install({ payload: { config: {}, uploadToken } }),
			);
			installationId = installed.id;
			pluginId = installed.pluginId;
		}
		const exactInstallationId = requirePresent(
			installationId,
			"Definition installation ID missing",
		);
		const exactPluginId = requirePresent(pluginId, "Definition plugin ID missing");
		const settled = yield* pollUntil(
			`private definition plugin installation '${exactInstallationId}'`,
			listInstalledPlugins(input.client, { includeHidden: true }).pipe(
				Effect.map((installations) => {
					const installation = installations.find(
						({ pluginId: installedPluginId, installationId: installedInstallationId }) =>
							installedPluginId === exactPluginId &&
							installedInstallationId === exactInstallationId,
					);
					return installation?.health === "ready" ? installation : null;
				}),
			),
		);
		definitionManifests.set(registrationKey, {
			manifest,
			client: input.client,
			pluginId: exactPluginId,
			pluginSlug: input.pluginSlug,
			contentHash: settled.contentHash,
			installationId: exactInstallationId,
		});
		return { ...manifest, pluginId: exactPluginId };
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
		scripts[targetIndex] = {
			runtimeImports: [],
			oauthConnectionFields: [],
			executableDependencies: [],
			optionalPluginConfigKeys: [],
			...script,
			entry: target.entry,
		};
		const manifest = { ...installed.manifest, scripts };
		let operationResult: PluginOperationResult;
		if (installed.scope === "system") {
			operationResult = yield* updateTestSupportSystemPlugin({
				files,
				manifest,
				target: installed.target,
				pluginId: installed.pluginId,
				contentHash: installed.contentHash,
			});
		} else {
			const client = requirePresent(installed.client, "User test plugin has no client");
			const uploadToken = yield* uploadPrivatePluginPackage(client, { files, manifest });
			const updated = yield* client.call((c) =>
				c.plugins.update({
					payload: { uploadToken, contentHash: installed.contentHash },
					params: {
						installationId: requirePresent(
							installed.installationId,
							"Private installation ID missing",
						),
					},
				}),
			);
			operationResult = yield* privatePluginOperationResult(updated.id, installed.target);
		}
		const nextScriptIds = operationScriptIds(operationResult);
		const scriptId = requirePresent(
			nextScriptIds[script.slug],
			`Updated test plugin script '${script.slug}' was not returned`,
		);
		const updatesPrimaryScript = installed.scriptId === installed.scriptIds[targetSlug];
		const contentHash = yield* installedSourceHash(
			installed.scope,
			operationResult.pluginId,
			operationResult.installationId,
			installed.client,
			installed.target,
		);
		const nextInstalled: InstalledTestPlugin = {
			...installed,
			files,
			manifest,
			contentHash,
			scriptIds: nextScriptIds,
			pluginSlug: installed.pluginSlug,
			pluginId: operationResult.pluginId,
			activationId: operationResult.activationId,
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
			yield* getApiClient(installed.target).adminCall((c) =>
				c.testSupport.uninstallSystemPlugin({
					params: { pluginId: installed.pluginId, activationId: installed.activationId },
				}),
			);
		} else {
			const client = requirePresent(installed.client, "User test plugin has no client");
			yield* client.call((c) =>
				c.plugins.uninstall({
					params: {
						activationId: installed.activationId,
						installationId: requirePresent(
							installed.installationId,
							"Private installation ID missing",
						),
					},
				}),
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
