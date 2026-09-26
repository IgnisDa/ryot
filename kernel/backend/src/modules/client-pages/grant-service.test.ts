import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { ReusableCapabilityGrantStore } from "#lib/infrastructure/reusable-capability-grants";

import { ClientDocumentGrantService } from "./grant-service";

it.effect("binds a reusable document capability to user and composition", () => {
	const payloads = new Map<string, string>();
	const reusable = new Map<string, { token: string; grantId: string; expiresAt: string }>();
	const grants = ReusableCapabilityGrantStore.of({
		resolve: (token) => Effect.succeed(payloads.get(token) ?? null),
		issue: ({ payload, reuseKey }) =>
			Effect.sync(() => {
				const existing = reusable.get(reuseKey);
				if (existing) {
					return existing;
				}
				const value = {
					grantId: "id",
					expiresAt: "2026-01-01T00:00:00Z",
					token: String.fromCharCode(97 + reusable.size).repeat(43),
				};
				reusable.set(reuseKey, value);
				payloads.set(value.token, payload);
				return value;
			}),
	});
	return Effect.gen(function* () {
		const service = yield* ClientDocumentGrantService;
		const first = yield* service.issue(UserId.make("user-1"), "hash-1");
		const again = yield* service.issue(UserId.make("user-1"), "hash-1");
		expect(again.src).toBe(first.src);
		const another = yield* service.issue(UserId.make("user-2"), "hash-1");
		expect(reusable.size).toBe(2);
		expect(another.src).not.toBe(first.src);
		expect(first.src).toBe(`/api/client-pages/documents/${"a".repeat(43)}`);
		expect(yield* service.resolve("a".repeat(43))).toEqual({
			userId: "user-1",
			compositionHash: "hash-1",
		});
		expect(yield* service.resolve("b".repeat(43))).toEqual({
			userId: "user-2",
			compositionHash: "hash-1",
		});
	}).pipe(
		Effect.provide(
			ClientDocumentGrantService.layer.pipe(
				Layer.provide(Layer.succeed(ReusableCapabilityGrantStore, grants)),
			),
		),
	);
});
