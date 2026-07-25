import { randomUUID } from "node:crypto";

import type { ContractPayload } from "@ryot-app/contract/client";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import type { PluginArchivePackage } from "@ryot-app/plugin-archive";
import { Effect } from "effect";

import type { Client } from "./auth";
import { pollUntil } from "./polling";
import {
	literalSandboxSource,
	operationSandboxSource,
	pluginConfigOperationSandboxSource,
} from "./sandbox-source";
import { uploadPrivatePluginPackage } from "./temporary-archive";
import { testPluginManifest } from "./test-plugin";

export { uploadPrivatePluginPackage };

type InstallPluginPayload = ContractPayload<"plugins", "install">;
type UpdatePluginPayload = ContractPayload<"plugins", "update">;
type PrivatePluginManifest = PluginManifest;
const encoder = new TextEncoder();

export type PrivatePluginPackage = {
	readonly operationSlug: string;
	readonly pluginSlug: PluginSlug;
	readonly manifest: PrivatePluginManifest;
	readonly files: PluginArchivePackage["files"];
};

type PrivatePluginPackageInput = {
	readonly transform?: string;
	readonly configKey?: string;
	readonly pluginSlug?: string;
	readonly operationSlug?: string;
	readonly savedViews?: PrivatePluginManifest["savedViews"];
	readonly configSchema?: PrivatePluginManifest["configSchema"];
};

export const PRIVATE_PLUGIN_CONFIG_KEY = "greeting";

export const PRIVATE_PLUGIN_SECRET_KEY = "apiToken";

export const privatePluginConfigSchema: PrivatePluginManifest["configSchema"] = {
	unknownKeys: "strict",
	fields: {
		[PRIVATE_PLUGIN_SECRET_KEY]: {
			secret: true,
			type: "string",
			label: "API token",
			description: "Secret value that must never leave the api",
		},
		[PRIVATE_PLUGIN_CONFIG_KEY]: {
			type: "string",
			label: "Greeting",
			validation: { required: true },
			description: "Value returned by the private plugin operation",
		},
	},
};

export const privatePluginPackage = (
	input: PrivatePluginPackageInput = {},
): PrivatePluginPackage => {
	const name = "E2E Private Operation";
	const entry = "backend/scripts/operation.sandbox.ts";
	const scriptSlug = `e2e-private-operation-${randomUUID()}`;
	const operationSlug = input.operationSlug ?? "read-config";
	const configKey = input.configKey ?? PRIVATE_PLUGIN_CONFIG_KEY;
	const pluginSlug = input.pluginSlug ?? `e2e-private-plugin-${randomUUID()}`;
	const source = pluginConfigOperationSandboxSource({
		name,
		configKey,
		slug: scriptSlug,
		transform: input.transform,
	});
	const manifest = testPluginManifest({
		pluginSlug,
		savedViews: input.savedViews,
		configSchema: input.configSchema ?? privatePluginConfigSchema,
		operations: [
			{
				scriptSlug,
				auth: "user",
				slug: operationSlug,
				demoAccess: "allowed",
				description: "Returns a value derived from the caller's own plugin config",
			},
		],
		scripts: [
			{
				name,
				entry,
				slug: scriptSlug,
				kind: "operation",
				requiredSystemConfigKeys: [],
				capabilities: ["getPluginConfig"],
				requiredPluginConfigKeys: [configKey],
			},
		],
	});
	return {
		manifest,
		operationSlug,
		pluginSlug: PluginSlug.make(pluginSlug),
		files: { [entry]: encoder.encode(source) },
	};
};

export const settledPrivateInstallation = (client: Client, pluginSlug: PluginSlug) =>
	pollUntil(
		`installation of private plugin '${pluginSlug}'`,
		client
			.call((c) => c.plugins.list())
			.pipe(
				Effect.map((installations) => {
					const installed = installations.find((entry) => entry.slug === pluginSlug);
					return installed && installed.health !== "installing" ? installed : null;
				}),
			),
	);

