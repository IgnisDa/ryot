import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { EventSchemaSlug, IntegrationId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { assert } from "@ryot-app/testing/assert";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Layer } from "effect";

import { decidingPolicies, policyFixture } from "#modules/automations/lifecycle.test-support";
import { LifecyclePolicies } from "#modules/automations/lifecycle/policies";
import { ChangeSets } from "#modules/changes/service";
import {
	eventGroupFixture,
	eventGroupWorkflowLayer,
} from "#modules/events/event-groups.test-support";
import { command } from "#modules/relationships/lifecycle.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { IntegrationEventStreamRepository } from "./integration-event-stream-repository";
import { IntegrationEventWrites } from "./integration-event-writes";

const progress = EventSchemaSlug.make("progress");
const interval = { intervalSeconds: 600, kind: "sample" as const };

const streamFixture = Effect.fnUntraced(function* () {
	const fixture = yield* eventGroupFixture([
		{
			slug: progress,
			name: { key: "test.progress" },
			propertiesSchema: {
				fields: { value: { type: "number", description: "Value", label: { key: "test.value" } } },
			},
		},
	]);
	const integrationId = IntegrationId.make(yield* randomUuid);
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db
			.insert(tables.integration)
			.values({
				lot: "sink",
				id: integrationId,
				provider: "data-json",
				providerSpecifics: {},
				userId: fixture.userId,
				clientProviderSpecifics: {},
				webhookToken: integrationId,
				extraSettings: { disableOnContinuousErrors: false },
			}),
	);
	const key = {
		integrationId,
		userId: fixture.userId,
		eventSchemaSlug: progress,
		entityId: fixture.subjectId,
	};
	const events = session.run((db) =>
		db
			.select({ properties: tables.event.properties })
			.from(tables.event)
			.where(
				and(
					eq(tables.event.entityId, fixture.subjectId),
					eq(tables.event.eventSchemaSlug, progress),
				),
			),
	);
	const sample = Effect.fnUntraced(function* (
		writes: IntegrationEventWrites["Service"],
		input: {
			readonly value: unknown;
			readonly identity?: string;
			readonly observedAt: string;
			readonly coalescing?: Parameters<IntegrationEventWrites["Service"]["apply"]>[0]["coalescing"];
		},
	) {
		return yield* writes.apply({
			key,
			identity: input.identity ?? (yield* randomUuid),
			coalescing: input.coalescing ?? { ...interval, fingerprint: String(input.value) },
			event: {
				entityId: key.entityId,
				eventSchemaSlug: progress,
				properties: { value: input.value },
			},
			command: {
				...fixture.command,
				...command(yield* randomUuid),
				writeContext: fixture.command.writeContext,
				accountUserId: fixture.command.accountUserId,
				occurredAt: IsoUtcString.make(input.observedAt),
			},
		});
	});
	const stream = Effect.flatMap(IntegrationEventStreamRepository.make, (streams) =>
		streams.read(key),
	);
	return { key, events, sample, stream, session };
});

const flushJobs = Effect.flatMap(DatabaseSession, (session) =>
	session.run((db) =>
		db
			.select({ payload: tables.job.payload })
			.from(tables.job)
			.where(eq(tables.job.kind, "integration-event-flush")),
	),
);

const at = (minute: number) => `2026-09-15T00:${String(minute).padStart(2, "0")}:00.000Z`;

const testLayer = Layer.provideMerge(
	IntegrationEventWrites.layer.pipe(Layer.provideMerge(eventGroupWorkflowLayer)),
	BunCrypto.layerSecureRandom,
);

