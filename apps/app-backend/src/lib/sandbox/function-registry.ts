import { getAppConfigValue } from "./host-functions/get-app-config-value";
import { getEntitySchemas } from "./host-functions/get-entity-schemas";
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
	getEntitySchemas: createHostFunctionFactory(getEntitySchemas),
	getAppConfigValue: createHostFunctionFactory(getAppConfigValue),
} satisfies Record<string, HostFunctionFactory>;
