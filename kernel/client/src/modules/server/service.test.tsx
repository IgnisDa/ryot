import { describe, expect, layer } from "@effect/vitest";
import { Context, Effect, Layer, Ref } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { PublicApi, PublicApiError } from "#/api/public";
import { ServerService } from "#/modules/server/service";
import { makeClientStorage } from "#/persistence/storage.test-layer";

const origin = decodeServerOrigin("https://example.com");

class FakeServerDependencies extends Context.Service<
	FakeServerDependencies,
	{
		readonly healthChecks: Effect.Effect<number>;
		readonly savedSelections: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/FakeServerDependencies") {}

const serverLayer = Layer.unwrap(
	Effect.gen(function* () {
		const healthChecks = yield* Ref.make(0);
		const saved = yield* Ref.make<ReadonlyArray<string>>([]);
		const dependencies = Layer.mergeAll(
			Layer.succeed(PublicApi, {
				getSystemConfig: () => Effect.die("not used"),
				checkHealth: () =>
					Ref.updateAndGet(healthChecks, (count) => count + 1).pipe(
						Effect.flatMap((attempt) =>
							attempt === 1 ? Effect.fail(new PublicApiError({ cause: "unhealthy" })) : Effect.void,
						),
					),
			}),
			makeClientStorage({
				setServerSelection: (serverOrigin) => Ref.update(saved, (all) => [...all, serverOrigin]),
			}),
		);
		return Layer.merge(
			Layer.provide(ServerService.layer, dependencies),
			Layer.succeed(FakeServerDependencies, {
				savedSelections: Ref.get(saved),
				healthChecks: Ref.get(healthChecks),
			}),
		);
	}),
);

describe("server service", () => {
	layer(serverLayer)((test) => {
		test.effect("persists only after a healthy response and checks again when retried", () =>
			Effect.gen(function* () {
				const service = yield* ServerService;
				const dependencies = yield* FakeServerDependencies;
				expect(yield* service.selected).toBe(window.location.origin);

				const failed = yield* service
					.connect(origin)
					.pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
				const succeeded = yield* service
					.connect(origin)
					.pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));

				expect(failed).toBe(false);
				expect(succeeded).toBe(true);
				expect(yield* dependencies.healthChecks).toBe(2);
				expect(yield* dependencies.savedSelections).toEqual(["https://example.com"]);
			}),
		);
	});
});