layer(testLayer)((test) => {
	test.effect(
		"stores a sample within its interval as pending and schedules its flush",
		() =>
			Effect.gen(function* () {
				const writes = yield* IntegrationEventWrites;
				const fixture = yield* streamFixture();
				expect((yield* fixture.sample(writes, { value: 1, observedAt: at(1) })).count).toBe(1);
				expect((yield* fixture.sample(writes, { value: 2, observedAt: at(2) })).count).toBe(0);
				expect(yield* fixture.events).toEqual([{ properties: { value: 1 } }]);
				const stream = yield* fixture.stream;
				expect(stream?.pending).toMatchObject({ event: { properties: { value: 2 } } });
				assert(stream?.eligibleAt);
				expect(yield* flushJobs).toContainEqual({
					payload: { ...fixture.key, dueAt: stream.eligibleAt.toISOString() },
				});
			}),
		testTimeout,
	);

	test.effect(
		"leaves a sample with the written fingerprint unchanged and clears its pending sample",
		() =>
			Effect.gen(function* () {
				const writes = yield* IntegrationEventWrites;
				const fixture = yield* streamFixture();
				yield* fixture.sample(writes, { value: 1, observedAt: at(1) });
				yield* fixture.sample(writes, { value: 2, observedAt: at(2) });
				expect((yield* fixture.sample(writes, { value: 1, observedAt: at(3) })).count).toBe(0);
				expect(yield* fixture.events).toHaveLength(1);
				expect(yield* fixture.stream).toMatchObject({ pending: null, fingerprint: "1" });
			}),
		testTimeout,
	);

	test.effect(
		"always writes a boundary event",
		() =>
			Effect.gen(function* () {
				const writes = yield* IntegrationEventWrites;
				const fixture = yield* streamFixture();
				const boundary = { kind: "boundary" as const };
				yield* fixture.sample(writes, { value: 1, observedAt: at(1) });
				for (const [minute, value] of [
					[2, 2],
					[3, 3],
				] as const) {
					expect(
						(yield* fixture.sample(writes, { value, coalescing: boundary, observedAt: at(minute) }))
							.count,
					).toBe(1);
				}
				expect(yield* fixture.events).toHaveLength(3);
			}),
		testTimeout,
	);

	test.effect(
		"ignores a sample observed before the stream",
		() =>
			Effect.gen(function* () {
				const writes = yield* IntegrationEventWrites;
				const fixture = yield* streamFixture();
				yield* fixture.sample(writes, { value: 1, observedAt: at(5) });
				expect((yield* fixture.sample(writes, { value: 2, observedAt: at(4) })).count).toBe(0);
				expect(yield* fixture.events).toHaveLength(1);
				expect(yield* fixture.stream).toMatchObject({ pending: null, fingerprint: "1" });
			}),
		testTimeout,
	);

	test.effect(
		"replays an applied sample's recorded result without writing it again",
		() =>
			Effect.gen(function* () {
				const writes = yield* IntegrationEventWrites;
				const fixture = yield* streamFixture();
				const identity = yield* randomUuid;
				const first = yield* fixture.sample(writes, { identity, value: 1, observedAt: at(1) });
				const replay = yield* fixture.sample(writes, { identity, value: 1, observedAt: at(1) });
				expect(first.count).toBe(1);
				expect(replay).toEqual(first);
				expect(yield* fixture.events).toHaveLength(1);
			}),
		testTimeout,
	);

	test.effect(
		"flushes only the current pending sample once it is due",
		() =>
			Effect.gen(function* () {
				const writes = yield* IntegrationEventWrites;
				const fixture = yield* streamFixture();
				yield* fixture.sample(writes, { value: 1, observedAt: at(1) });
				yield* fixture.sample(writes, { value: 2, observedAt: at(2) });
				yield* fixture.sample(writes, { value: 3, observedAt: at(3) });
				const pending = yield* fixture.stream;
				assert(pending?.eligibleAt);
				yield* writes.flush({ ...fixture.key, dueAt: IsoUtcString.make(at(59)) });
				expect(yield* fixture.events).toHaveLength(1);
				yield* writes.flush({
					...fixture.key,
					dueAt: IsoUtcString.make(pending.eligibleAt.toISOString()),
				});
				expect(yield* fixture.events).toEqual([
					{ properties: { value: 1 } },
					{ properties: { value: 3 } },
				]);
				expect(yield* fixture.stream).toMatchObject({ pending: null, fingerprint: "3" });
			}),
		testTimeout,
	);

	test.effect(
		"clears a pending sample whose flush is refused",
		() =>
			Effect.gen(function* () {
				const writes = yield* IntegrationEventWrites;
				const fixture = yield* streamFixture();
				yield* fixture.sample(writes, { value: 1, observedAt: at(1) });
				yield* fixture.sample(writes, { value: "invalid", observedAt: at(2) });
				const pending = yield* fixture.stream;
				assert(pending?.eligibleAt && pending.pending);
				yield* writes.flush({
					...fixture.key,
					dueAt: IsoUtcString.make(pending.eligibleAt.toISOString()),
				});
				expect(yield* fixture.events).toHaveLength(1);
				expect(yield* fixture.stream).toMatchObject({ pending: null, fingerprint: "1" });
			}),
		testTimeout,
	);

	test.effect(
		"re-checks the stream after policies and skips a sample a newer one superseded",
		() =>
			Effect.gen(function* () {
				const fixture = yield* streamFixture();
				let policyRuns = 0;
				const streams = yield* IntegrationEventStreamRepository.make;
				const supersede = fixture.session.transaction(
					streams.write(fixture.key, {
						pending: null,
						eligibleAt: null,
						fingerprint: "newer",
						observedAt: DateTime.toDateUtc(DateTime.makeUnsafe(at(9))),
					}),
				);
				const writes = yield* IntegrationEventWrites.make.pipe(
					Effect.provideServiceEffect(
						ChangeSets,
						ChangeSets.make.pipe(
							Effect.provideService(
								LifecyclePolicies,
								decidingPolicies(
									() =>
										Effect.succeed([
											policyFixture(
												0,
												[
													{
														resource: "event",
														operation: "create",
														eventSchemaSlug: progress,
														entitySchemaSlug: "subject",
													},
												],
												fixture.key.userId,
											),
										]),
									() =>
										Effect.sync(() => {
											policyRuns += 1;
										}).pipe(
											Effect.andThen(supersede),
											Effect.orDie,
											Effect.as({ action: "allow" as const }),
										),
								),
							),
						),
					),
					Effect.provideService(IntegrationEventStreamRepository, streams),
				);
				expect((yield* fixture.sample(writes, { value: 1, observedAt: at(1) })).count).toBe(0);
				expect(policyRuns).toBe(1);
				expect(yield* fixture.events).toEqual([]);
				expect(yield* fixture.stream).toMatchObject({ fingerprint: "newer" });
			}),
		testTimeout,
	);
});