export const installPrivatePluginPackage = (input: {
	readonly client: Client;
	readonly baseUrl?: string;
	readonly pluginPackage: PluginArchivePackage;
	readonly config: InstallPluginPayload["config"];
}) =>
	Effect.gen(function* () {
		const uploadToken = yield* uploadPrivatePluginPackage(
			input.client,
			input.pluginPackage,
			input.baseUrl,
		);
		return yield* input.client.call((c) =>
			c.plugins.install({ payload: { uploadToken, config: input.config } }),
		);
	});

export const installPrivatePlugin = (
	input: PrivatePluginPackageInput & {
		readonly client: Client;
		readonly baseUrl?: string;
		readonly config: InstallPluginPayload["config"];
	},
) =>
	Effect.gen(function* () {
		const plugin = privatePluginPackage(input);
		yield* installPrivatePluginPackage({
			client: input.client,
			config: input.config,
			pluginPackage: plugin,
			baseUrl: input.baseUrl,
		});
		const installation = yield* settledPrivateInstallation(input.client, plugin.pluginSlug);
		return { ...plugin, installation };
	});

export type PrivateBootstrapPluginPackage = {
	readonly bootstrapSlug: string;
	readonly operationSlug: string;
	readonly pluginSlug: PluginSlug;
	readonly manifest: PrivatePluginManifest;
	readonly files: PluginArchivePackage["files"];
};

export const privateBootstrapPluginPackage = (): PrivateBootstrapPluginPackage => {
	const suffix = randomUUID();
	const operationSlug = "read-titles";
	const name = "E2E private bootstrap";
	const bootstrapSlug = "seed-owner-data";
	const bootstrapEntry = "backend/scripts/bootstrap.sandbox.ts";
	const operationEntry = "backend/scripts/operation.sandbox.ts";
	const bootstrapScriptSlug = `e2e-private-bootstrap-${suffix}`;
	const operationScriptSlug = `e2e-private-bootstrap-operation-${suffix}`;
	const pluginSlug = `e2e-private-bootstrap-plugin-${suffix}`;
	const bootstrapSource = literalSandboxSource({ name, value: true, slug: bootstrapScriptSlug });
	const manifest = testPluginManifest({
		pluginSlug,
		userBootstrap: [{ description: name, slug: bootstrapSlug, scriptSlug: bootstrapScriptSlug }],
		operations: [
			{
				auth: "user",
				description: name,
				slug: operationSlug,
				demoAccess: "allowed",
				scriptSlug: operationScriptSlug,
			},
		],
		scripts: [
			{
				name,
				kind: "script",
				capabilities: [],
				entry: bootstrapEntry,
				slug: bootstrapScriptSlug,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			},
			{
				name,
				capabilities: [],
				kind: "operation",
				entry: operationEntry,
				slug: operationScriptSlug,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			},
		],
	});
	return {
		manifest,
		operationSlug,
		bootstrapSlug,
		pluginSlug: PluginSlug.make(pluginSlug),
		files: {
			[bootstrapEntry]: encoder.encode(bootstrapSource),
			[operationEntry]: encoder.encode(operationSandboxSource({ name, slug: operationScriptSlug })),
		},
	};
};

export const invokePrivatePluginOperation = (input: {
	readonly prefix: string;
	readonly client: Client;
	readonly sourceHash?: string;
	readonly operationSlug: string;
	readonly pluginSlug: PluginSlug;
}) =>
	input.client.call((c) =>
		c.plugins.invoke({
			params: { pluginSlug: input.pluginSlug, operationSlug: input.operationSlug },
			payload: {
				payload: { prefix: input.prefix },
				...(input.sourceHash === undefined ? {} : { sourceHash: input.sourceHash }),
			},
		}),
	);

