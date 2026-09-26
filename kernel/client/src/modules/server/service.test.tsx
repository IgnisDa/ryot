import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { PublicApi, PublicApiError } from "#/api/public";
import { ServerService } from "#/modules/server/service";
import { makeClientStorage } from "#/persistence/storage.test-layer";

const origin = decodeServerOrigin("https://example.com");

describe("server service", () => {
	it.effect("persists only after a healthy response and checks again when retried", () => {
		let attempts = 0;
		const saved: string[] = [];
		const dependencies = Layer.mergeAll(
			Layer.succeed(PublicApi, {
				getSystemConfig: () => Effect.die("not used"),
				checkHealth: () => {
					attempts += 1;
					return attempts === 1
						? Effect.fail(new PublicApiError({ cause: "unhealthy" }))
						: Effect.void;
				},
			}),
			makeClientStorage({
				setServerSelection: (serverOrigin) => Effect.sync(() => saved.push(serverOrigin)),
			}),
		);

		return Effect.gen(function* () {
			const service = yield* ServerService;
			expect(yield* service.selected).toBe(window.location.origin);

			const failed = yield* service
				.connect(origin)
				.pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
			const succeeded = yield* service
				.connect(origin)
				.pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));

			expect(failed).toBe(false);
			expect(succeeded).toBe(true);
			expect(attempts).toBe(2);
			expect(saved).toEqual(["https://example.com"]);
		}).pipe(Effect.provide(ServerService.layer), Effect.provide(dependencies));
	});
});
