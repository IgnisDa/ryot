import {
	PluginBridgeRyotQLResult,
	type PluginBridgeRyotQLRequest,
} from "@ryot/contract/modules/plugins/client";
import type { PreparedRecipe } from "@ryot/ryotql";
import { Match, Result, Schema } from "effect";

import { RyotQueryError } from "./index";

type PendingQuery = { readonly settle: (result: PluginBridgeRyotQLResult) => void };
const decodeQueryResult = Schema.decodeUnknownResult(PluginBridgeRyotQLResult);

export const createPluginQueryBridge = (port: MessagePort) => {
	const pending = new Map<string, PendingQuery>();
	let nextRequestId = 0;

	port.addEventListener("message", (event) => {
		const decoded = decodeQueryResult(event.data);
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

	return (document: PreparedRecipe<unknown>["document"]) =>
		new Promise<unknown>((resolve, reject) => {
			nextRequestId += 1;
			const requestId = `ryotql-${nextRequestId}`;
			pending.set(requestId, {
				settle: (result) =>
					Match.value(result).pipe(
						Match.when({ outcome: "failure" }, ({ reason }) => reject(new RyotQueryError(reason))),
						Match.when({ outcome: "success" }, ({ response }) => resolve(response)),
						Match.exhaustive,
					),
			});
			try {
				port.postMessage({
					document,
					requestId,
					type: "ryotql-request",
				} satisfies PluginBridgeRyotQLRequest);
			} catch {
				pending.delete(requestId);
				reject(new RyotQueryError("transport"));
			}
		});
};
