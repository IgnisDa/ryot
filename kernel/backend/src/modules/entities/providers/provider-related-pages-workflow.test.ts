import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import {
	decodeEntityUpdatedMessage,
	encodeEntityUpdatedMessage,
} from "@ryot-app/contract/modules/entity-watches/messages";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { and, eq } from "drizzle-orm";
import { DateTime, Deferred, Effect, Fiber, Layer, Ref, Result, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/packages/types";
import { relationshipDatabaseLayer } from "#modules/relationships/lifecycle.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import type { SandboxExecutionResult } from "#modules/scripts/executions/result";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import * as tables from "#schema/tables/combined";
import { makeRedisService, makeWorkflowActivityEngine } from "#testing/effect";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import {
	ProviderEntityPopulationAttemptWorkflow,
	ProviderRelatedPagesPayload,
	ProviderRelatedPagesWorkflow,
	RELATED_PAGES_MAX_PAGES,
	runProviderEntityPopulationAttemptWorkflow,
	runProviderRelatedPagesWorkflow,
} from "./provider-entity-population-workflow";

const userId = UserId.make("relationship-owner");
const bottle = EntitySchemaSlug.make("bottle");
const titleProperties = {
	fields: { title: { type: "string", label: "Title", description: "Title" } },
} as const;

const fixturePackage = (): NormalizedPlugin => {
	const source = revisionPackage("whiskey", "v1", bottle);
	return {
		...source,
		manifest: {
			...source.manifest,
			entitySchemas: [
				{
					icon: "box",
					slug: "bottle",
					name: "bottle",
					eventSchemas: [],
					propertiesSchema: titleProperties,
				},
			],
			relationshipSchemas: ["credits", "references"].map((slug) => ({
				slug,
				name: "Credits",
				sourceEntitySchemaSlug: "bottle",
				targetEntitySchemaSlug: "bottle",
				propertiesSchema: {
					fields: { role: { label: "Role", type: "string", description: "Role" } },
				},
			})),
		},
	};
};

const related = (externalId: string, role = "maker") => ({
	externalId,
	name: externalId,
	providerSlug: "whiskey-provider",
	relationshipProperties: { role },
	properties: { title: externalId },
});

const group = (
	entities: ReadonlyArray<ReturnType<typeof related>>,
	options: {
		continuation?: JsonValue;
		synchronization?: "additive" | "authoritative";
		relationshipSchemaSlug?: string;
	} = {},
) => ({
	entities,
	direction: "outgoing" as const,
	synchronization: options.synchronization ?? "authoritative",
	relationshipSchemaSlug: options.relationshipSchemaSlug ?? "credits",
	...(options.continuation === undefined ? {} : { continuation: options.continuation }),
});

const completed = (value: unknown) => ({
	value,
	logs: [],
	error: null,
	status: "completed" as const,
});

type PageResult = SandboxExecutionResult | "fail";
type RelatedPageHandler = (continuation: JsonValue) => PageResult | Effect.Effect<PageResult>;

const harness = Effect.fnUntraced(function* (
	scope: string,
	config: { readonly relatedScript?: boolean; readonly dispatchError?: SandboxRunError } = {},
) {
	const session = yield* DatabaseSession;
	const runtime = yield* PluginRuntimeResolver;
	const installed = yield* installRevisionPackage(fixturePackage(), userId);
	const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
		slug: "whiskey-provider",
		owner: definitionOwner(installed.pluginId),
	});
	assert(provider);
	const script = yield* runtime.resolveUserDetailsScript(userId, provider.id);
	const subject = {
		userId,
		type: "user" as const,
		accountGeneration: { userId, token: "test-account-generation" },
	};
	const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, subject);
	assert(pin?.pluginRevision);
	const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
	const commandFor = (executionId: string): DomainLifecycleCommand => ({
		...rootLifecycleCommand({
			source: "api",
			lane: "interactive",
			itemIdentity: executionId,
			initiator: { id: userId, kind: "user" },
			accountGeneration: subject.accountGeneration,
			executionId: AutomationExecutionId.make(`${scope}-${executionId}`),
			occurredAt: executionId === "seed" ? "2026-10-13T00:00:00.000Z" : "2026-10-14T00:00:00.000Z",
		}),
		writeContext: principal,
	});
	const dispatched: Array<{ discard: boolean | undefined; payload: unknown; tag: string }> = [];
	const published = yield* Ref.make<ReadonlyArray<string>>([]);
	const relatedRuns = yield* Ref.make<
		ReadonlyArray<{ executionId: string; continuation: JsonValue }>
	>([]);
	const operations = (
		details: unknown,
		handler: RelatedPageHandler = () => "fail",
	): EntityImportWorkflowOperations["Service"] => ({
		completeProviderEntityImport: () => Effect.void,
		processSandbox: () => Effect.succeed(completed(details)),
		processProviderResolve: () => Effect.die("unexpected provider resolve"),
		preRegisterProviderImport: () => Effect.die("unexpected provider pre-registration"),
		requireRelatedScript: () =>
			config.relatedScript !== false
				? Effect.void
				: Effect.fail(
						new SandboxRunError({
							kind: "missing-artifact",
							message: "Pinned provider related script is unavailable",
						}),
					),
		processRelatedPage: (_payload, executionId, continuation) =>
			Ref.update(relatedRuns, (all) => [...all, { executionId, continuation }]).pipe(
				Effect.flatMap(() => {
					const result = handler(continuation);
					return Effect.isEffect(result) ? result : Effect.succeed(result);
				}),
				Effect.map((result) =>
					result === "fail"
						? {
								...completed(null),
								error: {
									message: "page failed",
									phase: "execute" as const,
									kind: "script-failure" as const,
								},
							}
						: result,
				),
			),
	});
	const redisFor = (afterBase?: Effect.Effect<void>) =>
		makeRedisService({
			publish: (_channel, message) =>
				Effect.gen(function* () {
					yield* Ref.update(published, (all) => [...all, message]);
					const decoded = decodeEntityUpdatedMessage(message);
					if (Result.isSuccess(decoded) && decoded.success.reason === "populated") {
						yield* afterBase ?? Effect.void;
					}
					return 1;
				}),
		});
	const redis = redisFor();
	const populate = (
		executionId: string,
		mode: "ensure" | "refresh",
		details: unknown,
		handler?: RelatedPageHandler,
		hooks: {
			readonly afterBase?: Effect.Effect<void>;
			readonly afterPages?: Effect.Effect<void>;
		} = {},
	) =>
		Effect.gen(function* () {
			const context =
				yield* Effect.context<
					Exclude<
						Effect.Services<ReturnType<typeof runProviderRelatedPagesWorkflow>>,
						WorkflowEngine | WorkflowInstance
					>
				>();
			const instance = WorkflowInstance.initial(
				ProviderEntityPopulationAttemptWorkflow,
				executionId,
			);
			const engine = makeWorkflowActivityEngine(instance, {
				execute: (workflow, options) =>
					Effect.gen(function* () {
						dispatched.push({
							tag: workflow._tag,
							payload: options.payload,
							discard: options.discard,
						});
						if (config.dispatchError) {
							return yield* config.dispatchError;
						}
						const payload = yield* Schema.decodeUnknownEffect(ProviderRelatedPagesPayload)(
							options.payload,
						).pipe(Effect.orDie);
						const child = WorkflowInstance.initial(
							ProviderRelatedPagesWorkflow,
							payload.executionId,
						);
						const outcome = yield* runProviderRelatedPagesWorkflow(
							payload,
							payload.executionId,
						).pipe(
							Effect.provideService(WorkflowInstance, child),
							Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(child)),
							Effect.provide(context),
						);
						yield* hooks.afterPages ?? Effect.void;
						return outcome;
					}),
			});
			return yield* runProviderEntityPopulationAttemptWorkflow(
				{
					mode,
					executionId,
					level: "full",
					requestAttempt: 1,
					externalId: "root",
					requestId: executionId,
					providerId: provider.id,
					entitySchemaSlug: bottle,
					command: commandFor(executionId),
					entityScope: { userId, type: "user" },
					pluginId: PluginId.make(installed.pluginId),
				},
				executionId,
			).pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, engine),
			);
		}).pipe(
			Effect.provideService(RedisService, redisFor(hooks.afterBase)),
			Effect.provideService(EntityImportWorkflowOperations, operations(details, handler)),
		);
	const continuePages = Effect.fnUntraced(function* (
		index: number,
		details: unknown,
		handler: RelatedPageHandler,
	) {
		const entry = dispatched.filter(({ tag }) => tag === ProviderRelatedPagesWorkflow._tag)[index];
		assert(entry);
		const payload = yield* Schema.decodeUnknownEffect(ProviderRelatedPagesPayload)(entry.payload);
		const instance = WorkflowInstance.initial(ProviderRelatedPagesWorkflow, payload.executionId);
		return yield* runProviderRelatedPagesWorkflow(payload, payload.executionId).pipe(
			Effect.provideService(WorkflowInstance, instance),
			Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			Effect.provideService(RedisService, redis),
			Effect.provideService(EntityImportWorkflowOperations, operations(details, handler)),
		);
	});
	const credits = (anchor: Pick<ListedEntity, "id">, relationshipSchemaSlug = "credits") =>
		session
			.run((db) =>
				db
					.select({
						role: tables.relationship.properties,
						externalId: tables.entity.externalId,
						generation: tables.relationship.syncGeneration,
					})
					.from(tables.relationship)
					.innerJoin(tables.entity, eq(tables.entity.id, tables.relationship.targetEntityId))
					.where(
						and(
							eq(tables.relationship.sourceEntityId, anchor.id),
							eq(tables.relationship.relationshipSchemaSlug, relationshipSchemaSlug),
						),
					),
			)
			.pipe(
				Effect.map((rows) =>
					rows
						.map(({ role, externalId, generation }) => ({ role, externalId, generation }))
						.sort((left, right) => String(left.externalId).localeCompare(String(right.externalId))),
				),
			);
	return {
		credits,
		populate,
		dispatched,
		continuePages,
		published: Ref.get(published),
		relatedRuns: Ref.get(relatedRuns),
		root: session
			.run((db) =>
				db
					.select()
					.from(tables.entity)
					.where(
						and(
							eq(tables.entity.externalId, "root"),
							eq(tables.entity.entitySchemaPluginId, installed.pluginId),
						),
					),
			)
			.pipe(Effect.map(([row]) => (row ? { ...row, id: EntityId.make(row.id) } : null))),
		status: (entityId: ListedEntity["id"]) =>
			session
				.run((db) =>
					db
						.select({
							populatedAt: tables.entity.populatedAt,
							relatedPopulatedAt: tables.entity.relatedPopulatedAt,
						})
						.from(tables.entity)
						.where(eq(tables.entity.id, entityId)),
				)
				.pipe(Effect.map(([row]) => row)),
	};
});

