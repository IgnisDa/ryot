import { expect, it } from "@effect/vitest";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, TransactionRunner } from "#lib/infrastructure/db/service";
import { assertExitFails } from "#lib/test-utils/assertions";

import {
	SandboxWorkflowReferenceRegistrationError,
	SandboxWorkflowReferenceRepository,
} from "./workflow-reference-repository";

const input = {
	pluginSlug: "fixture",
	contentHash: "content-hash",
	executionId: "workflow-execution",
	scriptId: SandboxScriptId.make("script-id"),
};

const makeRegisterLayer = (options: {
	active: boolean;
	events: string[];
	inserted?: boolean;
	existing?: typeof schema.sandboxWorkflowReference.$inferSelect;
}) => {
	const dialect = new PgDialect();
	const db = {
		execute: (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
			const query = dialect.sqlToQuery(statement);
			options.events.push(`lock:${query.sql}:${query.params.join(":")}`);
			return Promise.resolve();
		},
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: () => {
						options.events.push(table === schema.plugin ? "plugin" : "existing");
						if (table === schema.plugin) {
							return Promise.resolve(options.active ? [{ slug: input.pluginSlug }] : []);
						}
						return Promise.resolve(options.existing ? [options.existing] : []);
					},
				}),
			}),
		}),
		insert: () => ({
			values: () => ({
				onConflictDoNothing: () => ({
					returning: () => {
						options.events.push("insert");
						return Promise.resolve(options.inserted === false ? [] : [input]);
					},
				}),
			}),
		}),
	};
	const executor = Object.assign(Object.create(null), db);
	return SandboxWorkflowReferenceRepository.Default.pipe(
		Layer.provideMerge(
			Layer.succeed(TransactionRunner, (effect) =>
				Effect.provideService(effect, CurrentDb, executor),
			),
		),
		Layer.provideMerge(Layer.succeed(CurrentDb, executor)),
	);
};

it.effect("registers under the plugin ingestion lock after confirming the plugin is active", () => {
	const events: string[] = [];
	return Effect.gen(function* () {
		const repository = yield* SandboxWorkflowReferenceRepository;
		expect(yield* repository.register(input)).toEqual({ status: "registered" });
		expect(events).toHaveLength(3);
		expect(events[0]).toContain("pg_advisory_xact_lock_shared");
		expect(events[0]).toContain("ryot-plugin-ingestion");
		expect(events.slice(1)).toEqual(["plugin", "insert"]);
	}).pipe(Effect.provide(makeRegisterLayer({ active: true, events })));
});

it.effect("refuses registration when uninstall has deactivated the plugin", () => {
	const events: string[] = [];
	return Effect.gen(function* () {
		const repository = yield* SandboxWorkflowReferenceRepository;
		const exit = yield* Effect.exit(repository.register(input));
		assertExitFails(
			exit,
			new SandboxWorkflowReferenceRegistrationError({
				reason: "plugin-inactive",
				message: "Plugin 'fixture' is not active",
			}),
		);
		expect(events.slice(1)).toEqual(["plugin"]);
	}).pipe(Effect.provide(makeRegisterLayer({ active: false, events })));
});

it.effect("treats registration replay for the same pin as idempotent", () => {
	const events: string[] = [];
	return Effect.gen(function* () {
		const repository = yield* SandboxWorkflowReferenceRepository;
		expect(yield* repository.register(input)).toEqual({ status: "already-registered" });
		expect(events.slice(1)).toEqual(["plugin", "insert", "existing"]);
	}).pipe(
		Effect.provide(makeRegisterLayer({ events, active: true, inserted: false, existing: input })),
	);
});

it.effect("exposes reusable reference liveness queries and idempotent release", () => {
	let rows = [input];
	let releases = 0;
	const db = {
		select: (selection?: unknown) => ({
			from: () => {
				if (selection) {
					return {
						where: () => ({ limit: () => Promise.resolve(rows.slice(0, 1)) }),
					};
				}
				return Object.assign(Promise.resolve(rows), {
					where: () => Promise.resolve(rows),
				});
			},
		}),
		delete: () => ({
			where: () => {
				releases += 1;
				rows = [];
				return Promise.resolve();
			},
		}),
	};
	const layer = SandboxWorkflowReferenceRepository.Default.pipe(
		Layer.provideMerge(Layer.succeed(CurrentDb, Object.assign(Object.create(null), db))),
	);
	return Effect.gen(function* () {
		const repository = yield* SandboxWorkflowReferenceRepository;
		expect(yield* repository.hasReferences(input.pluginSlug)).toBe(true);
		expect(yield* repository.listReferences(input.pluginSlug)).toEqual([input]);
		expect(yield* repository.listReferences()).toEqual([input]);
		yield* repository.release(input.executionId);
		yield* repository.release(input.executionId);
		expect(yield* repository.hasReferences(input.pluginSlug)).toBe(false);
		expect(releases).toBe(2);
	}).pipe(Effect.provide(layer));
});
