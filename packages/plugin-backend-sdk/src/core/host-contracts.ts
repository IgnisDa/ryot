import type { SandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import type { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, type JsonValue, type SandboxHostError } from "../wire";
import {
	emitSignalArgsSchema,
	emitSignalDataSchema,
	emitSignalResultSchema,
	sendNotificationArgsSchema,
} from "./automation";
import type {
	AutomationSandboxHostCapability,
	CoreSandboxHostCapability,
	DomainSandboxHostCapability,
	FilesystemGrantSandboxCapability,
} from "./capabilities";
import {
	createUserEntityArgsSchema,
	createUserEntityDataSchema,
	createUserEntityResultSchema,
	ensureUserEntitiesArgsSchema,
	ensureUserEntitiesDataSchema,
	ensureUserEntitiesResultSchema,
	entitySchemaRecordSchema,
	getEntitySchemasArgsSchema,
	getEntitySchemasResultSchema,
	upsertGlobalEntitiesArgsSchema,
	upsertGlobalEntitiesDataSchema,
	upsertGlobalEntitiesResultSchema,
	updateUserEntityArgsSchema,
	updateUserEntityDataSchema,
	updateUserEntityResultSchema,
} from "./entities";
import {
	createEventsArgsSchema,
	createEventsResultDataSchema,
	createEventsResultSchema,
	deleteEventsArgsSchema,
	deleteEventsResultDataSchema,
	deleteEventsResultSchema,
	listEventSchemasArgsSchema,
	listEventSchemasDataSchema,
	listEventSchemasResultSchema,
	requestEventStreamWorkArgsSchema,
	requestEventStreamWorkDataSchema,
	requestEventStreamWorkResultSchema,
	updateEventsArgsSchema,
	updateEventsResultDataSchema,
	updateEventsResultSchema,
} from "./events";
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
	changeUserRelationshipsArgsSchema,
	changeUserRelationshipsDataSchema,
	changeUserRelationshipsResultSchema,
	upsertGlobalRelationshipsArgsSchema,
	upsertGlobalRelationshipsDataSchema,
	upsertGlobalRelationshipsResultSchema,
} from "./relationships";
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
type GetPluginConfigResult<Keys extends GetPluginConfigArgs> = Readonly<
	Record<NonNullable<Keys["required"]>[number], JsonValue> &
		Partial<Record<NonNullable<Keys["optional"]>[number], JsonValue>>
