import { expect } from "bun:test";

import type { FoldEventChange } from "@ryot-app/contract/modules/events/folds";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	PluginId,
	type PluginPackageId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { testPluginPackageId } from "@ryot-app/contract/testing";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { KERNEL_NAMESPACE } from "@ryot-app/i18n/message";
import { assert } from "@ryot-app/testing/assert";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { ScriptCalls } from "#modules/scripts/executions/calls";
import { FoldScriptsLive } from "#modules/scripts/executions/fold-scripts";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";
import * as tables from "#schema/tables/combined";

import { FoldMarks } from "./marks";
import { Folds } from "./service";

const userId = UserId.make("owner");

const authoredSchema = {
	fields: { value: { type: "string" as const, label: { key: "test.value" }, description: "Value" } },
};

const propertiesSchema = {
	fields: {
		value: {
			type: "string" as const,
			description: "Value",
			label: { key: "test.value", namespace: KERNEL_NAMESPACE },
		},
	},
};

const eventSchemaName = { key: "test.changed", namespace: KERNEL_NAMESPACE };

/** A revision whose entity folds its `changed` events, each of which projects the value it carries. */
const foldedPackage = (packageId: PluginPackageId, version: string, scriptHash = "fold") => {
	const plugin = revisionPackage("folded", "v1", "folded-entity", packageId);
	const [entity] = plugin.manifest.entitySchemas;
	assert(entity);
	const manifest = {
		...plugin.manifest,
		entitySchemas: [
			{
				...entity,
				fold: { scriptSlug: "folded.task", eventSchemaSlugs: ["changed"] as const },
				eventSchemas: [
					{
						slug: "changed",
						name: { key: "test.changed" },
						propertiesSchema: authoredSchema,
						projection: { propertiesSchema: authoredSchema },
					},
				],
			},
		],
	};
	return {
		...plugin,
		manifest,
		contentHash: `folded-${version}`,
		scripts: plugin.scripts.map((script) =>
			script.slug === "folded.task" ? { ...script, contentHash: scriptHash } : script,
		),
	};
};

type Recorded = { readonly subjectEntityId: string; readonly changes: null | ReadonlyArray<FoldEventChange> };

const testLayer = Layer.mergeAll(
	FoldScriptsLive,
	ScriptCalls.layer,
	EventsRepository.layer,
	EntitiesRepository.layer,
	FoldMarks.layer,
	JobQueue.layer,
).pipe(Layer.provideMerge(revisionDatabaseLayer));

/** Installs a fold that projects each changed event's value and counts its runs, recording every input. */
const setup = Effect.fn(function* () {
	const packageId = testPluginPackageId();
	const installed = yield* installRevisionPackage(foldedPackage(packageId, "v1"), userId);
	const recorded: Array<Recorded> = [];
	yield* (yield* ScriptCalls).install((call) =>
		Effect.sync(() => {
			const input = call.input as Recorded & { readonly value: null | { readonly runs: number } };
			recorded.push({ changes: input.changes, subjectEntityId: input.subjectEntityId });
			return {
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					changes: [],
					relationships: [],
					value: { runs: (input.value?.runs ?? 0) + 1 },
					events: (input.changes ?? []).flatMap(({ after }) =>
						after ? [{ eventId: after.id, properties: { value: after.properties["value"] } }] : [],
					),
				},
			};
		}),
	);
	const entities = yield* EntitiesRepository;
	const ids = [EntityId.make(yield* randomUuid), EntityId.make(yield* randomUuid)] as const;
	const session = yield* DatabaseSession;
	yield* session.transaction(
		entities.insertEntities(
			ids.map((id) => ({
				id,
				userId,
				name: id,
				scope: "user" as const,
				properties: {},
				populatedAt: null,
				entitySchemaPluginId: installed.pluginId,
				entitySchemaSlug: EntitySchemaSlug.make("folded-entity"),
			})),
		),
	);
	return { ids, recorded, installed, packageId };
});

const write = <A, E, R>(work: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const folds = yield* Folds.make;
		const session = yield* DatabaseSession;
		return yield* session
			.transaction(folds.within(work, () => Effect.void))
			.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
	});

const derived = (subject: string) =>
	Effect.flatMap(DatabaseSession, (session) =>
		session.run((db) =>
			db
				.select({ kind: tables.derivedValue.kind, targetId: tables.derivedValue.targetId, value: tables.derivedValue.value })
				.from(tables.derivedValue)
				.where(and(eq(tables.derivedValue.userId, userId), eq(tables.derivedValue.subjectEntityId, subject)))
				.orderBy(tables.derivedValue.kind, tables.derivedValue.targetId),
		),
	);

