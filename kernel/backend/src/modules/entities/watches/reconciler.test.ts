import { expect, layer } from "@effect/vitest";
import type { EnrichmentState } from "@ryot-app/contract/modules/entities/schemas";
import type { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";

import { type RequestFillInput, TranslationsService } from "#modules/entities/localization/service";
import {
	entityPopulationExecutionId,
	EntityPopulationTrigger,
	type PopulationRequest,
} from "#modules/entities/population-trigger";
import { EntityRetentionRepository } from "#modules/entities/retention/repository";
import { RyotQLService } from "#modules/ryotql/service";

import { InterestReconciler } from "./reconciler";
import type { InterestPriority } from "./store";

const principal = {
	preferredLanguage: "es",
	userId: UserId.make("user-1"),
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
};

type InterestItem = {
	readonly id: string;
	readonly properties: object;
	readonly userId: null | string;
	readonly entitySchemaSlug: string;
	readonly externalId: null | string;
	readonly providerId: null | string;
	readonly populatedAt: null | string;
	readonly populationStatus: EnrichmentState;
	readonly translationStatus: EnrichmentState;
	readonly entitySchemaPluginId: null | string;
	readonly relatedPopulationStatus: EnrichmentState;
};

const populatedAt = "2026-10-20T08:30:00.000Z";
const reconciledAtMs = Date.parse("2026-10-23T12:15:00.000Z");
const complete: EnrichmentState = { state: "idle", availability: "complete" };
const missing: EnrichmentState = { state: "idle", availability: "missing" };
const none: EnrichmentState = { state: "idle", availability: "none" };
const failed: EnrichmentState = { state: "failed", availability: "missing" };

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
	populationStatus: complete,
	entitySchemaSlug: "record",
	translationStatus: complete,
	externalId: `external-${id}`,
	relatedPopulationStatus: complete,
	entitySchemaPluginId: "private-plugin",
	...overrides,
});

const unpopulated = { populatedAt: null, populationStatus: missing };

class FakeInterestFollowUps extends Context.Service<
	FakeInterestFollowUps,
	{
		readonly retainedIds: Effect.Effect<ReadonlyArray<string>>;
		readonly populationRequests: Effect.Effect<ReadonlyArray<PopulationRequest>>;
		readonly translationRequests: Effect.Effect<ReadonlyArray<RequestFillInput>>;
	}
>()("test/FakeInterestFollowUps") {}

