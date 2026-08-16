import { randomUUID } from "node:crypto";

import type { ContractPayload } from "@ryot/contract/client";
import { PluginSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import type { Client } from "./auth";
import { pluginConfigOperationSandboxSource } from "./sandbox-source";
import { testPluginManifest } from "./test-plugin";

type InstallPluginPayload = ContractPayload<"plugins", "install">;
type UpdatePluginPayload = ContractPayload<"plugins", "update">;
type PrivatePluginManifest = InstallPluginPayload["manifest"];

export type PrivatePluginPackage = {
	readonly operationSlug: string;
	readonly pluginSlug: PluginSlug;
	readonly manifest: PrivatePluginManifest;
	readonly files: InstallPluginPayload["files"];
};

type PrivatePluginPackageInput = {
	readonly transform?: string;
	readonly configKey?: string;
	readonly pluginSlug?: string;
	readonly operationSlug?: string;
	readonly configSchema?: PrivatePluginManifest["configSchema"];
};

export const PRIVATE_PLUGIN_CONFIG_KEY = "greeting";

export const PRIVATE_PLUGIN_SECRET_KEY = "apiToken";

export const privatePluginConfigSchema: PrivatePluginManifest["configSchema"] = {
	unknownKeys: "strict",
	fields: {
		[PRIVATE_PLUGIN_CONFIG_KEY]: {
			type: "string",
			label: "Greeting",
			validation: { required: true },
			description: "Value returned by the private plugin operation",
		},
		[PRIVATE_PLUGIN_SECRET_KEY]: {
			secret: true,
			type: "string",
			label: "API token",
			description: "Secret value that must never leave the backend",
		},
	},
};

export const privatePluginPackage = (
	input: PrivatePluginPackageInput = {},
): PrivatePluginPackage => {
	const name = "E2E Private Operation";
	const entry = "scripts/operation.sandbox.ts";
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
		configSchema: input.configSchema ?? privatePluginConfigSchema,
		operations: [
			{
				scriptSlug,
				auth: "user",
				slug: operationSlug,
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
		files: { [entry]: source },
		pluginSlug: PluginSlug.make(pluginSlug),
	};
};

export const installPrivatePlugin = (
	input: PrivatePluginPackageInput & {
		readonly client: Client;
		readonly config: InstallPluginPayload["config"];
	},
) =>
	Effect.gen(function* () {
		const plugin = privatePluginPackage(input);
		const installation = yield* input.client.call((c) =>
			c.plugins.install({
				payload: { config: input.config, files: plugin.files, manifest: plugin.manifest },
			}),
		);
		return { ...plugin, installation };
	});

export const invokePrivatePluginOperation = (input: {
	readonly prefix: string;
	readonly client: Client;
	readonly operationSlug: string;
	readonly pluginSlug: PluginSlug;
}) =>
	input.client.call((c) =>
		c.plugins.invoke({
			payload: { payload: { prefix: input.prefix } },
			params: { pluginSlug: input.pluginSlug, operationSlug: input.operationSlug },
		}),
	);

export const updatePrivatePlugin = (input: {
	readonly client: Client;
	readonly pluginSlug: PluginSlug;
	readonly payload: UpdatePluginPayload;
}) =>
	input.client.call((c) =>
		c.plugins.update({ payload: input.payload, params: { pluginSlug: input.pluginSlug } }),
	);
