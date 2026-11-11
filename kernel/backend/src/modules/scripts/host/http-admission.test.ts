import { expect } from "bun:test";

import { assert } from "@ryot-app/testing/assert";
import { randomUuid } from "@ryot-app/testing/random";
import { layer } from "@voila.dev/effect-bun-test";
import { sql } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { providerRateLimit } from "#schema/tables/provider-rate-limits";
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

const schedule = Effect.fnUntraced(function* (policy: ProviderHttpAdmissionDeclaration) {
	const session = yield* DatabaseSession;
	const [row] = yield* session.run((db) =>
		db.execute<{ at: number; next: null | number }>(
			sql`
		select extract(epoch from now())::float8 * 1000 as at,
			(select extract(epoch from next_allowed_at)::float8 * 1000
			 from ${providerRateLimit} where key = ${policy.key}) as next`,
			"objects",
		),
	);
	assert(row);
	return row;
});
const reserve = Effect.fnUntraced(function* (policy: ProviderHttpAdmissionDeclaration) {
	const admission = yield* ProviderHttpAdmissionService;
	const before = yield* schedule(policy);
	const wait = yield* admission.reserve(policy);
	const after = yield* schedule(policy);
	assert(after.next !== null);
	return { wait, before, after: { ...after, next: after.next } };
});
layer(testLayer, { excludeTestServices: true })((test) => {
	test.effect("admits the first request at once and spaces the rest by the declared spacing", () =>
		Effect.gen(function* () {
			const policy = yield* declaration();
			const observations = [yield* reserve(policy), yield* reserve(policy), yield* reserve(policy)];
			expect(observations[0]?.wait).toBeLessThanOrEqual(1);
			for (const { wait, after, before } of observations) {
				expect(after.next).toBeGreaterThanOrEqual(
					Math.max(before.next ?? before.at, before.at) + 1000,
				);
				expect(after.next).toBeLessThanOrEqual(Math.max(before.next ?? after.at, after.at) + 1000);
				expect(wait).toBeGreaterThanOrEqual(Math.max(0, Math.ceil(after.next - after.at - 1000)));
				expect(wait).toBeLessThanOrEqual(Math.max(0, Math.ceil(after.next - before.at - 1000)));
			}
		}),
	);

	test.effect("spaces the next slot from a late send", () =>
		Effect.gen(function* () {
			const admission = yield* ProviderHttpAdmissionService;
			const policy = yield* declaration({ intervalMs: 2_000 });
			yield* admission.reserve(policy);
			yield* (yield* DatabaseSession).run((db) =>
				db.execute(sql`
				update ${providerRateLimit} set next_allowed_at = now() - interval '300 milliseconds'
				where key = ${policy.key}`),
			);
			const beforeSend = yield* schedule(policy);
			yield* admission.sending(policy);
			const afterSend = yield* schedule(policy);
			assert(afterSend.next !== null);
			expect(afterSend.next).toBeGreaterThanOrEqual(beforeSend.at + 200);
			expect(afterSend.next).toBeLessThanOrEqual(afterSend.at + 200);
			const { wait, after, before } = yield* reserve(policy);
			expect(after.next).toBeGreaterThanOrEqual(afterSend.next + 200);
			expect(wait).toBeGreaterThanOrEqual(Math.max(0, Math.ceil(after.next - after.at - 200)));
			expect(wait).toBeLessThanOrEqual(Math.max(0, Math.ceil(after.next - before.at - 200)));
		}),
	);

	test.effect("keeps later slots already taken when a request is sent", () =>
		Effect.gen(function* () {
			const admission = yield* ProviderHttpAdmissionService;
			const policy = yield* declaration();
			yield* admission.reserve(policy);
			yield* admission.reserve(policy);
			yield* admission.reserve(policy);
			const queued = yield* schedule(policy);
			assert(queued.next !== null);
			yield* admission.sending(policy);
			const sent = yield* schedule(policy);
			assert(sent.next !== null);
			expect(sent.next).toBeGreaterThanOrEqual(queued.next);
			const { wait, after, before } = yield* reserve(policy);
			expect(after.next).toBeGreaterThanOrEqual(sent.next + 1000);
			expect(wait).toBeGreaterThanOrEqual(Math.max(0, Math.ceil(after.next - after.at - 1000)));
			expect(wait).toBeLessThanOrEqual(Math.max(0, Math.ceil(after.next - before.at - 1000)));
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
