import { expect, it } from "@effect/vitest";
import { AutomationRuleId, SandboxScriptId, SignalSchemaId } from "@ryot/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { CurrentDb } from "#lib/infrastructure/db/service";

import { AutomationsRepository } from "./repository";

const dialect = new PgDialect();

const row = {
	userId: null,
	id: "rule-1",
	position: null,
	isActive: true,
	isBuiltin: true,
	metadata: false,
	operation: "signal",
	eventSchemaId: null,
	kind: "subscription",
	entitySchemaId: null,
	name: "Notifications",
	relationshipSchemaId: null,
	signalSchemaId: "signal-schema-1",
	sandboxScriptId: "sandbox-script-1",
	createdAt: new Date("2026-07-20T10:00:00.000Z"),
	updatedAt: new Date("2026-07-20T10:00:00.000Z"),
} as const;

const makeDb = () => {
	const state = { filteredSubscriptions: false };
	const select = () => ({
		from: () => ({
			where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
				const query = dialect.sqlToQuery(condition);
				const rows = query.params.includes("subscription")
					? [row]
					: [row, { ...row, id: "policy-1", kind: "policy" as const }];
				if (query.params.includes("subscription")) {
					state.filteredSubscriptions = true;
				}
				return {
					limit: () => Promise.resolve(rows.slice(0, 1)),
					orderBy: () => Promise.resolve(rows),
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

it.effect("preserves falsy JSON metadata loaded from persistence", () => {
	const db = makeDb();
	return Effect.gen(function* () {
		const repository = yield* AutomationsRepository;
		const rule = yield* repository.findByUnique({
			userId: null,
			operation: "signal",
			sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
			target: { kind: "signal_schema", id: SignalSchemaId.make(row.signalSchemaId) },
		});
		expect(rule?.metadata).toBe(false);
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("filters lifecycle policy rows from subscription resolution", () => {
	const db = makeDb();
	return Effect.gen(function* () {
		const repository = yield* AutomationsRepository;
		const rules = yield* repository.resolveActive({
			rowUserId: null,
			operation: "signal",
			target: { kind: "signal_schema", id: SignalSchemaId.make(row.signalSchemaId) },
		});
		expect(db.state.filteredSubscriptions).toBe(true);
		expect(rules.map((rule) => rule.id)).toEqual([AutomationRuleId.make(row.id)]);
	}).pipe(Effect.provide(makeLayer(db)));
});