export const updatePrivatePlugin = (input: {
	readonly client: Client;
	readonly baseUrl?: string;
	readonly pluginSlug: PluginSlug;
	readonly payload: Omit<UpdatePluginPayload, "uploadToken"> & PluginArchivePackage;
}) =>
	Effect.gen(function* () {
		const { files, manifest, ...payload } = input.payload;
		const uploadToken = yield* uploadPrivatePluginPackage(
			input.client,
			{ files, manifest },
			input.baseUrl,
		);
		return yield* input.client.call((c) =>
			c.plugins.update({
				payload: { ...payload, uploadToken },
				params: { pluginSlug: input.pluginSlug },
			}),
		);
	});

const privateImportWorkflowSource = (scriptSlug: string) => `
import {
  genericImportKernelInputSchema,
  genericImportWorkflowInputSchema,
  genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { defineManifest, defineWorkflow } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  capabilities: [],
  name: "E2E private import",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  slug: ${JSON.stringify(scriptSlug)},
});

const kernelImport = {
  input: genericImportKernelInputSchema,
  output: genericImportWorkflowResultSchema,
  workflowSlug: "kernel:process-import-chunks",
};

export default defineWorkflow({
  manifest,
  input: genericImportWorkflowInputSchema,
  output: genericImportWorkflowResultSchema,
  run: (input, replay) =>
    replay.child("complete-import", kernelImport, {
      totalItems: 0,
      failureCount: 0,
      chunkHandles: [],
      writeItemCount: 0,
      runId: input.runId,
      command: input.command,
    }),
});
`;

const privateIntegrationOperationSource = (scriptSlug: string) => `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  capabilities: [],
  kind: "operation",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "E2E private integration operation",
  slug: ${JSON.stringify(scriptSlug)},
});

export default defineOperation({
  manifest,
  input: Schema.Struct({ integrationId: Schema.String }),
  output: Schema.Struct({ integrationId: Schema.String }),
  run: (input) => Effect.succeed({ integrationId: input.integrationId }),
});
`;

type PrivateSurfaceInput = { readonly name?: string; readonly pluginSlug?: string };

export type PrivateImportPluginPackage = {
	readonly sourceSlug: string;
	readonly pluginSlug: PluginSlug;
	readonly manifest: PrivatePluginManifest;
	readonly files: PluginArchivePackage["files"];
};

export type PrivateIntegrationPluginPackage = {
	readonly providerSlug: string;
	readonly operationSlug: string;
	readonly pluginSlug: PluginSlug;
	readonly manifest: PrivatePluginManifest;
	readonly files: PluginArchivePackage["files"];
};

export const privateIntegrationSettingsSchema: PrivatePluginManifest["integrationProviders"][number]["settingsSchema"] =
	{
		unknownKeys: "strict",
		fields: {
			endpoint: { type: "string", label: "Endpoint", description: "Private provider endpoint" },
		},
	};

export const privateImportPluginPackage = (
	input: PrivateSurfaceInput & { readonly sourceSlug?: string } = {},
): PrivateImportPluginPackage => {
	const suffix = randomUUID();
	const workflowSlug = `private-import-${suffix}`;
	const entry = "backend/scripts/private-import.sandbox.ts";
	const name = input.name ?? "E2E private import source";
	const scriptSlug = `workflow.e2e-private-import-${suffix}`;
	const sourceSlug = input.sourceSlug ?? `e2e-private-import-${suffix}`;
	const pluginSlug = input.pluginSlug ?? `e2e-private-import-plugin-${suffix}`;
	const manifest = testPluginManifest({
		pluginSlug,
		workflows: [{ scriptSlug, slug: workflowSlug }],
		importSources: [
			{
				name,
				workflowSlug,
				slug: sourceSlug,
				description: name,
				requiredPluginConfigKeys: [],
				inputSchema: { fields: {}, unknownKeys: "strict" },
			},
		],
		scripts: [
			{
				entry,
				slug: scriptSlug,
				kind: "workflow",
				capabilities: [],
				name: "E2E private import",
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			},
		],
	});
	return {
		manifest,
		sourceSlug,
		pluginSlug: PluginSlug.make(pluginSlug),
		files: { [entry]: encoder.encode(privateImportWorkflowSource(scriptSlug)) },
	};
};

