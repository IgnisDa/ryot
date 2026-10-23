import { expect, layer } from "@effect/vitest";
import type { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";

import { type RequestFillInput, TranslationsService } from "#modules/entities/localization/service";
import {
	entityPopulationExecutionId,
	EntityPopulationTrigger,
	POPULATION_UPGRADE_BUCKET_MILLISECONDS,
	type PopulationRequest,
} from "#modules/entities/population-trigger";
import { RyotQLService } from "#modules/ryotql/service";

import { InterestReconciler } from "./reconciler";
import type { InterestPriority } from "./store";

const principal = {
	preferredLanguage: "es",
	userId: UserId.make("user-1"),
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
};

type Status = "none" | "pending" | "ready" | "failed";

type InterestItem = {
	readonly id: string;
	readonly externalId: string | null;
	readonly providerId: string | null;
	readonly properties: object;
	readonly entitySchemaSlug: string;
	readonly entitySchemaPluginId: string | null;
	readonly userId: string | null;
	readonly populatedAt: string | null;
	readonly populationStatus: Status;
	readonly relatedPopulationStatus: Status;
	readonly translationStatus: "none" | "pending" | "ready";
};

const populatedAt = "2026-10-20T08:30:00.000Z";
const populatedAtMs = Date.parse(populatedAt);
const reconciledAtMs = Date.parse("2026-10-23T12:15:00.000Z");
const hourBucket = Math.floor(reconciledAtMs / POPULATION_UPGRADE_BUCKET_MILLISECONDS);

const responseWithItems = (items: readonly InterestItem[]) =>
	({
		data: {
			entities: {
				items,
				type: "rows",
				pageInfo: { hasMore: false, nextCursor: null, limit: items.length },
			},
		},
	}) satisfies RyotQLResponse;

const row = (id: string, overrides: Partial<InterestItem> = {}): InterestItem => ({
	id,
	populatedAt,
	userId: "user-1",
	providerId: "provider-1",
	properties: { title: id },
	populationStatus: "ready",
	entitySchemaSlug: "record",
	translationStatus: "ready",
	externalId: `external-${id}`,
	relatedPopulationStatus: "ready",
	entitySchemaPluginId: "private-plugin",
	...overrides,
});

const unpopulated = { populatedAt: null, populationStatus: "pending" } as const;

class FakeInterestFollowUps extends Context.Service<
	FakeInterestFollowUps,
	{
		readonly populationRequests: Effect.Effect<ReadonlyArray<PopulationRequest>>;
		readonly translationRequests: Effect.Effect<ReadonlyArray<RequestFillInput>>;
	}
>()("test/FakeInterestFollowUps") {}

const reconcilerLayer = (items: readonly InterestItem[], dispatched = true) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const populationRequests = yield* Ref.make<ReadonlyArray<PopulationRequest>>([]);
			const translationRequests = yield* Ref.make<ReadonlyArray<RequestFillInput>>([]);
			return InterestReconciler.layer.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.mock(RyotQLService)({
							executeForUser: () => Effect.succeed(responseWithItems(items)),
						}),
						Layer.mock(EntityPopulationTrigger)({
							request: (input) =>
								Ref.update(populationRequests, (all) => [...all, input]).pipe(
									Effect.as(dispatched),
								),
						}),
						Layer.mock(TranslationsService)({
							requestFill: (input) => Ref.update(translationRequests, (all) => [...all, input]),
						}),
					),
				),
				Layer.merge(
					Layer.succeed(FakeInterestFollowUps, {
						populationRequests: Ref.get(populationRequests),
						translationRequests: Ref.get(translationRequests),
					}),
				),
			);
		}),
	);

const interests = (priority: InterestPriority, ...entityIds: string[]) =>
	entityIds.map((entityId) => ({ entityId, priority }));

const requestedIds = Effect.gen(function* () {
	const requests = yield* (yield* FakeInterestFollowUps).populationRequests;
	return requests.map(({ command }) => command.causation.executionId);
});

layer(reconcilerLayer([row("entity-1", { ...unpopulated, translationStatus: "none" })]))((test) => {
	test.effect("omits IDs filtered from the visible rows", () =>
		Effect.gen(function* () {
			const reconciler = yield* InterestReconciler;
			const result = yield* reconciler.reconcile(
				principal,
				interests("visible", "entity-1", "missing-entity"),
			);

			expect(result).toEqual({ terminal: [], reconciledEntityIds: ["entity-1"] });
			expect(yield* (yield* FakeInterestFollowUps).populationRequests).toMatchObject([
				{
					userId: "user-1",
					execution: { level: "base" },
					entitySchemaPluginId: "private-plugin",
					command: {
						writeContext: null,
						causation: { lane: "interactive", initiator: { id: "user-1", kind: "user" } },
					},
				},
			]);
		}),
	);
});

layer(
	reconcilerLayer([row("visible-pending", unpopulated), row("foreground-pending", unpopulated)]),
)((test) => {
	test.effect("populates visible interest at base and foreground interest at full", () =>
		Effect.gen(function* () {
			const reconciler = yield* InterestReconciler;
			const result = yield* reconciler.reconcile(principal, [
				...interests("visible", "visible-pending"),
				...interests("foreground", "foreground-pending"),
			]);

			expect(result.terminal).toEqual([]);
			expect(
				(yield* (yield* FakeInterestFollowUps).populationRequests).map(
					({ execution }) => execution,
				),
			).toEqual([{ level: "base" }, { level: "full" }]);
			expect(yield* requestedIds).toEqual([
				entityPopulationExecutionId(EntityId.make("visible-pending"), principal.accountGeneration, {
					level: "base",
				}),
				entityPopulationExecutionId(
					EntityId.make("foreground-pending"),
					principal.accountGeneration,
					{ level: "full" },
				),
			]);
		}),
	);
});

