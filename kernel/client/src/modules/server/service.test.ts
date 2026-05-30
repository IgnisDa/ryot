import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { PublicApi, PublicApiError } from "#/api/public";
import { ServerService } from "#/modules/server/service";
import { ClientStorage } from "#/persistence/storage";

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
			Layer.succeed(ClientStorage, {
				remove: () => Effect.void,
				clearServerSelection: Effect.void,
				setThemePreference: () => Effect.void,
				getServerSelection: Effect.succeed(null),
				getThemePreference: Effect.succeed("system" as const),
				setServerSelection: (origin) => Effect.sync(() => saved.push(origin)),
			}),
		);

		return Effect.gen(function* () {
			const service = yield* ServerService;

			const failed = yield* service
				.connect("https://example.com")
				.pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
			const succeeded = yield* service
				.connect("https://example.com")
				.pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));

			expect(failed).toBe(false);
			expect(succeeded).toBe(true);
			expect(attempts).toBe(2);
			expect(saved).toEqual(["https://example.com"]);
		}).pipe(Effect.provide(ServerService.layer), Effect.provide(dependencies));
	});
});