const reconcilerLayer = (items: readonly InterestItem[], dispatched = true) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const populationRequests = yield* Ref.make<ReadonlyArray<PopulationRequest>>([]);
			const translationRequests = yield* Ref.make<ReadonlyArray<RequestFillInput>>([]);
			const retainedIds = yield* Ref.make<ReadonlyArray<string>>([]);
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
							requestFill: (input) =>
								Ref.update(translationRequests, (all) => [...all, input]).pipe(Effect.as(true)),
						}),
						Layer.mock(EntityRetentionRepository)({
							retain: (ids) => Ref.update(retainedIds, (all) => [...all, ...ids]),
						}),
					),
				),
				Layer.merge(
					Layer.succeed(FakeInterestFollowUps, {
						retainedIds: Ref.get(retainedIds),
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

layer(reconcilerLayer([row("entity-1", { ...unpopulated, translationStatus: none })]))((test) => {
	test.effect("omits IDs filtered from the visible rows", () =>
		Effect.gen(function* () {
			const reconciler = yield* InterestReconciler;
			const result = yield* reconciler.reconcile(
				principal,
				interests("visible", "entity-1", "missing-entity"),
			);

			expect(result).toEqual({ terminal: [], reconciledEntityIds: ["entity-1"] });
			expect(yield* (yield* FakeInterestFollowUps).retainedIds).toEqual(["entity-1"]);
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
		row("base-populated", { translationStatus: none, relatedPopulationStatus: missing }),
	]),
)((test) => {
	test.effect(
		"uses the same full request across reconciliation times and still completes base data",
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

				expect(first.terminal).toEqual([
					{ entityId: "base-populated", reason: "enrichment-updated" },
				]);
				const upgrade = entityPopulationExecutionId(
					EntityId.make("base-populated"),
					principal.accountGeneration,
					{ level: "full" },
				);
				expect(yield* requestedIds).toEqual([upgrade, upgrade, upgrade]);
			}),
	);
});

layer(
	reconcilerLayer([
		row("base-populated", { translationStatus: none, relatedPopulationStatus: missing }),
	]),
)((test) => {
	test.effect("never upgrades visible-only interest", () =>
		Effect.gen(function* () {
			const reconciler = yield* InterestReconciler;
			const result = yield* reconciler.reconcile(principal, interests("visible", "base-populated"));

			expect(result.terminal).toEqual([
				{ entityId: "base-populated", reason: "enrichment-updated" },
			]);
			expect(yield* (yield* FakeInterestFollowUps).populationRequests).toEqual([]);
		}),
	);
});

layer(
	reconcilerLayer(
		[
			row("related-ready", { translationStatus: none }),
			row("related-failed", { translationStatus: none, relatedPopulationStatus: failed }),
			row("child", { translationStatus: none }),
			row("unavailable", { translationStatus: none, relatedPopulationStatus: missing }),
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
					{ entityId: "related-ready", reason: "enrichment-updated" },
					{ entityId: "related-failed", reason: "enrichment-updated" },
					{ entityId: "child", reason: "enrichment-updated" },
					{ entityId: "unavailable", reason: "enrichment-updated" },
				]);
				expect(yield* requestedIds).toEqual([
					entityPopulationExecutionId(EntityId.make("unavailable"), principal.accountGeneration, {
						level: "full",
					}),
				]);
			}),
	);
});

layer(reconcilerLayer([row("entity-1"), row("entity-2", { translationStatus: missing })]))(
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
		row("entity-1", { ...unpopulated, translationStatus: none, populationStatus: failed }),
		row("entity-2", { ...unpopulated, populationStatus: failed, translationStatus: missing }),
		row("translation-failed", { translationStatus: failed }),
	]),
)((test) => {
	test.effect("reports failed enrichment without automatically requesting more work", () =>
		Effect.gen(function* () {
			const reconciler = yield* InterestReconciler;
			const result = yield* reconciler.reconcile(
				principal,
				interests("foreground", "entity-1", "entity-2", "translation-failed"),
			);

			expect(result.terminal).toEqual([
				{ entityId: "entity-1", reason: "enrichment-updated" },
				{ entityId: "entity-2", reason: "enrichment-updated" },
				{ reason: "enrichment-updated", entityId: "translation-failed" },
			]);
			const followUps = yield* FakeInterestFollowUps;
			expect(yield* followUps.populationRequests).toEqual([]);
			expect(yield* followUps.translationRequests).toEqual([]);
		}),
	);
});

layer(
	reconcilerLayer([
		row("partial", {
			populatedAt: null,
			populationStatus: { state: "idle", availability: "partial" },
		}),
		...(["queued", "running", "retrying", "cancelled", "succeeded"] as const).map((state) =>
			row(state, {
				populatedAt: null,
				translationStatus: none,
				populationStatus: { state, availability: "missing" },
			}),
		),
		row("translation-running", {
			translationStatus: { state: "running", availability: "missing" },
		}),
	]),
)((test) => {
	test.effect("requests partial idle data but never redispatches active or terminal work", () =>
		Effect.gen(function* () {
			const reconciler = yield* InterestReconciler;
			yield* reconciler.reconcile(
				principal,
				interests(
					"foreground",
					"partial",
					"queued",
					"running",
					"retrying",
					"cancelled",
					"succeeded",
					"translation-running",
				),
			);
			const followUps = yield* FakeInterestFollowUps;
			expect(
				(yield* followUps.populationRequests).map(({ entityId, execution }) => ({
					entityId,
					execution,
				})),
			).toEqual([{ entityId: "partial", execution: { level: "full" } }]);
			expect(yield* followUps.translationRequests).toEqual([]);
		}),
	);
});
