import type {
	CoreSandboxHostCapability,
	DomainSandboxHostCapability,
	FilesystemGrantSandboxCapability,
	SandboxHostCapability,
} from "@ryot-app/contract/modules/scripts/wire";
import { Entitlements } from "@ryot-app/contract/schema/entitlement";
import type { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, type JsonValue, jsonValueSchema, type SandboxHostError } from "../wire";
import { verifyManagedAssetsArgsSchema, verifyManagedAssetsResultSchema } from "./assets";
import { getEntitlementsArgsSchema, getEntitlementsResultSchema } from "./entitlements";
import { httpCallArgsSchema, httpCallResponseSchema, httpCallResultSchema } from "./http";
import {
	getCurrentIntegrationArgsSchema,
	getCurrentIntegrationResultSchema,
	getOAuthAccessTokenArgsSchema,
	getOAuthAccessTokenResultSchema,
	integrationRecordSchema,
	invalidateOAuthAccessTokenArgsSchema,
	invalidateOAuthAccessTokenResultSchema,
	listIntegrationsArgsSchema,
	listIntegrationsDataSchema,
	listIntegrationsResultSchema,
	oauthAccessTokenSchema,
} from "./integrations";
import { logArgsSchema, logResultSchema, spanArgsSchema, spanResultSchema } from "./logging";
import {
	executeRyotqlArgsSchema,
	executeRyotqlDataSchema,
	executeRyotqlResultSchema,
} from "./ryotql";
import {
	cacheClaimSchema,
	claimPersistentValueArgsSchema,
	claimPersistentValueResultSchema,
	configValuesSchema,
	getCachedValueArgsSchema,
	getCachedValueDataSchema,
	getCachedValueResultSchema,
	getPluginConfigArgsSchema,
	getPluginConfigResultSchema,
	getUserPreferencesArgsSchema,
	getUserPreferencesResultSchema,
	getUserSettingsArgsSchema,
	getUserSettingsResultSchema,
	setCachedValueArgsSchema,
	setCachedValueDataSchema,
	setCachedValueResultSchema,
	userPreferencesSchema,
} from "./state";

type GetPluginConfigArgs = Schema.Schema.Type<typeof getPluginConfigArgsSchema>[0];
type GetConfig = <const Keys extends GetPluginConfigArgs>(
	keys: Keys,
) => Effect.Effect<GetPluginConfigResult<Keys>, SandboxHostError>;
type GetPluginConfigResult<Keys extends GetPluginConfigArgs> = Readonly<
	Record<NonNullable<Keys["required"]>[number], JsonValue> &
		Partial<Record<NonNullable<Keys["optional"]>[number], JsonValue>>
>;
export const coreSandboxHostContracts = {
	log: { args: logArgsSchema, success: Schema.Null, result: logResultSchema },
	span: { success: Schema.Null, args: spanArgsSchema, result: spanResultSchema },
	httpCall: {
		args: httpCallArgsSchema,
		result: httpCallResultSchema,
		success: httpCallResponseSchema,
	},
	getEntitlements: {
		success: Entitlements,
		args: getEntitlementsArgsSchema,
		result: getEntitlementsResultSchema,
	},
	getPluginConfig: {
		success: configValuesSchema,
		args: getPluginConfigArgsSchema,
		result: getPluginConfigResultSchema,
	},
	getUserSettings: {
		success: configValuesSchema,
		args: getUserSettingsArgsSchema,
		result: getUserSettingsResultSchema,
	},
	getCachedValue: {
		args: getCachedValueArgsSchema,
		success: getCachedValueDataSchema,
		result: getCachedValueResultSchema,
	},
	setCachedValue: {
		args: setCachedValueArgsSchema,
		success: setCachedValueDataSchema,
		result: setCachedValueResultSchema,
	},
	verifyManagedAssets: {
		success: Schema.Null,
		args: verifyManagedAssetsArgsSchema,
		result: verifyManagedAssetsResultSchema,
	},
	getPersistentValue: {
		args: getCachedValueArgsSchema,
		success: getCachedValueDataSchema,
		result: getCachedValueResultSchema,
	},
	getUserPreferences: {
		success: userPreferencesSchema,
		args: getUserPreferencesArgsSchema,
		result: getUserPreferencesResultSchema,
	},
	claimPersistentValue: {
		success: cacheClaimSchema,
		args: claimPersistentValueArgsSchema,
		result: claimPersistentValueResultSchema,
	},
} as const;
export type CoreSandboxHostMethodMap = SandboxHostMethodMapFromContracts<
	typeof coreSandboxHostContracts
>;
export type CoreSandboxHostImplementationMap<Context> = {
	readonly [Capability in CoreSandboxHostCapability]: (
		context: Context,
		...args: Parameters<CoreSandboxHostMethodMap[Capability]>
	) => ReturnType<CoreSandboxHostMethodMap[Capability]>;
};
type SandboxHostContract = {
	readonly args: Schema.Constraint;
	readonly success: Schema.Constraint;
};
type SandboxHostMethodMapFromContracts<Contracts extends Record<string, SandboxHostContract>> = {
	readonly [Capability in keyof Contracts]: (
		...args: Contracts[Capability]["args"]["Type"] extends readonly unknown[]
			? Contracts[Capability]["args"]["Type"]
			: never
	) => Effect.Effect<Contracts[Capability]["success"]["Type"], SandboxHostError>;
};
export const domainSandboxHostContracts = {
	executeRyotql: {
		args: executeRyotqlArgsSchema,
		success: executeRyotqlDataSchema,
		result: executeRyotqlResultSchema,
	},
	listIntegrations: {
		args: listIntegrationsArgsSchema,
		success: listIntegrationsDataSchema,
		result: listIntegrationsResultSchema,
	},
	getOAuthAccessToken: {
		success: oauthAccessTokenSchema,
		args: getOAuthAccessTokenArgsSchema,
		result: getOAuthAccessTokenResultSchema,
	},
	getCurrentIntegration: {
		success: integrationRecordSchema,
		args: getCurrentIntegrationArgsSchema,
		result: getCurrentIntegrationResultSchema,
	},
	invalidateOAuthAccessToken: {
		success: Schema.Null,
		args: invalidateOAuthAccessTokenArgsSchema,
		result: invalidateOAuthAccessTokenResultSchema,
	},
	invokeCapability: {
		success: jsonValueSchema,
		result: hostResultSchema(jsonValueSchema),
		args: Schema.Tuple([Schema.Struct({ id: Schema.String, input: jsonValueSchema })]),
	},
} as const;
export type DomainSandboxHostMethodMap = SandboxHostMethodMapFromContracts<
	typeof domainSandboxHostContracts
>;
export type DomainSandboxHostImplementationMap<Context> = {
	readonly [Capability in DomainSandboxHostCapability]: (
		context: Context,
		...args: Parameters<DomainSandboxHostMethodMap[Capability]>
	) => ReturnType<DomainSandboxHostMethodMap[Capability]>;
};
export const sandboxHostContracts = {
	...coreSandboxHostContracts,
	...domainSandboxHostContracts,
} as const satisfies Record<
	Exclude<SandboxHostCapability, FilesystemGrantSandboxCapability>,
	SandboxHostContract
>;
export type SandboxHostImplementationMap<Context> = CoreSandboxHostImplementationMap<Context> &
	DomainSandboxHostImplementationMap<Context>;
export type SandboxHostMethodMap = DomainSandboxHostMethodMap & {
	readonly getPluginConfig: GetConfig;
} & Omit<CoreSandboxHostMethodMap, "getPluginConfig">;
