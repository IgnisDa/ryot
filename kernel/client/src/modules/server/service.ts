import { Context, Effect, Layer } from "effect";

import type { ServerOrigin } from "#/api/origin";
import { PublicApi } from "#/api/public";
import { isNativePlatform } from "#/modules/navigation/native-navigation";
import { ClientStorage } from "#/persistence/storage";

export class ServerService extends Context.Service<ServerService>()("ServerService", {
	make: Effect.gen(function* () {
		const api = yield* PublicApi;
		const storage = yield* ClientStorage;
		const connect = Effect.fn("ServerService.connect")(function* (origin: ServerOrigin) {
			yield* api.checkHealth(origin);
			yield* storage.setServerSelection(origin);
		});

		const selected = isNativePlatform()
			? storage.getServerSelection
			: Effect.sync(() => window.location.origin);

		return { connect, selected };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
