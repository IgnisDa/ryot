import {
	PluginBridgeOperationResult,
	type PluginBridgeOperationRequest,
} from "@ryot/contract/modules/plugins/client";
import { Match, Result, Schema } from "effect";

import { PluginOperationError } from "./index";

type PendingOperation = {
	readonly settle: (result: PluginBridgeOperationResult) => void;
};

const decodeOperationResult = Schema.decodeUnknownResult(PluginBridgeOperationResult);

export const createPluginOperationBridge = (port: MessagePort) => {
	const pending = new Map<string, PendingOperation>();
	let nextRequestId = 0;

	port.addEventListener("message", (event) => {
		const decoded = decodeOperationResult(event.data);
		if (Result.isFailure(decoded)) {
			return;
		}
		const result = decoded.success;
		const entry = pending.get(result.requestId);
		if (!entry) {
			return;
		}
		pending.delete(result.requestId);
		entry.settle(result);
	});

	return (request: { readonly slug: string; readonly input: unknown }) =>
		new Promise<unknown>((resolve, reject) => {
			nextRequestId += 1;
			const requestId = `operation-${nextRequestId}`;
			pending.set(requestId, {
				settle: (result) =>
					Match.value(result).pipe(
						Match.when({ outcome: "failure" }, ({ reason }) =>
							reject(new PluginOperationError(reason)),
						),
						Match.when({ outcome: "success" }, ({ value }) => resolve(value)),
						Match.exhaustive,
					),
			});
			try {
				port.postMessage({
					requestId,
					input: request.input,
					type: "operation-request",
					operationSlug: request.slug,
				} satisfies PluginBridgeOperationRequest);
			} catch {
				pending.delete(requestId);
				reject(new PluginOperationError("transport"));
			}
		});
};
