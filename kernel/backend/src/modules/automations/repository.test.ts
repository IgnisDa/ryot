import { expect, it } from "@effect/vitest";
import { BadRequest } from "@ryot-app/contract/errors";
import type { AutomationOccurrence } from "@ryot-app/contract/modules/automations/schemas";
import {
	AutomationOccurrenceId,
	AutomationRuleId,
	SignalId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { assertExitFails } from "#lib/test-utils/assertions";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { AutomationsRepository } from "./repository";
import { AutomationsService } from "./service";

const dialect = new PgDialect();
const userId = UserId.make("user-1");
const otherUserId = UserId.make("user-2");
const signalSchemaSlug = SignalSchemaSlug.make("review.created");
const signalId = SignalId.make("signal-1");
const occurredAt = new Date("2026-07-20T10:00:00.000Z");
const createdAt = new Date("2026-07-20T10:00:01.000Z");

const occurrence: AutomationOccurrence = {
	userId,
	signalId,
	recordId: null,
	population: null,
	operation: "signal",
	sourceKind: "signal",
	origin: { kind: "api" },
	occurredAt: "2026-07-20T10:00:00.000Z",
	id: AutomationOccurrenceId.make("occurrence-1"),
	source: {
		kind: "signal",
		signal: {
			id: signalId,
			signalSchemaSlug,
			origin: { kind: "api" },
			properties: { message: "trace" },
			occurredAt: "2026-07-20T10:00:00.000Z",
		},
	},
};

const row = {
	userId,
	isActive: true,
	metadata: false,
	signalSchemaSlug,
	signalSchemaPluginId: "plugin-1",
	id: AutomationRuleId.make("rule-1"),
	createdAt: new Date("2026-07-20T10:00:00.000Z"),
	updatedAt: new Date("2026-07-20T10:00:00.000Z"),
} as const;

const makeDb = () => {
	const state = { queryParams: [] as unknown[] };
	const select = () => ({
		from: () => ({
			where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
				state.queryParams = dialect.sqlToQuery(condition).params;
				return { limit: () => Effect.succeed([row]), orderBy: () => Effect.succeed([row]) };
			},
		}),
	});
	return { state, select };
};

const makeLayer = (db: ReturnType<typeof makeDb>) =>
	Layer.mergeAll(
		AutomationsRepository.layer,
		Layer.succeed(Database, Object.assign(Object.create(null), db)),
	);

const makeOccurrenceHarness = () => {
	type StoredOccurrence = Omit<AutomationOccurrence, "occurredAt"> & {
		occurredAt: Date;
		createdAt: Date;
	};
	let stored: StoredOccurrence | undefined;
	const insertedValues: unknown[] = [];
	const select = () => ({
		from: () => ({ where: () => ({ limit: () => Effect.sync(() => (stored ? [stored] : [])) }) }),
	});
	const insert = () => ({
		values: (values: Omit<StoredOccurrence, "createdAt">) => ({
			onConflictDoNothing: () => ({
				returning: () =>
					Effect.sync(() => {
						insertedValues.push(values);
						if (stored) {
							return [];
						}
						stored = { ...values, createdAt };
						return [stored];
					}),
			}),
		}),
	});
	const transactionDatabase = Object.assign(Object.create(null), { insert, select });
	const database = Database.of(
		Object.assign(Object.create(null), transactionDatabase, {
			transaction: ((callback) =>
				callback(transactionDatabase)) satisfies Database["Service"]["transaction"],
		}),
	);
	const databaseLayer = Layer.succeed(Database, database);
	const repositoryLayer = AutomationsRepository.layer.pipe(Layer.provide(databaseLayer));
	return {
		insertedValues,
		repositoryLayer: Layer.merge(databaseLayer, repositoryLayer),
		serviceLayer: AutomationsService.layer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					repositoryLayer,
					Layer.succeed(PluginRuntimeResolver, Object.create(null)),
				),
			),
		),
	};
};

it.effect("inserts and loads a decoded immutable automation occurrence", () => {
	const harness = makeOccurrenceHarness();
	return Effect.gen(function* () {
		const repository = yield* AutomationsRepository;
		expect(yield* repository.insertOccurrence(occurrence)).toEqual(occurrence);
		expect(yield* repository.findOccurrence(occurrence.id)).toEqual(occurrence);
		expect(harness.insertedValues).toEqual([{ ...occurrence, occurredAt }]);
	}).pipe(Effect.provide(harness.repositoryLayer));
});

it.effect("accepts an identical recordOccurrence replay", () => {
	const harness = makeOccurrenceHarness();
	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		expect(yield* service.recordOccurrence(occurrence)).toEqual(occurrence);
		expect(yield* service.recordOccurrence(occurrence)).toEqual(occurrence);
		expect(harness.insertedValues).toHaveLength(2);
	}).pipe(Effect.provide(harness.serviceLayer));
});

it.effect("rejects recordOccurrence reuse with conflicting data", () => {
	const harness = makeOccurrenceHarness();
	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		yield* service.recordOccurrence(occurrence);
		assertExitFails(
			yield* Effect.exit(service.recordOccurrence({ ...occurrence, userId: otherUserId })),
			new BadRequest({ message: "Automation occurrence ID was reused with different data" }),
		);
	}).pipe(Effect.provide(harness.serviceLayer));
});

it.effect("preserves falsy JSON metadata loaded from notification state", () => {
	const db = makeDb();
	return Effect.gen(function* () {
		const repository = yield* AutomationsRepository;
		const subscription = yield* repository.findNotificationSubscription({ userId, ruleId: row.id });
		expect(subscription?.metadata).toBe(false);
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("filters active notification state by user and signal schema", () => {
	const db = makeDb();
	return Effect.gen(function* () {
		const repository = yield* AutomationsRepository;
		const subscriptions = yield* repository.listActiveNotificationSubscriptions({
			userId,
			signalSchemaSlug,
			signalSchemaPluginId: row.signalSchemaPluginId,
		});
		expect(db.state.queryParams).toEqual([
			userId,
			true,
			signalSchemaSlug,
			row.signalSchemaPluginId,
		]);
		expect(subscriptions).toEqual([
			{
				...row,
				id: row.id,
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
			},
		]);
	}).pipe(Effect.provide(makeLayer(db)));
});
