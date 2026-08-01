import {
	PluginBridgeOperationResult,
	type PluginBridgeOperationRequest,
	type PluginOperationFailureReason,
} from "@ryot/contract/modules/plugins/client";
import { Match, Result, Schema } from "effect";

export type PluginOperationErrorReason = PluginOperationFailureReason | "malformed-result";

export class PluginOperationError extends Error {
	readonly reason: PluginOperationErrorReason;

	constructor(reason: PluginOperationErrorReason) {
		super(`Plugin operation failed: ${reason}`);
		this.reason = reason;
	}
}

export type PluginOperationInvocation<Output extends Schema.Codec<unknown, unknown>> = {
	readonly slug: string;
	readonly input: unknown;
	readonly output: Output;
};

type PendingOperation = {
	readonly settle: (result: PluginBridgeOperationResult) => void;
};

const decodeOperationResult = Schema.decodeUnknownResult(PluginBridgeOperationResult);

// TODO(clientplugin): closing the kernel port raises no event here, so pending calls die with the
// plugin document rather than rejecting. Drain them if a bridge is ever closed without replacing
// the iframe, which Task 07 crash recovery and Task 08 artifact reload must confirm they do not do.
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

	const invoke = <Output extends Schema.Codec<unknown, unknown>>(
		request: PluginOperationInvocation<Output>,
	) =>
		new Promise<Output["Type"]>((resolve, reject) => {
			nextRequestId += 1;
			const decode = Schema.decodeUnknownResult(request.output);
			const requestId = `operation-${nextRequestId}`;
			pending.set(requestId, {
				settle: (result) =>
					Match.value(result).pipe(
						Match.when({ outcome: "failure" }, ({ reason }) => {
							reject(new PluginOperationError(reason));
						}),
						Match.when({ outcome: "success" }, ({ value }) => {
							const decoded = decode(value);
							if (Result.isFailure(decoded)) {
								reject(new PluginOperationError("malformed-result"));
								return;
							}
							resolve(decoded.success);
						}),
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

	return { invoke };
};

export type PluginOperationBridge = ReturnType<typeof createPluginOperationBridge>;
