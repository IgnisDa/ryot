import type { CoreSandboxHostMethodMap } from "@ryot-app/sandbox-sdk/core";
import { DateTime, Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import type { MediaIntegrationConfirmation } from "./schemas";

const CompletionState = Schema.Struct({
	expiresAt: Schema.Finite,
	keys: Schema.Array(Schema.String),
});
const completionJson = Schema.fromJsonString(CompletionState);
export const integrationSourceAttribution = (
	sourceIdentifier: string,
	sourceLabel: string,
	keys: readonly string[],
	expiresAt: number,
) => ({
	sourceLabel,
	sourceIdentifier,
	recordId: Schema.encodeSync(completionJson)({ keys, expiresAt }),
});
export const confirmIntegrationSource = Effect.fn(function* (
	confirmation: typeof MediaIntegrationConfirmation.Type,
	host: Pick<CoreSandboxHostMethodMap, "claimPersistentValue">,
) {
	const now = DateTime.toEpochMillis(yield* DateTime.now);
	for (const operation of confirmation.confirmed) {
		if (
			operation.result !== "created" ||
			!operation.operationId.startsWith('["integration-source-event",') ||
			!operation.attribution.recordId
		) {
			continue;
		}
		const state = yield* Schema.decodeEffect(completionJson)(operation.attribution.recordId);
		const ttlSeconds = Math.ceil((state.expiresAt - now) / 1000);
		if (ttlSeconds <= 0) {
			continue;
		}
		for (const key of state.keys) {
			yield* host.claimPersistentValue(key, true, ttlSeconds);
		}
	}
	return { chunkFiles: [] };
});
