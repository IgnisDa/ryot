import type { Schema } from "effect";

import {
	PluginOperationError,
	type PluginOperationBridge,
	type PluginOperationInvocation,
} from "./operations";

let operationBridge: PluginOperationBridge | undefined;

export const bindOperationBridge = (bridge: PluginOperationBridge) => {
	operationBridge = bridge;
};

const invokeOperation = <Output extends Schema.Codec<unknown, unknown>>(
	request: PluginOperationInvocation<Output>,
) => {
	if (!operationBridge) {
		return Promise.reject(new PluginOperationError("transport"));
	}
	return operationBridge.invoke(request);
};

export const ryot = { data: { invokeOperation } };
