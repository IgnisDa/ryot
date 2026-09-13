import {
	PLUGIN_STORAGE_VALUE_MAX_BYTES,
	type PluginStorageOutcome,
	type PluginStorageRequest,
} from "@ryot-app/client-plugin-contract";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Context, Effect, Layer, Schema } from "effect";

import type { ApiScope } from "#/api/scope";
import { ClientStorage } from "#/persistence/storage";

const invalidRequest = { outcome: "failure", reason: "invalid-request" } as const;
const encodeValue = Schema.encodeSync(Schema.fromJsonString(JsonValue));

export class PluginStorage extends Context.Service<PluginStorage>()("PluginStorage", {
	make: Effect.gen(function* () {
		const storage = yield* ClientStorage;
		// Same-realm plugins in one frame cannot be told apart, so the slug is checked only against the
		// frame's own composition.
		const outcome = (
			scope: ApiScope,
			contributors: PreparedClientPage["identity"]["contributors"],
			request: PluginStorageRequest,
		): Effect.Effect<PluginStorageOutcome> =>
			Effect.gen(function* () {
				if (
					!contributors.some(
						(contributor) =>
							contributor.kind === "plugin" && contributor.pluginSlug === request.pluginSlug,
					)
				) {
					return invalidRequest;
				}
				if (request.action === "get") {
					const value = yield* storage.getPluginValue(scope, request.pluginSlug, request.key);
					return { value, outcome: "success" } as const;
				}
				if (request.action === "remove") {
					yield* storage.removePluginValue(scope, request.pluginSlug, request.key);
					return { value: null, outcome: "success" } as const;
				}
				if (
					new TextEncoder().encode(encodeValue(request.value)).byteLength >
					PLUGIN_STORAGE_VALUE_MAX_BYTES
				) {
					return invalidRequest;
				}
				return yield* storage
					.setPluginValue(scope, request.pluginSlug, request.key, request.value)
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
