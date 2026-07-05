import { expect, it } from "@effect/vitest";
import {
	AutomationRuleId,
	EventSchemaSlug,
	SandboxScriptId,
	SignalSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { CurrentDb } from "#lib/infrastructure/db/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";

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
	eventSchemaSlug: null,
	kind: "subscription",
	entitySchemaSlug: null,
	name: "Notifications",
	relationshipSchemaSlug: null,
	signalSchemaSlug: "signal-schema-1",
	sandboxScriptId: "sandbox-script-1",
	createdAt: new Date("2026-07-20T10:00:00.000Z"),
	updatedAt: new Date("2026-07-20T10:00:00.000Z"),
} as const;

const makeDb = () => {
	const state = { filteredPolicies: false, filteredSubscriptions: false };
	const select = () => ({
		from: () => ({
			where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
				const query = dialect.sqlToQuery(condition);
				const policyRow = {
					...row,
					position: 10,
					id: "policy-1",
					userId: "user-1",
					operation: "create",
					signalSchemaSlug: null,
					kind: "policy" as const,
					eventSchemaSlug: "event-schema-1",
				};
				const rows = query.params.includes("subscription") ? [row] : [policyRow];
				if (query.params.includes("subscription")) {
					state.filteredSubscriptions = true;
				}
				if (query.params.includes("policy")) {
					state.filteredPolicies = true;
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
		AutomationsRepository.Default.pipe(Layer.provide(DefinitionRegistry.Default)),
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
			target: { kind: "signal_schema", id: SignalSchemaSlug.make(row.signalSchemaSlug) },
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
			target: { kind: "signal_schema", id: SignalSchemaSlug.make(row.signalSchemaSlug) },
		});
		expect(db.state.filteredSubscriptions).toBe(true);
		expect(rules.map((rule) => rule.id)).toEqual([AutomationRuleId.make(row.id)]);
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("resolves active event policies independently from subscriptions", () => {
	const db = makeDb();
	return Effect.gen(function* () {
		const repository = yield* AutomationsRepository;
		const rules = yield* repository.resolveActivePolicies({
			operation: "create",
			rowUserId: UserId.make("user-1"),
			target: { kind: "event_schema", id: EventSchemaSlug.make("event-schema-1") },
		});
		expect(db.state.filteredPolicies).toBe(true);
		expect(rules.map((rule) => rule.id)).toEqual([AutomationRuleId.make("policy-1")]);
	}).pipe(Effect.provide(makeLayer(db)));
});