layer(
	reconcilerLayer([
		row("base-populated", { translationStatus: "none", relatedPopulationStatus: "pending" }),
	]),
)((test) => {
	test.effect(
		"upgrades a foreground base-populated entity once per hour bucket and still completes",
		() =>
			Effect.gen(function* () {
				const reconciler = yield* InterestReconciler;
				yield* TestClock.setTime(reconciledAtMs);
				const first = yield* reconciler.reconcile(
					principal,
					interests("foreground", "base-populated"),
				);
				yield* TestClock.adjust("30 minutes");
				yield* reconciler.reconcile(principal, interests("foreground", "base-populated"));
				yield* TestClock.adjust("30 minutes");
				yield* reconciler.reconcile(principal, interests("foreground", "base-populated"));

				expect(first.terminal).toEqual([{ reason: "populated", entityId: "base-populated" }]);
				const upgrade = (bucket: number) =>
					entityPopulationExecutionId(
						EntityId.make("base-populated"),
						principal.accountGeneration,
						{ level: "full", upgrade: { populatedAtMs, hourBucket: bucket } },
					);
				expect(yield* requestedIds).toEqual([
					upgrade(hourBucket),
					upgrade(hourBucket),
					upgrade(hourBucket + 1),
				]);
				expect(upgrade(hourBucket)).toBe(
					`populate-base-populated-full-test-account-generation-${populatedAtMs}-${hourBucket}`,
				);
			}),
	);
});

layer(
	reconcilerLayer([
		row("base-populated", { translationStatus: "none", relatedPopulationStatus: "pending" }),
	]),
)((test) => {
	test.effect("never upgrades visible-only interest", () =>
		Effect.gen(function* () {
			const reconciler = yield* InterestReconciler;
			const result = yield* reconciler.reconcile(principal, interests("visible", "base-populated"));

			expect(result.terminal).toEqual([{ reason: "populated", entityId: "base-populated" }]);
			expect(yield* (yield* FakeInterestFollowUps).populationRequests).toEqual([]);
		}),
	);
});

layer(
	reconcilerLayer(
		[
			row("related-ready", { translationStatus: "none" }),
			row("related-failed", { translationStatus: "none", relatedPopulationStatus: "failed" }),
			row("child", { translationStatus: "none" }),
			row("unavailable", { translationStatus: "none", relatedPopulationStatus: "pending" }),
		],
		false,
	),
)((test) => {
	test.effect(
		"completes foreground children, related failures and unavailable providers without holding",
		() =>
			Effect.gen(function* () {
				const reconciler = yield* InterestReconciler;
				const result = yield* reconciler.reconcile(
					principal,
					interests("foreground", "related-ready", "related-failed", "child", "unavailable"),
				);

				expect(result.terminal).toEqual([
					{ reason: "populated", entityId: "related-ready" },
					{ reason: "populated", entityId: "related-failed" },
					{ entityId: "child", reason: "populated" },
					{ reason: "populated", entityId: "unavailable" },
				]);
				expect(yield* requestedIds).toEqual([
					entityPopulationExecutionId(EntityId.make("unavailable"), principal.accountGeneration, {
						level: "full",
						upgrade: { populatedAtMs, hourBucket: 0 },
					}),
				]);
			}),
	);
});

layer(reconcilerLayer([row("entity-1"), row("entity-2", { translationStatus: "pending" })]))(
	(test) => {
		test.effect("returns terminal rows and enqueues pending translations", () =>
			Effect.gen(function* () {
				const reconciler = yield* InterestReconciler;
				const result = yield* reconciler.reconcile(
					principal,
					interests("visible", "entity-1", "entity-2"),
				);

				expect(result.terminal).toEqual([{ entityId: "entity-1", reason: "translated" }]);
				expect(yield* (yield* FakeInterestFollowUps).translationRequests).toMatchObject([
					{ lane: "interactive", entityId: "entity-2", entitySchemaPluginId: "private-plugin" },
				]);
			}),
		);
	},
);

layer(
	reconcilerLayer([
		row("entity-1", { ...unpopulated, translationStatus: "none", populationStatus: "failed" }),
		row("entity-2", { ...unpopulated, populationStatus: "failed", translationStatus: "pending" }),
	]),
)((test) => {
	test.effect("completes failed populations without requesting population or translation", () =>
		Effect.gen(function* () {
			const reconciler = yield* InterestReconciler;
			const result = yield* reconciler.reconcile(
				principal,
				interests("foreground", "entity-1", "entity-2"),
			);

			expect(result.terminal).toEqual([
				{ entityId: "entity-1", reason: "population-failed" },
				{ entityId: "entity-2", reason: "population-failed" },
			]);
			const followUps = yield* FakeInterestFollowUps;
			expect(yield* followUps.populationRequests).toEqual([]);
			expect(yield* followUps.translationRequests).toEqual([]);
		}),
	);
});
