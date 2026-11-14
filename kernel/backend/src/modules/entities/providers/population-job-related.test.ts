import { expect } from "bun:test";

import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import type { ProviderRelatedInputs } from "@ryot-app/contract/modules/plugins/provider-inputs";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { ProviderDetailsRelatedEntityGroup } from "@ryot-app/plugin-backend-sdk/provider";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq } from "drizzle-orm";
import { DateTime, Deferred, Effect, Fiber, Layer, Ref, Result, Schema } from "effect";

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
import * as tables from "#schema/tables/combined";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { RELATED_PAGES_MAX_PAGES, runPopulationAttempt } from "./population-job";

const userId = UserId.make("relationship-owner");
const bottle = EntitySchemaSlug.make("bottle");
const label = EntitySchemaSlug.make("label");
const titleProperties = {
	fields: { title: { type: "string", label: "Title", description: "Title" } },
} as const;

const fixturePackage = (): NormalizedPlugin => {
	const source = revisionPackage("whiskey", "v1", bottle);
	return {
		...source,
		manifest: {
			...source.manifest,
			entitySchemas: [bottle, label].map((slug) => ({
				slug,
				name: slug,
				icon: "box",
				eventSchemas: [],
				propertiesSchema: titleProperties,
			})),
			relationshipSchemas: [
				...[
					{ anchor: bottle, slug: "credits" },
					{ anchor: bottle, slug: "references" },
					{ anchor: label, slug: "label-credits" },
				].map(({ slug, anchor }) => ({
					slug,
					name: "Credits",
					sourceEntitySchemaSlug: anchor,
					targetEntitySchemaSlug: "bottle",
					propertiesSchema: {
						fields: { role: { label: "Role", description: "Role", type: "string" as const } },
					},
				})),
				{
					name: "Labels",
					slug: "bottle-labels",
					targetEntitySchemaSlug: "label",
					sourceEntitySchemaSlug: "bottle",
					propertiesSchema: { fields: {} },
				},
			],
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
		relationshipSchemaSlug?: string;
		synchronization?: "additive" | "authoritative";
		coverage?: ProviderDetailsRelatedEntityGroup["coverage"];
	} = {},
) => ({
	entities,
	direction: "outgoing" as const,
	synchronization: options.synchronization ?? "authoritative",
	coverage: options.coverage ?? { status: "complete" as const },
	relationshipSchemaSlug: options.relationshipSchemaSlug ?? "credits",
});

const completed = (value: unknown) => ({
	value,
	logs: [],
	error: null,
	status: "completed" as const,
});

type PageResult = "fail" | SandboxExecutionResult;

const labelInputs: ProviderRelatedInputs = {
	label: {
		properties: ["title"],
		groups: [
			{
				direction: "outgoing",
				synchronization: "authoritative",
				relationshipSchemaSlug: "label-credits",
			},
		],
	},
};
type RelatedPageHandler = (continuation: JsonValue) => PageResult | Effect.Effect<PageResult>;

const harness = Effect.fnUntraced(function* (
	scope: string,
	config: { readonly relatedScript?: boolean; readonly relatedInputs?: ProviderRelatedInputs } = {},
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
	const subject = { userId, type: "user" as const };
	const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, subject);
	assert(pin?.pluginRevision);
	const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
	const commandFor = (executionId: string): DomainLifecycleCommand => ({
		...rootLifecycleCommand({
			source: "api",
			lane: "interactive",
			itemIdentity: executionId,
			accountUserId: subject.userId,
			initiator: { id: userId, kind: "user" },
			executionId: AutomationExecutionId.make(`${scope}-${executionId}`),
			occurredAt: executionId === "seed" ? "2026-10-13T00:00:00.000Z" : "2026-10-14T00:00:00.000Z",
		}),
		writeContext: principal,
	});
	const relatedRuns = yield* Ref.make<
		ReadonlyArray<{
			executionId: string;
			continuation: JsonValue;
			properties: Readonly<Record<string, JsonValue>>;
		}>
	>([]);
	const operations = (
		details: unknown,
		handler: RelatedPageHandler = () => "fail",
	): EntityImportWorkflowOperations["Service"] => ({
		completeProviderEntityImport: () => Effect.void,
		processSandbox: () => Effect.succeed(completed(details)),
		processProviderResolve: () => Effect.die("unexpected provider resolve"),
		preRegisterProviderImport: () => Effect.die("unexpected provider pre-registration"),
		resolveRelatedInputs: () =>
			config.relatedScript !== false
				? Effect.succeed(config.relatedInputs ?? null)
				: Effect.fail(
						new SandboxRunError({
							kind: "missing-artifact",
							message: "Pinned provider related script is unavailable",
						}),
					),
		processRelatedPage: (payload, executionId, continuation) =>
			Ref.update(relatedRuns, (all) => [
				...all,
				{ executionId, continuation, properties: payload.properties },
			]).pipe(
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
	const populate = (
		executionId: string,
		mode: "ensure" | "refresh",
		details: unknown,
		handler?: RelatedPageHandler,
		target: { readonly externalId: string; readonly entitySchemaSlug: EntitySchemaSlug } = {
			externalId: "root",
			entitySchemaSlug: bottle,
		},
	) =>
		runPopulationAttempt(
			{
				...target,
				mode,
				executionId,
				level: "full",
				requestAttempt: 1,
				requestId: executionId,
				providerId: provider.id,
				command: commandFor(executionId),
				entityScope: { userId, type: "user" },
				pluginId: PluginId.make(installed.pluginId),
			},
			executionId,
		).pipe(Effect.provideService(EntityImportWorkflowOperations, operations(details, handler)));
	const credits = (anchor: Pick<ListedEntity, "id">, relationshipSchemaSlug = "credits") =>
		session
			.run((db) =>
				db
					.select({ role: tables.relationship.properties, externalId: tables.entity.externalId })
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
						.map(({ role, externalId }) => ({ role, externalId }))
						.sort((left, right) => String(left.externalId).localeCompare(String(right.externalId))),
				),
			);
	const stored = (externalId: string) =>
		session
			.run((db) =>
				db
					.select()
					.from(tables.entity)
					.where(
						and(
							eq(tables.entity.externalId, externalId),
							eq(tables.entity.entitySchemaPluginId, installed.pluginId),
						),
					),
			)
			.pipe(Effect.map(([row]) => (row ? { ...row, id: EntityId.make(row.id) } : null)));
	return {
		stored,
		credits,
		populate,
		root: stored("root"),
		relatedRuns: Ref.get(relatedRuns),
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
	coverage: ProviderDetailsRelatedEntityGroup["coverage"],
) => completed({ entities, coverage });

const labelOne = { externalId: "label-1", entitySchemaSlug: label };

const seedLabel = (h: Effect.Success<ReturnType<typeof harness>>) =>
	h.populate("seed-child", "ensure", {
		name: "Root",
		relatedEntityGroups: [],
		properties: { title: "Root" },
		expectedChildEntitySchemaSlug: label,
		childEntities: [{ ...labelOne, name: "Label", properties: { title: "Label one" } }],
	});

const seedRoot = (h: Effect.Success<ReturnType<typeof harness>>) =>
	h.populate("seed", "ensure", rootDetails([group([related("stale"), related("keep", "old")])]));

layer(
	Layer.merge(
		relationshipDatabaseLayer(),
		Layer.mock(EnrichmentRequests)({
			attachEntity: () => Effect.void,
			guardPopulation: () => Effect.void,
			recordBaseCheck: () => Effect.void,
			requesterIds: () => Effect.succeed([]),
		}),
	),
)((test) => {
	test.effect(
		"rejects a stale completion after a newer root commits",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("root-generation");
				yield* seedRoot(h);
				const aReady = yield* Deferred.make<void>();
				const resumeA = yield* Deferred.make<void>();
				const bReady = yield* Deferred.make<void>();
				const resumeB = yield* Deferred.make<void>();
				const older = yield* h
					.populate(
						"older-root",
						"refresh",
						rootDetails([
							group([related("older-first")], {
								coverage: { status: "more", continuation: "older" },
							}),
						]),
						() =>
							Deferred.succeed(aReady, undefined).pipe(
								Effect.andThen(Deferred.await(resumeA)),
								Effect.as(page([related("older-last")], { status: "complete" })),
							),
					)
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.result, Effect.forkChild);
				yield* Deferred.await(aReady);
				const newer = yield* h
					.populate(
						"newer-root",
						"refresh",
						rootDetails([
							group([related("newer-first")], {
								coverage: { status: "more", continuation: "newer" },
							}),
						]),
						() =>
							Deferred.succeed(bReady, undefined).pipe(
								Effect.andThen(Deferred.await(resumeB)),
								Effect.as<PageResult>("fail"),
							),
					)
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.result, Effect.forkChild);
				yield* Deferred.await(bReady);
				expect(yield* h.root).toMatchObject({
					relatedPopulatedAt: null,
					relatedPopulationGeneration: "newer-root",
				});
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
		testTimeout,
	);

	test.effect(
		"preserves sandbox boundary reasons from a failed related page",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("boundary-failure");
				const error = yield* h
					.populate(
						"boundary-full",
						"ensure",
						rootDetails([
							group([related("first")], { coverage: { status: "more", continuation: "next" } }),
						]),
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
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.flip);
				expect(error.kind).toBe("resource-unavailable");
				expect(error.data).toEqual({ operation: "httpCall", code: "execution-limit" });
				const root = yield* h.root;
				assert(root);
				expect(root.populatedAt).not.toBeNull();
				expect(root.relatedPopulatedAt).toBeNull();
			}),
		testTimeout,
	);

	test.effect(
		"keeps the base ready and completes successful sibling pages after a group fails",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("sibling-failure");
				const details = rootDetails([
					group([related("failed-first")], { coverage: { status: "more", continuation: "bad" } }),
					group([related("successful-first")], {
						relationshipSchemaSlug: "references",
						coverage: { status: "more", continuation: "good" },
					}),
				]);
				const error = yield* h
					.populate("sibling-full", "ensure", details, (continuation) =>
						continuation === "bad"
							? "fail"
							: page([related("successful-last")], { status: "complete" }),
					)
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.flip);
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
			}),
		testTimeout,
	);

	test.effect(
		"rechecks the population generation before stamping the related level",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("superseded-final");
				const session = yield* DatabaseSession;
				const details = rootDetails([
					group([related("first")], { coverage: { status: "more", continuation: "credits" } }),
					group([related("other")], {
						relationshipSchemaSlug: "references",
						coverage: { status: "more", continuation: "references" },
					}),
				]);
				const error = yield* h
					.populate("superseded-full", "ensure", details, (continuation) =>
						continuation === "credits"
							? page([related("last")], { status: "complete" })
							: session
									.run((db) =>
										db
											.update(tables.entity)
											.set({ relatedPopulationGeneration: "newer-owner" })
											.where(eq(tables.entity.relatedPopulationGeneration, "superseded-full")),
									)
									.pipe(Effect.orDie, Effect.as(page([], { status: "complete" }))),
					)
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.flip);
				expect(error.message).toBe("Provider population was superseded");
				const root = yield* h.root;
				assert(root);
				expect(root.populatedAt).not.toBeNull();
				expect(root.relatedPopulatedAt).toBeNull();
			}),
		testTimeout,
	);

	test.effect(
		"rejects source-limited groups without sweeping or stamping while siblings finish",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("source-limited-group");
				const anchor = yield* seedRoot(h);
				const priorCredits = yield* h.credits(anchor);
				const priorRoot = yield* h.root;
				assert(priorRoot);
				const reason = "the source does not expose the complete inventory";
				const details = rootDetails([
					group([related("unwritten")], { coverage: { reason, status: "source-limited" } }),
					group([related("sibling-first")], {
						relationshipSchemaSlug: "references",
						coverage: { status: "more", continuation: "sibling" },
					}),
				]);
				const error = yield* h
					.populate("refresh-source-limited", "refresh", details, () =>
						page([related("sibling-last")], { status: "complete" }),
					)
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.flip);

				expect(error.kind).toBe("invalid-output");
				expect(error.message).toBe(`Provider inventory credits is source-limited: ${reason}`);
				expect(yield* h.credits(anchor)).toEqual(priorCredits);
				expect(
					(yield* h.credits(anchor, "references")).map(({ externalId }) => externalId),
				).toEqual(["sibling-first", "sibling-last"]);
				const currentRoot = yield* h.root;
				assert(currentRoot);
				expect(currentRoot.properties).toEqual(priorRoot.properties);
				expect((yield* h.status(anchor.id))?.relatedPopulatedAt).toBeNull();
				expect((yield* h.relatedRuns).map(({ continuation }) => continuation)).toEqual(["sibling"]);
			}),
		testTimeout,
	);

	test.effect(
		"publishes the base before related work and awaits every page and the sweep",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("pages");
				const anchor = yield* seedRoot(h);
				expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
					"keep",
					"stale",
				]);
				const details = rootDetails([
					group([related("keep", "old"), related("first"), related("keep", "new")], {
						coverage: { status: "more", continuation: { page: 2 } },
					}),
				]);

				const observed: Array<
					undefined | { populatedAt: Date | null; relatedPopulatedAt: Date | null }
				> = [];
				const refreshed = yield* h.populate("refresh", "refresh", details, (continuation) =>
					h.status(anchor.id).pipe(
						Effect.orDie,
						Effect.tap((status) => Effect.sync(() => observed.push(status))),
						Effect.as(
							JSON.stringify(continuation) === JSON.stringify({ page: 2 })
								? page([related("second")], { status: "more", continuation: { page: 3 } })
								: page([related("third")], { status: "complete" }),
						),
					),
				);

				expect(refreshed.populatedAt).not.toBeNull();
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
					{ externalId: "first", role: { role: "maker" } },
					{ externalId: "keep", role: { role: "new" } },
					{ externalId: "second", role: { role: "maker" } },
					{ externalId: "third", role: { role: "maker" } },
				]);
				expect((yield* h.status(anchor.id))?.relatedPopulatedAt).toEqual(
					DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-14T00:00:00.000Z")),
				);
			}),
		testTimeout,
	);

	test.effect(
		"never sweeps additive groups",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("additive");
				const anchor = yield* seedRoot(h);
				const details = rootDetails([
					group([related("keep", "new")], {
						synchronization: "additive",
						coverage: { status: "more", continuation: { page: 2 } },
					}),
				]);
				yield* h.populate("refresh", "refresh", details, () =>
					page([related("more")], { status: "complete" }),
				);

				expect(yield* h.credits(anchor)).toEqual([
					{ externalId: "keep", role: { role: "old" } },
					{ externalId: "more", role: { role: "maker" } },
					{ externalId: "stale", role: { role: "maker" } },
				]);
			}),
		testTimeout,
	);

	test.effect(
		"keeps earlier pages and skips the sweep when a later page fails",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("failure");
				const anchor = yield* seedRoot(h);
				const details = rootDetails([
					group([related("first")], { coverage: { status: "more", continuation: { page: 2 } } }),
				]);
				const error = yield* h
					.populate("refresh", "refresh", details, (continuation) =>
						JSON.stringify(continuation) === JSON.stringify({ page: 2 })
							? page([related("second")], { status: "more", continuation: { page: 3 } })
							: "fail",
					)
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.flip);
				expect(error.message).toBe("page failed");

				expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
					"first",
					"keep",
					"second",
					"stale",
				]);
				expect((yield* h.status(anchor.id))?.relatedPopulatedAt).toBeNull();
			}),
		testTimeout,
	);

	test.effect(
		"keeps prior rows and earlier pages when a later page is source-limited",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("source-limited-page");
				const anchor = yield* seedRoot(h);
				const details = rootDetails([
					group([related("first")], { coverage: { status: "more", continuation: { page: 2 } } }),
				]);
				const reason = "the provider stopped before the final page";
				const error = yield* h
					.populate("refresh", "refresh", details, () =>
						page([related("limited-page")], { reason, status: "source-limited" }),
					)
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.flip);

				expect(error.kind).toBe("invalid-output");
				expect(error.message).toBe(`Provider inventory credits is source-limited: ${reason}`);
				expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
					"first",
					"keep",
					"stale",
				]);
				expect(yield* h.credits(anchor)).toContainEqual({
					externalId: "keep",
					role: { role: "old" },
				});
				expect(
					(yield* h.credits(anchor)).some(({ externalId }) => externalId === "limited-page"),
				).toBe(false);
				expect(yield* h.relatedRuns).toHaveLength(1);
				expect((yield* h.status(anchor.id))?.relatedPopulatedAt).toBeNull();
			}),
		testTimeout,
	);

	test.effect(
		"rejects a repeated related-page cursor before fetching it again",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("repeated-cursor");
				const anchor = yield* seedRoot(h);
				const details = rootDetails([
					group([related("first")], { coverage: { status: "more", continuation: { page: 2 } } }),
				]);
				const error = yield* h
					.populate("refresh", "refresh", details, () =>
						page([related("second")], { status: "more", continuation: { page: 2 } }),
					)
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.flip);

				expect(error.kind).toBe("invalid-output");
				expect(error.message).toBe(
					"Related entity pages repeated a continuation without completing",
				);
				expect(yield* h.relatedRuns).toHaveLength(1);
				expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toContain("stale");
				expect((yield* h.status(anchor.id))?.relatedPopulatedAt).toBeNull();
			}),
		testTimeout,
	);

	test.effect(
		"stops at the page limit without sweeping",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("limit");
				const anchor = yield* seedRoot(h);
				const details = rootDetails([
					group([related("first")], { coverage: { status: "more", continuation: { page: 2 } } }),
				]);
				let nextPage = 3;
				const error = yield* h
					.populate("refresh", "refresh", details, () =>
						page([], { status: "more", continuation: { page: nextPage++ } }),
					)
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.flip);
				expect(error.kind).toBe("invalid-output");
				expect(error.message).toBe("Related entity pages reached the page limit");

				expect(yield* h.relatedRuns).toHaveLength(RELATED_PAGES_MAX_PAGES - 1);
				expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
					"first",
					"keep",
					"stale",
				]);
			}),
		testTimeout,
	);

	test.effect(
		"lets only the newest execution write or sweep when two interleave",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("interleave");
				const anchor = yield* seedRoot(h);
				const olderPaused = yield* Deferred.make<void>();
				const resumeOlder = yield* Deferred.make<void>();
				const older = yield* h
					.populate(
						"older",
						"refresh",
						rootDetails([
							group([related("older-a")], {
								coverage: { status: "more", continuation: { run: "old" } },
							}),
						]),
						() =>
							Deferred.succeed(olderPaused, undefined).pipe(
								Effect.andThen(Deferred.await(resumeOlder)),
								Effect.as(page([related("older-b")], { status: "complete" })),
							),
					)
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.flip, Effect.forkChild);
				yield* Deferred.await(olderPaused);
				yield* h.populate(
					"newer",
					"refresh",
					rootDetails([
						group([related("newer-a"), related("keep")], {
							coverage: { status: "more", continuation: { run: "new" } },
						}),
					]),
					() => page([related("newer-b")], { status: "complete" }),
				);
				yield* Deferred.succeed(resumeOlder, undefined);
				expect((yield* Fiber.join(older)).message).toBe("Provider population was superseded");
				expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
					"keep",
					"newer-a",
					"newer-b",
				]);
			}),
		testTimeout,
	);

	test.effect(
		"repeats an attempt without identity conflicts",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("replay");
				const anchor = yield* seedRoot(h);
				const details = rootDetails([
					group([related("first")], { coverage: { status: "more", continuation: { page: 2 } } }),
				]);
				const pages: RelatedPageHandler = (continuation) =>
					JSON.stringify(continuation) === JSON.stringify({ page: 2 })
						? page([related("second")], { status: "more", continuation: { page: 3 } })
						: page([related("third")], { status: "complete" });

				yield* h.populate("refresh", "refresh", details, pages);
				yield* h.populate("refresh", "refresh", details, pages);

				expect(yield* h.credits(anchor)).toEqual(
					["first", "second", "third"].map((externalId) => ({
						externalId,
						role: { role: "maker" },
					})),
				);
			}),
		testTimeout,
	);

	test.effect(
		"fails the population before writing when a continuation has no related script",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("missing-script", { relatedScript: false });
				const session = yield* DatabaseSession;
				const details = rootDetails([
					group([related("unwritten")], {
						coverage: { status: "more", continuation: { page: 2 } },
					}),
				]);

				const error = yield* h
					.populate("refresh", "ensure", details)
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.flip);

				expect(error.message).toBe("Pinned provider related script is unavailable");
				expect(
					yield* session.run((db) =>
						db.select().from(tables.entity).where(eq(tables.entity.externalId, "unwritten")),
					),
				).toEqual([]);
			}),
		testTimeout,
	);

	test.effect(
		"populates a child's declared related groups from its selected properties",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("child", { relatedInputs: labelInputs });
				yield* seedLabel(h);
				const child = yield* h.stored("label-1");
				assert(child);
				expect(child.relatedPopulatedAt).toBeNull();

				yield* h.populate(
					"child-full",
					"ensure",
					null,
					(continuation) =>
						continuation === null
							? page([related("maker")], { status: "more", continuation: "next" })
							: page([related("bottler", "bottler")], { status: "complete" }),
					labelOne,
				);
				expect(yield* h.relatedRuns).toEqual([
					{
						continuation: null,
						properties: { title: "Label one" },
						executionId: "child-full-sandbox-related-0-0",
					},
					{
						continuation: "next",
						properties: { title: "Label one" },
						executionId: "child-full-sandbox-related-0-1",
					},
				]);
				expect(
					(yield* h.credits(child, "label-credits")).map(({ externalId }) => externalId),
				).toEqual(["bottler", "maker"]);
				expect((yield* h.stored("label-1"))?.relatedPopulatedAt).not.toBeNull();

				yield* h.populate(
					"child-refresh",
					"refresh",
					null,
					() => page([related("maker")], { status: "complete" }),
					labelOne,
				);
				expect(
					(yield* h.credits(child, "label-credits")).map(({ externalId }) => externalId),
				).toEqual(["maker"]);
			}),
		testTimeout,
	);

	test.effect(
		"refuses a child whose related script declares no groups for its schema",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("undeclared-child");
				yield* seedLabel(h);

				const error = yield* h
					.populate("child-full", "ensure", null, undefined, labelOne)
					.pipe(Effect.catchTag("DbError", Effect.die), Effect.flip);

				expect(error.message).toBe("Provider declares no related groups for entity schema 'label'");
				expect(yield* h.relatedRuns).toEqual([]);
			}),
		testTimeout,
	);
});