export const privateIntegrationPluginPackage = (
	input: PrivateSurfaceInput & { readonly providerSlug?: string } = {},
): PrivateIntegrationPluginPackage => {
	const suffix = randomUUID();
	const operationSlug = "read-integration";
	const entry = "backend/scripts/private-integration.sandbox.ts";
	const name = input.name ?? "E2E private integration provider";
	const scriptSlug = `integration.e2e-private-read-${suffix}`;
	const providerSlug = input.providerSlug ?? `e2e-private-provider-${suffix}`;
	const pluginSlug = input.pluginSlug ?? `e2e-private-integration-plugin-${suffix}`;
	const manifest = testPluginManifest({
		pluginSlug,
		operations: [
			{
				scriptSlug,
				slug: operationSlug,
				auth: "integration",
				description: "Reads the integration that authenticated the call",
			},
		],
		integrationProviders: [
			{
				name,
				lot: "push",
				description: name,
				slug: providerSlug,
				settingsSchema: privateIntegrationSettingsSchema,
			},
		],
		scripts: [
			{
				entry,
				slug: scriptSlug,
				capabilities: [],
				kind: "operation",
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				name: "E2E private integration operation",
			},
		],
	});
	return {
		manifest,
		providerSlug,
		operationSlug,
		pluginSlug: PluginSlug.make(pluginSlug),
		files: { [entry]: encoder.encode(privateIntegrationOperationSource(scriptSlug)) },
	};
};

export const installPrivateImportPlugin = (
	input: PrivateSurfaceInput & { readonly client: Client; readonly sourceSlug?: string },
) =>
	Effect.gen(function* () {
		const plugin = privateImportPluginPackage(input);
		yield* installPrivatePluginPackage({ config: {}, client: input.client, pluginPackage: plugin });
		const installation = yield* settledPrivateInstallation(input.client, plugin.pluginSlug);
		return { ...plugin, installation };
	});

export const installPrivateIntegrationPlugin = (
	input: PrivateSurfaceInput & { readonly client: Client; readonly providerSlug?: string },
) =>
	Effect.gen(function* () {
		const plugin = privateIntegrationPluginPackage(input);
		yield* installPrivatePluginPackage({ config: {}, client: input.client, pluginPackage: plugin });
		const installation = yield* settledPrivateInstallation(input.client, plugin.pluginSlug);
		return { ...plugin, installation };
	});

export const invokePrivateIntegrationOperation = (input: {
	readonly client: Client;
	readonly sourceHash?: string;
	readonly integrationId: string;
	readonly operationSlug: string;
	readonly pluginSlug: PluginSlug;
}) =>
	input.client.call((c) =>
		c.plugins.invoke({
			params: { pluginSlug: input.pluginSlug, operationSlug: input.operationSlug },
			payload: {
				payload: { integrationId: input.integrationId },
				...(input.sourceHash === undefined ? {} : { sourceHash: input.sourceHash }),
			},
		}),
	);

export const uninstallPrivatePlugin = (client: Client, pluginSlug: PluginSlug) =>
	client.call((c) => c.plugins.uninstall({ params: { pluginSlug } }));

export const releasePrivatePlugin = (client: Client, pluginSlug: PluginSlug) =>
	pollUntil(
		`uninstall of private plugin '${pluginSlug}'`,
		uninstallPrivatePlugin(client, pluginSlug).pipe(
			Effect.as(true),
			Effect.catchTag("PluginConflictError", (error) =>
				Effect.succeed(error.reason.code === "workflow-referenced" ? null : true),
			),
		),
	).pipe(Effect.asVoid, Effect.orDie);