>;
type GetConfig = <const Keys extends GetPluginConfigArgs>(
	keys: Keys,
) => Effect.Effect<GetPluginConfigResult<Keys>, SandboxHostError>;
export const coreSandboxHostContracts = {
	log: { args: logArgsSchema, success: Schema.Null, result: logResultSchema },
	span: { success: Schema.Null, args: spanArgsSchema, result: spanResultSchema },
	httpCall: {
		args: httpCallArgsSchema,
		result: httpCallResultSchema,
		success: httpCallResponseSchema,
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
export type CoreSandboxHostMethodMap = SandboxHostMethodMapFromContracts<
	typeof coreSandboxHostContracts
>;
export type CoreSandboxHostImplementationMap<Context> = {
	readonly [Capability in CoreSandboxHostCapability]: (
		context: Context,
		...args: Parameters<CoreSandboxHostMethodMap[Capability]>
	) => ReturnType<CoreSandboxHostMethodMap[Capability]>;
};
export const domainSandboxHostContracts = {
	executeRyotql: {
		args: executeRyotqlArgsSchema,
		success: executeRyotqlDataSchema,
		result: executeRyotqlResultSchema,
	},
	createEvents: {
		args: createEventsArgsSchema,
		result: createEventsResultSchema,
		success: createEventsResultDataSchema,
	},
	updateEvents: {
		args: updateEventsArgsSchema,
		result: updateEventsResultSchema,
		success: updateEventsResultDataSchema,
	},
	deleteEvents: {
		args: deleteEventsArgsSchema,
		result: deleteEventsResultSchema,
		success: deleteEventsResultDataSchema,
	},
	listEventSchemas: {
		args: listEventSchemasArgsSchema,
		success: listEventSchemasDataSchema,
		result: listEventSchemasResultSchema,
	},
	listIntegrations: {
		args: listIntegrationsArgsSchema,
		success: listIntegrationsDataSchema,
		result: listIntegrationsResultSchema,
	},
	createUserEntity: {
		args: createUserEntityArgsSchema,
		success: createUserEntityDataSchema,
		result: createUserEntityResultSchema,
	},
	updateUserEntity: {
		args: updateUserEntityArgsSchema,
		success: updateUserEntityDataSchema,
		result: updateUserEntityResultSchema,
	},
	getOAuthAccessToken: {
		success: oauthAccessTokenSchema,
		args: getOAuthAccessTokenArgsSchema,
		result: getOAuthAccessTokenResultSchema,
	},
	ensureUserEntities: {
		args: ensureUserEntitiesArgsSchema,
		success: ensureUserEntitiesDataSchema,
		result: ensureUserEntitiesResultSchema,
	},
	getCurrentIntegration: {
		success: integrationRecordSchema,
		args: getCurrentIntegrationArgsSchema,
		result: getCurrentIntegrationResultSchema,
	},
	getEntitySchemas: {
		args: getEntitySchemasArgsSchema,
		result: getEntitySchemasResultSchema,
		success: Schema.Array(entitySchemaRecordSchema),
	},
	invalidateOAuthAccessToken: {
		success: Schema.Null,
		args: invalidateOAuthAccessTokenArgsSchema,
		result: invalidateOAuthAccessTokenResultSchema,
	},
	upsertGlobalEntities: {
		args: upsertGlobalEntitiesArgsSchema,
		success: upsertGlobalEntitiesDataSchema,
		result: upsertGlobalEntitiesResultSchema,
	},
	requestEventStreamWork: {
		args: requestEventStreamWorkArgsSchema,
		success: requestEventStreamWorkDataSchema,
		result: requestEventStreamWorkResultSchema,
	},
	changeUserRelationships: {
		args: changeUserRelationshipsArgsSchema,
		success: changeUserRelationshipsDataSchema,
		result: changeUserRelationshipsResultSchema,
	},
	upsertGlobalRelationships: {
		args: upsertGlobalRelationshipsArgsSchema,
		success: upsertGlobalRelationshipsDataSchema,
		result: upsertGlobalRelationshipsResultSchema,
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
export const automationSandboxHostContracts = {
	emitSignal: {
		args: emitSignalArgsSchema,
		success: emitSignalDataSchema,
		result: emitSignalResultSchema,
	},
	sendNotification: {
		success: Schema.Null,
		args: sendNotificationArgsSchema,
		result: hostResultSchema(Schema.Null),
	},
} as const;
export const sandboxHostContracts = {
	...coreSandboxHostContracts,
	...domainSandboxHostContracts,
	...automationSandboxHostContracts,
} as const satisfies Record<
	Exclude<SandboxHostCapability, FilesystemGrantSandboxCapability>,
	SandboxHostContract
>;
export type AutomationSandboxHostMethodMap = SandboxHostMethodMapFromContracts<
	typeof automationSandboxHostContracts
>;
export type AutomationSandboxHostImplementationMap<Context> = {
	readonly [Capability in AutomationSandboxHostCapability]: (
		context: Context,
		...args: Parameters<AutomationSandboxHostMethodMap[Capability]>
	) => ReturnType<AutomationSandboxHostMethodMap[Capability]>;
};
export type SandboxHostMethodMap = Omit<CoreSandboxHostMethodMap, "getPluginConfig"> &
	DomainSandboxHostMethodMap &
	AutomationSandboxHostMethodMap & { readonly getPluginConfig: GetConfig };
export type SandboxHostImplementationMap<Context> = CoreSandboxHostImplementationMap<Context> &
	DomainSandboxHostImplementationMap<Context> &
	AutomationSandboxHostImplementationMap<Context>;