const rootDetails = (groups: ReadonlyArray<ReturnType<typeof group>>) => ({
	name: "Root",
	relatedEntityGroups: groups,
	properties: { title: "Root" },
});

const page = (
	entities: ReadonlyArray<ReturnType<typeof related>>,
	continuation: JsonValue | null,
) => completed({ entities, continuation });

const seedRoot = (h: Effect.Success<ReturnType<typeof harness>>) =>
	h.populate("seed", "ensure", rootDetails([group([related("stale"), related("keep", "old")])]));

layer(
	Layer.merge(
		relationshipDatabaseLayer(),
		Layer.mock(EnrichmentRequests)({
			attachEntity: () => Effect.void,
			guardPopulation: () => Effect.void,
			recordBaseCheck: () => Effect.void,
		}),
	),
)((test) => {
	for (const paged of [true, false]) {
		test.effect(
			`rejects stale completion after a newer root commits before group claims (${paged ? "paged" : "empty"})`,
			() =>
				Effect.gen(function* () {
					const h = yield* harness(`root-generation-${paged}`);
					const anchor = yield* seedRoot(h);
					const session = yield* DatabaseSession;
					const aReady = yield* Deferred.make<void>();
					const resumeA = yield* Deferred.make<void>();
					const bReady = yield* Deferred.make<void>();
					const resumeB = yield* Deferred.make<void>();
					const pauseA = Deferred.succeed(aReady, undefined).pipe(
						Effect.andThen(Deferred.await(resumeA)),
					);
					const pauseB = Deferred.succeed(bReady, undefined).pipe(
						Effect.andThen(Deferred.await(resumeB)),
					);
					const older = yield* h
						.populate(
							"older-root",
							"refresh",
							rootDetails(
								paged ? [group([related("older-first")], { continuation: "older" })] : [],
							),
							() => page([related("older-last")], null),
							paged ? { afterPages: pauseA } : { afterBase: pauseA },
						)
						.pipe(Effect.result, Effect.forkChild);
					yield* Deferred.await(aReady);
					const newer = yield* h
						.populate(
							"newer-root",
							"refresh",
							rootDetails([group([related("newer-first")], { continuation: "newer" })]),
							() => "fail",
							{ afterBase: pauseB },
						)
						.pipe(Effect.result, Effect.forkChild);
					yield* Deferred.await(bReady);
					expect(yield* h.root).toMatchObject({
						relatedPopulatedAt: null,
						relatedPopulationGeneration: "newer-root",
					});
					if (paged) {
						const [generation] = yield* session.run((db) =>
							db
								.select({ value: tables.relationshipSyncGeneration.generation })
								.from(tables.relationshipSyncGeneration)
								.where(
									and(
										eq(tables.relationshipSyncGeneration.anchorEntityId, anchor.id),
										eq(tables.relationshipSyncGeneration.relationshipSchemaSlug, "credits"),
									),
								),
						);
						expect(generation?.value).toBe("older-root");
					}
					yield* Deferred.succeed(resumeA, undefined);
					const olderResult = yield* Fiber.join(older);
					assert(Result.isFailure(olderResult));
					expect(olderResult.failure.message).toBe("Provider population was superseded");
					expect(yield* h.root).toMatchObject({
						relatedPopulatedAt: null,
						relatedPopulationGeneration: "newer-root",
					});
					yield* Deferred.succeed(resumeB, undefined);
					const newerResult = yield* Fiber.join(newer);
					assert(Result.isFailure(newerResult));
					expect(newerResult.failure.message).toBe("page failed");
					expect(yield* h.root).toMatchObject({
						relatedPopulatedAt: null,
						relatedPopulationGeneration: "newer-root",
					});
				}),
		);
	}

	test.effect("propagates related-workflow dispatch failures without stamping completion", () =>
		Effect.gen(function* () {
			const dispatchError = new SandboxRunError({
				kind: "infrastructure",
				message: "Related workflow dispatch unavailable",
			});
			const h = yield* harness("dispatch-failure", { dispatchError });
			const error = yield* h
				.populate(
					"dispatch-full",
					"ensure",
					rootDetails([group([related("first")], { continuation: "next" })]),
				)
				.pipe(Effect.flip);
			expect(error).toEqual(dispatchError);
			const root = yield* h.root;
			assert(root);
			expect(root.populatedAt).not.toBeNull();
			expect(root.relatedPopulatedAt).toBeNull();
			expect(yield* h.relatedRuns).toEqual([]);
		}),
	);

	test.effect("preserves sandbox boundary reasons from a failed related page", () =>
		Effect.gen(function* () {
			const h = yield* harness("boundary-failure");
			const error = yield* h
				.populate(
					"boundary-full",
					"ensure",
					rootDetails([group([related("first")], { continuation: "next" })]),
					() => ({
						...completed(null),
						error: {
							phase: "execute",
							message: "Budget exceeded",
							kind: "resource-unavailable",
							data: { operation: "httpCall", code: "execution-limit" },
						},
					}),
				)
				.pipe(Effect.flip);
			expect(error.kind).toBe("resource-unavailable");
			expect(error.data).toEqual({ operation: "httpCall", code: "execution-limit" });
			const root = yield* h.root;
			assert(root);
			expect(root.populatedAt).not.toBeNull();
			expect(root.relatedPopulatedAt).toBeNull();
		}),
	);

	test.effect(
		"keeps the base ready and completes successful sibling pages after a group fails",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("sibling-failure");
				const details = rootDetails([
					group([related("failed-first")], { continuation: "bad" }),
					group([related("successful-first")], {
						continuation: "good",
						relationshipSchemaSlug: "references",
					}),
				]);
				const error = yield* h
					.populate("sibling-full", "ensure", details, (continuation) =>
						continuation === "bad" ? "fail" : page([related("successful-last")], null),
					)
					.pipe(Effect.flip);
				expect(error.message).toBe("page failed");
				const root = yield* h.root;
				assert(root);
				expect(root.populatedAt).not.toBeNull();
				expect(root.relatedPopulatedAt).toBeNull();
				expect((yield* h.credits(root)).map(({ externalId }) => externalId)).toEqual([
					"failed-first",
				]);
				expect((yield* h.credits(root, "references")).map(({ externalId }) => externalId)).toEqual([
					"successful-first",
					"successful-last",
				]);
				expect((yield* h.relatedRuns).map(({ continuation }) => continuation)).toEqual([
					"bad",
					"good",
				]);
				expect(yield* h.published).toContain(encodeEntityUpdatedMessage(root.id, "populated"));
				expect(yield* h.published).toContain(
					encodeEntityUpdatedMessage(root.id, "enrichment-updated"),
				);
			}),
	);

	test.effect("rechecks completed group generations before stamping the related level", () =>
		Effect.gen(function* () {
			const h = yield* harness("superseded-final");
			const session = yield* DatabaseSession;
			const details = rootDetails([
				group([related("first")], { continuation: "credits" }),
				group([related("other")], {
					continuation: "references",
					relationshipSchemaSlug: "references",
				}),
			]);
			const error = yield* h
				.populate("superseded-full", "ensure", details, (continuation) =>
					continuation === "credits"
						? page([related("last")], null)
						: session
								.run((db) =>
									db
										.update(tables.relationshipSyncGeneration)
										.set({ generation: "newer-owner" })
										.where(eq(tables.relationshipSyncGeneration.relationshipSchemaSlug, "credits")),
								)
								.pipe(Effect.orDie, Effect.as(page([], null))),
				)
				.pipe(Effect.flip);
			expect(error.message).toBe("Provider population was superseded");
			const root = yield* h.root;
			assert(root);
			expect(root.populatedAt).not.toBeNull();
			expect(root.relatedPopulatedAt).toBeNull();
		}),
	);

	test.effect("publishes the base before related work and awaits every page and the sweep", () =>
		Effect.gen(function* () {
			const h = yield* harness("pages");
			const anchor = yield* seedRoot(h);
			expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
				"keep",
				"stale",
			]);
			const details = rootDetails([
				group([related("keep", "old"), related("first"), related("keep", "new")], {
					continuation: { page: 2 },
				}),
			]);

			const observed: Array<
				{ populatedAt: Date | null; relatedPopulatedAt: Date | null } | undefined
			> = [];
			const refreshed = yield* h.populate("refresh", "refresh", details, (continuation) =>
				h.status(anchor.id).pipe(
					Effect.orDie,
					Effect.tap((status) => Effect.sync(() => observed.push(status))),
					Effect.as(
						JSON.stringify(continuation) === JSON.stringify({ page: 2 })
							? page([related("second")], { page: 3 })
							: page([related("third")], null),
					),
				),
			);

			expect(refreshed.populatedAt).not.toBeNull();
			const [dispatch] = h.dispatched;
			expect(dispatch).toMatchObject({
				discard: undefined,
				tag: "ProviderRelatedPagesWorkflow",
				payload: { executionId: `related-${anchor.id}-0-refresh` },
			});
			expect(observed).toEqual(
				[0, 1].map(() => ({
					relatedPopulatedAt: null,
					populatedAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-14T00:00:00.000Z")),
				})),
			);

			expect((yield* h.relatedRuns).map(({ continuation }) => continuation)).toEqual([
				{ page: 2 },
				{ page: 3 },
			]);
			expect(new Set((yield* h.relatedRuns).map(({ executionId }) => executionId)).size).toBe(2);
			expect(yield* h.credits(anchor)).toEqual([
				{ externalId: "first", generation: "refresh", role: { role: "maker" } },
				{ externalId: "keep", role: { role: "new" }, generation: "refresh" },
				{ externalId: "second", generation: "refresh", role: { role: "maker" } },
				{ externalId: "third", generation: "refresh", role: { role: "maker" } },
			]);
			expect((yield* h.status(anchor.id))?.relatedPopulatedAt).toEqual(
				DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-14T00:00:00.000Z")),
			);
			expect(yield* h.published).toHaveLength(10);
			expect(yield* h.published).toContain(
				encodeEntityUpdatedMessage(anchor.id, "enrichment-updated"),
			);
		}),
	);

	test.effect("never sweeps additive groups", () =>
		Effect.gen(function* () {
			const h = yield* harness("additive");
			const anchor = yield* seedRoot(h);
			const details = rootDetails([
				group([related("keep", "new")], { continuation: { page: 2 }, synchronization: "additive" }),
			]);
			yield* h.populate("refresh", "refresh", details, () => page([related("more")], null));

			expect(yield* h.credits(anchor)).toEqual([
				{ externalId: "keep", role: { role: "old" }, generation: "refresh" },
				{ externalId: "more", generation: "refresh", role: { role: "maker" } },
				{ generation: "seed", externalId: "stale", role: { role: "maker" } },
			]);
		}),
	);

	test.effect("keeps earlier pages and skips the sweep when a later page fails", () =>
		Effect.gen(function* () {
			const h = yield* harness("failure");
			const anchor = yield* seedRoot(h);
			const details = rootDetails([group([related("first")], { continuation: { page: 2 } })]);
			const error = yield* h
				.populate("refresh", "refresh", details, (continuation) =>
					JSON.stringify(continuation) === JSON.stringify({ page: 2 })
						? page([related("second")], { page: 3 })
						: "fail",
				)
				.pipe(Effect.flip);
			expect(error.message).toBe("page failed");

			expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
				"first",
				"keep",
				"second",
				"stale",
			]);
			expect(yield* h.published).toHaveLength(7);
			expect((yield* h.status(anchor.id))?.relatedPopulatedAt).toBeNull();
		}),
	);

	test.effect("stops at the page limit without sweeping", () =>
		Effect.gen(function* () {
			const h = yield* harness("limit");
			const anchor = yield* seedRoot(h);
			const details = rootDetails([group([related("first")], { continuation: { page: 2 } })]);
			const error = yield* h
				.populate("refresh", "refresh", details, () => page([], { page: 0 }))
				.pipe(Effect.flip);
			expect(error.kind).toBe("invalid-output");
			expect(error.message).toBe("Related entity pages reached the page limit");

			expect(yield* h.relatedRuns).toHaveLength(RELATED_PAGES_MAX_PAGES - 1);
			expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
				"first",
				"keep",
				"stale",
			]);
		}),
	);

	test.effect("lets only the newest execution write or sweep when two interleave", () =>
		Effect.gen(function* () {
			const h = yield* harness("interleave");
			const anchor = yield* seedRoot(h);
			const older = rootDetails([group([related("older-a")], { continuation: { run: "old" } })]);
			const newer = rootDetails([
				group([related("newer-a"), related("keep")], { continuation: { run: "new" } }),
			]);
			yield* h.populate("older", "refresh", older).pipe(Effect.flip);
			yield* h.populate("newer", "refresh", newer, () => page([related("newer-b")], null));

			expect(yield* h.continuePages(0, older, () => page([related("older-b")], null))).toBe(
				"superseded",
			);
			expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
				"keep",
				"newer-a",
				"newer-b",
			]);

			expect(yield* h.continuePages(1, newer, () => page([related("newer-b")], null))).toBe(
				"complete",
			);
			expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
				"keep",
				"newer-a",
				"newer-b",
			]);
		}),
	);

	test.effect("replays the root and the page workflow without receipt conflicts", () =>
		Effect.gen(function* () {
			const h = yield* harness("replay");
			const anchor = yield* seedRoot(h);
			const details = rootDetails([group([related("first")], { continuation: { page: 2 } })]);
			const pages: RelatedPageHandler = (continuation) =>
				JSON.stringify(continuation) === JSON.stringify({ page: 2 })
					? page([related("second")], { page: 3 })
					: page([related("third")], null);

			yield* h.populate("refresh", "refresh", details, pages);
			yield* h.populate("refresh", "refresh", details, pages);
			yield* h.continuePages(0, details, pages);
			yield* h.continuePages(0, details, pages);

			expect(yield* h.credits(anchor)).toEqual(
				["first", "second", "third"].map((externalId) => ({
					externalId,
					generation: "refresh",
					role: { role: "maker" },
				})),
			);
		}),
	);

	test.effect("fails the population before writing when a continuation has no related script", () =>
		Effect.gen(function* () {
			const h = yield* harness("missing-script", { relatedScript: false });
			const session = yield* DatabaseSession;
			const details = rootDetails([group([related("unwritten")], { continuation: { page: 2 } })]);

			const error = yield* h.populate("refresh", "ensure", details).pipe(Effect.flip);

			expect(error.message).toBe("Pinned provider related script is unavailable");
			expect(h.dispatched).toEqual([]);
			expect(
				yield* session.run((db) =>
					db.select().from(tables.entity).where(eq(tables.entity.externalId, "unwritten")),
				),
			).toEqual([]);
		}),
	);
});
