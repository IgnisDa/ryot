import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntitySchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { and, eq } from "drizzle-orm";
import { Effect, Ref, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/packages/types";
import { relationshipDatabaseLayer } from "#modules/relationships/lifecycle.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import * as tables from "#schema/tables/combined";
import { makeRedisService, makeWorkflowActivityEngine } from "#testing/effect";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import {
	ProviderEntityPopulationWorkflow,
	ProviderRelatedPagesPayload,
	ProviderRelatedPagesWorkflow,
	RELATED_PAGES_MAX_PAGES,
	runProviderEntityPopulationWorkflow,
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
			relationshipSchemas: [
				{
					slug: "credits",
					name: "Credits",
					sourceEntitySchemaSlug: "bottle",
					targetEntitySchemaSlug: "bottle",
					propertiesSchema: {
						fields: { role: { label: "Role", type: "string", description: "Role" } },
					},
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
	options: { continuation?: JsonValue; synchronization?: "additive" | "authoritative" } = {},
) => ({
	entities,
	direction: "outgoing" as const,
	relationshipSchemaSlug: "credits",
	synchronization: options.synchronization ?? "authoritative",
	...(options.continuation === undefined ? {} : { continuation: options.continuation }),
});

const completed = (value: unknown) => ({
	value,
	logs: [],
	error: null,
	status: "completed" as const,
});

type RelatedPageHandler = (continuation: JsonValue) => ReturnType<typeof completed> | "fail";

const harness = Effect.fnUntraced(function* (scope: string, relatedScript = true) {
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
			occurredAt: "2026-10-13T00:00:00.000Z",
			initiator: { id: userId, kind: "user" },
			accountGeneration: subject.accountGeneration,
			executionId: AutomationExecutionId.make(`${scope}-${executionId}`),
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
			relatedScript
				? Effect.void
				: Effect.fail(
						new SandboxRunError({
							kind: "missing-artifact",
							message: "Pinned provider related script is unavailable",
						}),
					),
		processRelatedPage: (_payload, executionId, continuation) =>
			Ref.update(relatedRuns, (all) => [...all, { executionId, continuation }]).pipe(
				Effect.map(() => handler(continuation)),
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
	const redis = makeRedisService({
		publish: (_channel, message) =>
			Ref.update(published, (all) => [...all, message]).pipe(Effect.as(1)),
	});
	const populate = (
		executionId: string,
		mode: "ensure" | "refresh",
		details: unknown,
		handler?: RelatedPageHandler,
	) => {
		const instance = WorkflowInstance.initial(ProviderEntityPopulationWorkflow, executionId);
		const engine = makeWorkflowActivityEngine(instance, {
			execute: (workflow, options) =>
				Effect.sync(() => {
					dispatched.push({
						tag: workflow._tag,
						payload: options.payload,
						discard: options.discard,
					});
					return options.executionId;
				}),
		});
		return runProviderEntityPopulationWorkflow(
			{
				mode,
				executionId,
				externalId: "root",
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
			Effect.provideService(RedisService, redis),
			Effect.provideService(EntityImportWorkflowOperations, operations(details, handler)),
		);
	};
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
	const credits = (anchor: ListedEntity) =>
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
							eq(tables.relationship.relationshipSchemaSlug, "credits"),
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

layer(relationshipDatabaseLayer())((test) => {
	test.effect(
		"returns after the root stamp and first page, then pages in a separate workflow and sweeps",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("pages");
				const anchor = yield* seedRoot(h);
				expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
					"keep",
					"stale",
				]);
				const details = rootDetails([
					group([related("keep", "new"), related("first")], { continuation: { page: 2 } }),
				]);

				const refreshed = yield* h.populate("refresh", "refresh", details);

				expect(refreshed.populatedAt).not.toBeNull();
				const [dispatch] = h.dispatched;
				expect(dispatch).toMatchObject({
					discard: true,
					tag: "ProviderRelatedPagesWorkflow",
					payload: { executionId: `related-${anchor.id}-0-refresh` },
				});
				expect(yield* h.published).toHaveLength(2);
				expect(yield* h.relatedRuns).toEqual([]);
				expect(yield* h.credits(anchor)).toEqual([
					{ externalId: "first", generation: "refresh", role: { role: "maker" } },
					{ externalId: "keep", role: { role: "new" }, generation: "refresh" },
					{ generation: null, externalId: "stale", role: { role: "maker" } },
				]);

				yield* h.continuePages(0, details, (continuation) =>
					JSON.stringify(continuation) === JSON.stringify({ page: 2 })
						? page([related("second")], { page: 3 })
						: page([related("third")], null),
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
				expect(yield* h.published).toHaveLength(3);
			}),
	);

	test.effect("never sweeps additive groups", () =>
		Effect.gen(function* () {
			const h = yield* harness("additive");
			const anchor = yield* seedRoot(h);
			const details = rootDetails([
				group([related("keep", "new")], { continuation: { page: 2 }, synchronization: "additive" }),
			]);
			yield* h.populate("refresh", "refresh", details);
			yield* h.continuePages(0, details, () => page([related("more")], null));

			expect(yield* h.credits(anchor)).toEqual([
				{ externalId: "keep", role: { role: "old" }, generation: "refresh" },
				{ externalId: "more", generation: "refresh", role: { role: "maker" } },
				{ generation: null, externalId: "stale", role: { role: "maker" } },
			]);
		}),
	);

	test.effect("keeps earlier pages and skips the sweep when a later page fails", () =>
		Effect.gen(function* () {
			const h = yield* harness("failure");
			const anchor = yield* seedRoot(h);
			const details = rootDetails([group([related("first")], { continuation: { page: 2 } })]);
			yield* h.populate("refresh", "refresh", details);

			yield* h.continuePages(0, details, (continuation) =>
				JSON.stringify(continuation) === JSON.stringify({ page: 2 })
					? page([related("second")], { page: 3 })
					: "fail",
			);

			expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
				"first",
				"keep",
				"second",
				"stale",
			]);
			expect(yield* h.published).toHaveLength(3);
		}),
	);

	test.effect("stops at the page limit without sweeping", () =>
		Effect.gen(function* () {
			const h = yield* harness("limit");
			const anchor = yield* seedRoot(h);
			const details = rootDetails([group([related("first")], { continuation: { page: 2 } })]);
			yield* h.populate("refresh", "refresh", details);

			yield* h.continuePages(0, details, () => page([], { page: 0 }));

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
			yield* h.populate("older", "refresh", older);
			yield* h.populate("newer", "refresh", newer);

			yield* h.continuePages(0, older, () => page([related("older-b")], null));
			expect((yield* h.credits(anchor)).map(({ externalId }) => externalId)).toEqual([
				"keep",
				"newer-a",
				"older-a",
				"stale",
			]);

			yield* h.continuePages(1, newer, () => page([related("newer-b")], null));
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

			yield* h.populate("refresh", "refresh", details);
			yield* h.populate("refresh", "refresh", details);
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
			const h = yield* harness("missing-script", false);
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
