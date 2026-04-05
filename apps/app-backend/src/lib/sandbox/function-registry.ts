import { executeQuery } from "./host-functions/execute-query";
import { getAppConfigValue } from "./host-functions/get-app-config-value";
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
	executeQuery: createHostFunctionFactory(executeQuery),
	getAppConfigValue: createHostFunctionFactory(getAppConfigValue),
} satisfies Record<string, HostFunctionFactory>;
