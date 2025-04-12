import { getAppConfigValue } from "./host-functions/get-app-config-value";
import { getUserConfigValue } from "./host-functions/get-user-config-value";
import { httpCall } from "./host-functions/http-call";
import type { HostFunction, HostFunctionFactory } from "./types";

const createHostFunctionFactory = <TContext extends Record<string, unknown>>(
	hostFunction: HostFunction<TContext>,
): HostFunctionFactory => {
	return (context) =>
		(...args) =>
			hostFunction(context as TContext, ...args);
};

export const hostFunctionRegistry = {
	httpCall: createHostFunctionFactory(httpCall),
	getAppConfigValue: createHostFunctionFactory(getAppConfigValue),
	getUserConfigValue: createHostFunctionFactory(getUserConfigValue),
} satisfies Record<string, HostFunctionFactory>;
