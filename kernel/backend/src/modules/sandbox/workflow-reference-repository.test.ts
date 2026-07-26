import { expect, it } from "@effect/vitest";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import type * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
import { assertExitFails } from "#lib/test-utils/assertions";

import {
	SandboxWorkflowReferenceRegistrationError,
	SandboxWorkflowReferenceRepository,
} from "./workflow-reference-repository";

const input = {
	pluginId: "fixture",
	contentHash: "content-hash",
	executionId: "workflow-execution",
	scriptId: SandboxScriptId.make("script-id"),
};

const reference = { ...input, pluginInstallationId: null };

const makeRegisterLayer = (options: {
	active: boolean;
	events: string[];
	inserted?: boolean;
	installationId?: string | null;
	pluginScope?: "system" | "user";
	references?: Array<Record<string, unknown>>;
	existing?: typeof schema.sandboxWorkflowReference.$inferSelect;
}) => {
	const dialect = new PgDialect();
	const db = {
		execute: (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
			const query = dialect.sqlToQuery(statement);
			options.events.push(`lock:${query.sql}:${query.params.join(":")}`);
			return Effect.void;
		},
		select: () => ({
			from: () => ({
				leftJoin: () => ({
					where: () => ({
						limit: () => {
							options.events.push("plugin");
							return Effect.succeed(
								options.active
									? [
											{
												slug: input.pluginId,
												scope: options.pluginScope ?? "system",
												installationId: options.installationId ?? null,
											},
										]
									: [],
							);
						},
					}),
				}),
				where: () => ({
					limit: () => {
						options.events.push("existing");
						return Effect.succeed(options.existing ? [options.existing] : []);
					},
				}),
			}),
		}),
		insert: () => ({
			values: (values: Record<string, unknown>) => ({
				onConflictDoNothing: () => ({
					returning: () => {
						options.events.push("insert");
						options.references?.push(values);
						return Effect.succeed(options.inserted === false ? [] : [input]);
					},
				}),
			}),
		}),
	};
	const executor = Object.assign(Object.create(null), db);
	return SandboxWorkflowReferenceRepository.layer.pipe(
		Layer.provideMerge(Layer.succeed(Database, executor)),
	);
};

it.effect("registers under the plugin ingestion lock after confirming the plugin is active", () => {
	const events: string[] = [];
	const references: Array<Record<string, unknown>> = [];
	return Effect.gen(function* () {
		const repository = yield* SandboxWorkflowReferenceRepository;
		yield* repository.lockIngestionShared();
		expect(yield* repository.registerInTransaction({ ...input, userId: "owner" })).toEqual({
			status: "registered",
		});
		expect(events).toHaveLength(3);
		expect(events[0]).toContain("pg_advisory_xact_lock_shared");
		expect(events[0]).toContain("ryot-plugin-ingestion");
		expect(events.slice(1)).toEqual(["plugin", "insert"]);
		expect(references).toEqual([{ ...input, pluginInstallationId: "installation" }]);
	}).pipe(
		Effect.provide(
			makeRegisterLayer({
				events,
				references,
				active: true,
				pluginScope: "user",
				installationId: "installation",
			}),
		),
	);
});

it.effect("refuses private plugin registration without user installation subject", () => {
	const events: string[] = [];
	return Effect.gen(function* () {
		const repository = yield* SandboxWorkflowReferenceRepository;
		yield* repository.lockIngestionShared();
		const exit = yield* Effect.exit(repository.registerInTransaction(input));
		assertExitFails(
			exit,
			new SandboxWorkflowReferenceRegistrationError({
				reason: "plugin-inactive",
				message: "Private plugin 'fixture' requires an exact user installation",
			}),
		);
		expect(events.slice(1)).toEqual(["plugin"]);
	}).pipe(Effect.provide(makeRegisterLayer({ active: true, events, pluginScope: "user" })));
});

it.effect("refuses registration when uninstall has deactivated the plugin", () => {
	const events: string[] = [];
	return Effect.gen(function* () {
		const repository = yield* SandboxWorkflowReferenceRepository;
		yield* repository.lockIngestionShared();
		const exit = yield* Effect.exit(repository.registerInTransaction(input));
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
		yield* repository.lockIngestionShared();
		expect(yield* repository.registerInTransaction(input)).toEqual({
			status: "already-registered",
		});
		expect(events.slice(1)).toEqual(["plugin", "insert", "existing"]);
	}).pipe(
		Effect.provide(
			makeRegisterLayer({ events, active: true, inserted: false, existing: reference }),
		),
	);
});

it.effect("exposes reusable reference liveness queries and idempotent release", () => {
	let rows = [reference];
	let releases = 0;
	const db = {
		delete: () => ({
			where: () => {
				releases += 1;
				rows = [];
				return Effect.void;
			},
		}),
		select: (selection?: unknown) => ({
			from: () => {
				if (selection) {
					return {
						where: () => ({ limit: () => Effect.succeed(rows.slice(0, 1)) }),
					};
				}
				return Object.assign(Effect.succeed(rows), {
					where: () => Effect.succeed(rows),
				});
			},
		}),
	};
	const layer = SandboxWorkflowReferenceRepository.layer.pipe(
		Layer.provideMerge(Layer.succeed(Database, Object.assign(Object.create(null), db))),
	);
	return Effect.gen(function* () {
		const repository = yield* SandboxWorkflowReferenceRepository;
		expect(yield* repository.hasReferences(input.pluginId)).toBe(true);
		expect(yield* repository.hasInstallationReferences("installation")).toBe(true);
		expect(yield* repository.listReferences(input.pluginId)).toEqual([reference]);
		expect(yield* repository.listReferences()).toEqual([reference]);
		yield* repository.release(input.executionId);
		yield* repository.release(input.executionId);
		expect(yield* repository.hasReferences(input.pluginId)).toBe(false);
		expect(yield* repository.hasInstallationReferences("installation")).toBe(false);
		expect(releases).toBe(2);
	}).pipe(Effect.provide(layer));
});
