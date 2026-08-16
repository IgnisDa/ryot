import {
	PLUGIN_STORAGE_VALUE_MAX_BYTES,
	type PluginStorageOutcome,
	type PluginStorageRequest,
} from "@ryot-app/client-plugin-contract";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { Effect } from "effect";

import type { ApiScope } from "#/api/scope";
import { ClientStorage } from "#/persistence/storage";

const invalidRequest = { outcome: "failure", reason: "invalid-request" } as const;

// Same-realm plugins in one frame cannot be told apart, so the slug is checked only against the
// frame's own composition.
export const pluginStorageOutcome = (
	scope: ApiScope,
	contributors: PreparedClientPage["identity"]["contributors"],
	request: PluginStorageRequest,
): Effect.Effect<PluginStorageOutcome, never, ClientStorage> =>
	Effect.gen(function* () {
		if (
			!contributors.some(
				(contributor) =>
					contributor.kind === "plugin" && contributor.pluginSlug === request.pluginSlug,
			)
		) {
			return invalidRequest;
		}
		const storage = yield* ClientStorage;
		if (request.action === "get") {
			const value = yield* storage.getPluginValue(scope, request.pluginSlug, request.key);
			return { value, outcome: "success" } as const;
		}
		if (request.action === "remove") {
			yield* storage.removePluginValue(scope, request.pluginSlug, request.key);
			return { value: null, outcome: "success" } as const;
		}
		if (
			new TextEncoder().encode(JSON.stringify(request.value)).byteLength >
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
