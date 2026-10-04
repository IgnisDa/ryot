import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	PLUGIN_STORAGE_VALUE_MAX_BYTES,
	type PluginStorageOutcome,
	type PluginStorageRequest,
} from "@ryot-app/plugin-client-contract";
import { Context, Effect, Layer, Schema } from "effect";

import type { ApiScope } from "#/api/scope";
import { ClientStorage } from "#/persistence/storage";

const invalidRequest = { outcome: "failure", reason: "invalid-request" } as const;
const encodeValue = Schema.encodeSync(Schema.fromJsonString(JsonValue));

export class PluginStorage extends Context.Service<PluginStorage>()("PluginStorage", {
	make: Effect.gen(function* () {
		const storage = yield* ClientStorage;
		const outcome = (
			scope: ApiScope,
			contributors: PreparedClientPage["identity"]["contributors"],
			request: PluginStorageRequest,
		): Effect.Effect<PluginStorageOutcome> =>
			Effect.gen(function* () {
				if (
					!contributors.some(
						(contributor) =>
							contributor.kind === "plugin" && contributor.pluginId === request.pluginId,
					)
				) {
					return invalidRequest;
				}
				if (request.action === "get") {
					const value = yield* storage.getPluginValue(scope, request.pluginId, request.key);
					return { value, outcome: "success" } as const;
				}
				if (request.action === "remove") {
					yield* storage.removePluginValue(scope, request.pluginId, request.key);
					return { value: null, outcome: "success" } as const;
				}
				if (
					new TextEncoder().encode(encodeValue(request.value)).byteLength >
					PLUGIN_STORAGE_VALUE_MAX_BYTES
				) {
					return invalidRequest;
				}
				return yield* storage
					.setPluginValue(scope, request.pluginId, request.key, request.value)
					.pipe(
						Effect.match({
							onSuccess: () => ({ value: null, outcome: "success" }) as const,
							onFailure: () => ({ reason: "quota", outcome: "failure" }) as const,
						}),
					);
			});
		return { outcome };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
