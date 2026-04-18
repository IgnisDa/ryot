import { appApiCall } from "./host-functions/app-api-call";
import { getAppConfigValue } from "./host-functions/get-app-config-value";
import { getCachedValue } from "./host-functions/get-cached-value";
import { getUserPreferences } from "./host-functions/get-user-preferences";
import { httpCall } from "./host-functions/http-call";
import { setCachedValue } from "./host-functions/set-cached-value";
import type {
	ApiFunctionDescriptor,
	HostFunction,
	HostFunctionFactory,
} from "./types";

const createHostFunctionFactory = <TContext extends Record<string, unknown>>(
	hostFunction: HostFunction<TContext>,
): HostFunctionFactory => {
	return (context) =>
		(...args) =>
			hostFunction(context as TContext, ...args);
};

export const hostFunctionRegistry = {
	httpCall: createHostFunctionFactory(httpCall),
	appApiCall: createHostFunctionFactory(appApiCall),
	getCachedValue: createHostFunctionFactory(getCachedValue),
	setCachedValue: createHostFunctionFactory(setCachedValue),
	getAppConfigValue: createHostFunctionFactory(getAppConfigValue),
	getUserPreferences: createHostFunctionFactory(getUserPreferences),
} satisfies Record<string, HostFunctionFactory>;

const buildFunctionContext = (
	functionKey: string,
	userId: string,
	scriptId: string,
): Record<string, unknown> => {
	if (functionKey === "getCachedValue" || functionKey === "setCachedValue") {
		return { scriptId };
	}
	if (functionKey === "appApiCall" || functionKey === "getUserPreferences") {
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