layer(testLayer)((test) => {
	test.effect(
		"replays a new subject, then passes before and after images and applies outputs as a patch",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const { ids, recorded, installed } = yield* setup();
					const [first, second] = ids;
					const events = yield* EventsRepository;
					const create = (eventId: EventId, entityId: EntityId, value: string) =>
						events.createEvents([
							{
								userId,
								entityId,
								propertiesSchema,
								id: eventId,
								properties: { value },
								eventSchemaName,
								eventSchemaPluginId: installed.pluginId,
								occurredAt: new Date("2026-01-01T00:00:00.000Z"),
								eventSchemaSlug: EventSchemaSlug.make("changed"),
							},
						]);
					const kept = EventId.make(yield* randomUuid);
					const moved = EventId.make(yield* randomUuid);
					yield* write(create(kept, first, "kept"));
					expect(recorded.at(-1)).toEqual({ subjectEntityId: first, changes: null });
					yield* write(create(moved, first, "moved"));
					expect(recorded.at(-1)?.changes).toMatchObject([
						{ before: null, after: { id: moved, entityId: first, properties: { value: "moved" } } },
					]);
					expect(yield* derived(first)).toEqual([
						{ kind: "event", targetId: moved, value: { value: "moved" } },
						{ kind: "subject", targetId: first, value: { runs: 2 } },
					]);
					yield* write(
						events.updatePreparedEvent({
							userId,
							propertiesSchema,
							eventId: moved,
							expectedRevision: 0,
							updatedAt: new Date(),
							draft: {
								entityId: second,
								sessionEntityId: null,
								properties: { value: "arrived" },
								eventSchemaSlug: EventSchemaSlug.make("changed"),
								eventSchemaPluginId: PluginId.make(installed.pluginId),
								entitySchemaPluginId: PluginId.make(installed.pluginId),
								entitySchemaSlug: EntitySchemaSlug.make("folded-entity"),
								occurredAt: IsoUtcString.make("2026-01-02T00:00:00.000Z"),
							},
						}),
					);
					const runs = recorded.slice(-2);
					expect(runs.find(({ subjectEntityId }) => subjectEntityId === second)?.changes).toBeNull();
					expect(runs.find(({ subjectEntityId }) => subjectEntityId === first)?.changes).toMatchObject([
						{ after: null, before: { id: moved, properties: { value: "moved" } } },
					]);
					expect(yield* derived(first)).toEqual([
						{ kind: "subject", targetId: first, value: { runs: 3 } },
					]);
					yield* write(events.deleteEvent({ userId, eventId: kept }));
					expect(recorded.at(-1)?.changes).toMatchObject([
						{ after: null, before: { id: kept, properties: { value: "kept" } } },
					]);
				}),
			),
		testTimeout,
	);

	test.effect(
		"queues a replay after an install only when the fold's script or event schemas change",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const { ids, installed, packageId } = yield* setup();
					const events = yield* EventsRepository;
					yield* write(
						events.createEvents([
							{
								userId,
								propertiesSchema,
								entityId: ids[0],
								properties: { value: "one" },
								id: EventId.make(yield* randomUuid),
								eventSchemaName,
								eventSchemaPluginId: installed.pluginId,
								occurredAt: new Date("2026-01-01T00:00:00.000Z"),
								eventSchemaSlug: EventSchemaSlug.make("changed"),
							},
						]),
					);
					const session = yield* DatabaseSession;
					const marks = yield* FoldMarks;
					const replays = session.run((db) =>
						db.select({ id: tables.job.id }).from(tables.job).where(eq(tables.job.kind, "fold-rebuild")),
					);
					const revisionOf = session.run((db) =>
						db
							.selectDistinct({ id: tables.derivedValue.pluginRevisionId })
							.from(tables.derivedValue)
							.where(eq(tables.derivedValue.subjectEntityId, ids[0])),
					);
					const reinstall = (version: string, scriptHash: string) =>
						Effect.gen(function* () {
							const next = yield* installRevisionPackage(
								foldedPackage(packageId, version, scriptHash),
								userId,
							);
							yield* session
								.transaction(
									marks.queueRevisionReplay({ userId, pluginId: PluginId.make(next.pluginId) }),
								)
								.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
							return next;
						});
					const same = yield* reinstall("v2", "fold");
					expect(yield* replays).toEqual([]);
					expect(yield* revisionOf).toEqual([{ id: same.revisionId }]);
					yield* reinstall("v3", "changed-fold");
					expect(yield* replays).toHaveLength(1);
				}),
			),
		testTimeout,
	);
});
