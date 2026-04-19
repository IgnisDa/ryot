import { claimCachedValue } from "./host-functions/claim-cached-value";
import { createEvents } from "./host-functions/create-events";
import { executeQueryEngine } from "./host-functions/execute-query-engine";
import { getAppConfigValue } from "./host-functions/get-app-config-value";
import { getCachedValue } from "./host-functions/get-cached-value";
import { getEntity } from "./host-functions/get-entity";
import { getEntitySchema } from "./host-functions/get-entity-schema";
import { getIntegration } from "./host-functions/get-integration";
import { getSystemConfig } from "./host-functions/get-system-config";
import { getUserPreferences } from "./host-functions/get-user-preferences";
import { httpCall } from "./host-functions/http-call";
import { listEventSchemas } from "./host-functions/list-event-schemas";
import { listEvents } from "./host-functions/list-events";
import { listIntegrations } from "./host-functions/list-integrations";
import { setCachedValue } from "./host-functions/set-cached-value";
import type { ApiFunctionDescriptor, HostFunction, HostFunctionFactory } from "./types";

const scriptScopedFunctionKeys = new Set(["getCachedValue", "setCachedValue", "claimCachedValue"]);

const userScopedFunctionKeys = new Set([
	"getEntity",
	"listEvents",
	"createEvents",
	"getIntegration",
	"getEntitySchema",
	"listEventSchemas",
	"listIntegrations",
	"getUserPreferences",
	"executeQueryEngine",
]);

const createHostFunctionFactory = <TContext extends Record<string, unknown>>(
	hostFunction: HostFunction<TContext>,
): HostFunctionFactory => {
	return (context) =>
		(...args) =>
			// oxlint-disable-next-line no-unsafe-type-assertion
			hostFunction(context as TContext, ...args);
};

export const hostFunctionRegistry = {
	httpCall: createHostFunctionFactory(httpCall),
	getEntity: createHostFunctionFactory(getEntity),
	listEvents: createHostFunctionFactory(listEvents),
	createEvents: createHostFunctionFactory(createEvents),
	getCachedValue: createHostFunctionFactory(getCachedValue),
	getIntegration: createHostFunctionFactory(getIntegration),
	setCachedValue: createHostFunctionFactory(setCachedValue),
	getEntitySchema: createHostFunctionFactory(getEntitySchema),
	getSystemConfig: createHostFunctionFactory(getSystemConfig),
	listEventSchemas: createHostFunctionFactory(listEventSchemas),
	listIntegrations: createHostFunctionFactory(listIntegrations),
	claimCachedValue: createHostFunctionFactory(claimCachedValue),
	getAppConfigValue: createHostFunctionFactory(getAppConfigValue),
	getUserPreferences: createHostFunctionFactory(getUserPreferences),
	executeQueryEngine: createHostFunctionFactory(executeQueryEngine),
} satisfies Record<string, HostFunctionFactory>;

const buildFunctionContext = (
	functionKey: string,
	userId: string,
	scriptId: string,
): Record<string, unknown> => {
	if (scriptScopedFunctionKeys.has(functionKey)) {
		return { scriptId };
	}
	if (userScopedFunctionKeys.has(functionKey)) {
		return { userId };
	}
	return {};
};

export const buildApiFunctionDescriptors = (
	allowedKeys: string[],
	userId: string,
	scriptId: string,
): ApiFunctionDescriptor[] =>
	allowedKeys.map((functionKey) => ({
		functionKey,
		context: buildFunctionContext(functionKey, userId, scriptId),
	}));
