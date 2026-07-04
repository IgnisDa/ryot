import { expect, it } from "@effect/vitest";
import { AutomationRuleId, SignalSchemaSlug, UserId } from "@ryot/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { CurrentDb } from "#lib/infrastructure/db/service";

import { AutomationsRepository } from "./repository";

const dialect = new PgDialect();
const userId = UserId.make("user-1");
const signalSchemaSlug = SignalSchemaSlug.make("review.created");

const row = {
	userId,
	isActive: true,
	metadata: false,
	signalSchemaSlug,
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
				return {
					limit: () => Promise.resolve([row]),
					orderBy: () => Promise.resolve([row]),
				};
			},
		}),
	});
	return { select, state };
};

const makeLayer = (db: ReturnType<typeof makeDb>) =>
	Layer.mergeAll(
		AutomationsRepository.Default,
		Layer.succeed(CurrentDb, Object.assign(Object.create(null), db)),
	);

it.effect("preserves falsy JSON metadata loaded from notification state", () => {
	const db = makeDb();
	return Effect.gen(function* () {
		const repository = yield* AutomationsRepository;
		const subscription = yield* repository.findNotificationSubscription({
			userId,
			ruleId: row.id,
		});
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
		});
		expect(db.state.queryParams).toEqual([userId, true, signalSchemaSlug]);
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
