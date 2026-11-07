import { expect } from "bun:test";

import { randomUuid } from "@ryot-app/testing/random";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { isolatedDatabaseLayer } from "#testing/isolated-database";

import {
	type ProviderHttpAdmissionDeclaration,
	ProviderHttpAdmissionService,
} from "./http-admission";

const testLayer = ProviderHttpAdmissionService.layer.pipe(
	Layer.provideMerge(isolatedDatabaseLayer("http_admission")),
);

const declaration = Effect.fnUntraced(function* (
	overrides: Partial<ProviderHttpAdmissionDeclaration> = {},
) {
	return { requests: 10, intervalMs: 10_000, key: `test.${yield* randomUuid}`, ...overrides };
});

layer(testLayer, { excludeTestServices: true })((test) => {
	test.effect("admits the first request at once and spaces the rest by the declared spacing", () =>
		Effect.gen(function* () {
			const admission = yield* ProviderHttpAdmissionService;
			const policy = yield* declaration();

			const waits = [
				yield* admission.reserve(policy),
				yield* admission.reserve(policy),
				yield* admission.reserve(policy),
			];

			expect(waits[0]).toBeLessThanOrEqual(1);
			expect(waits[1]).toBeGreaterThan(900);
			expect(waits[1]).toBeLessThanOrEqual(1_000);
			expect(waits[2]).toBeGreaterThan(1_900);
			expect(waits[2]).toBeLessThanOrEqual(2_000);
		}),
	);

	test.effect("spaces the next slot from a late send", () =>
		Effect.gen(function* () {
			const admission = yield* ProviderHttpAdmissionService;
			const policy = yield* declaration({ intervalMs: 2_000 });

			yield* admission.reserve(policy);
			yield* Effect.sleep("300 millis");
			yield* admission.sending(policy);

			const wait = yield* admission.reserve(policy);
			expect(wait).toBeGreaterThan(100);
			expect(wait).toBeLessThanOrEqual(200);
		}),
	);

	test.effect("keeps later slots already taken when a request is sent", () =>
		Effect.gen(function* () {
			const admission = yield* ProviderHttpAdmissionService;
			const policy = yield* declaration();

			yield* admission.reserve(policy);
			yield* admission.reserve(policy);
			yield* admission.reserve(policy);
			yield* admission.sending(policy);

			expect(yield* admission.reserve(policy)).toBeGreaterThan(2_900);
		}),
	);

	test.effect("keeps each provider's schedule separate", () =>
		Effect.gen(function* () {
			const admission = yield* ProviderHttpAdmissionService;
			const first = yield* declaration();
			const second = yield* declaration();

			yield* admission.reserve(first);
			yield* admission.reserve(first);

			expect(yield* admission.reserve(second)).toBeLessThanOrEqual(1);
		}),
	);

	test.effect("holds requests back for a block and never shortens a longer one", () =>
		Effect.gen(function* () {
			const admission = yield* ProviderHttpAdmissionService;
			const policy = yield* declaration();

			yield* admission.block(policy, 60_000);
			yield* admission.block(policy, 5_000);

			const wait = yield* admission.reserve(policy);
			expect(wait).toBeGreaterThan(59_000);
			expect(wait).toBeLessThanOrEqual(60_000);
		}),
	);
});
