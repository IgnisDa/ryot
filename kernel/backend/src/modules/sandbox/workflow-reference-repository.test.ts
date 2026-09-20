import { expect, layer } from "@effect/vitest";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Ref } from "effect";

import type * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { assertExitFails } from "#lib/test-utils/assertions";
import { fakeDatabaseSession } from "#lib/test-utils/effect";

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

class RegistrationDatabase extends Context.Service<
	RegistrationDatabase,
	{
		readonly events: Effect.Effect<ReadonlyArray<string>>;
		readonly references: Effect.Effect<ReadonlyArray<Record<string, unknown>>>;
	}
>()("test/RegistrationDatabase") {}

class ReleaseDatabase extends Context.Service<
	ReleaseDatabase,
	{ readonly releases: Effect.Effect<number> }
>()("test/ReleaseDatabase") {}

const makeRegisterLayer = (options: {
	active: boolean;
	inserted?: boolean;
	installationId?: string | null;
	pluginScope?: "system" | "user";
	existing?: typeof schema.sandboxWorkflowReference.$inferSelect;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const events = yield* Ref.make<ReadonlyArray<string>>([]);
			const references = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
			const record = (event: string) => Ref.update(events, (all) => [...all, event]);
			const dialect = new PgDialect();
			const db = {
				execute: (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
					const query = dialect.sqlToQuery(statement);
					return record(`lock:${query.sql}:${query.params.join(":")}`);
				},
				insert: () => ({
					values: (values: Record<string, unknown>) => ({
						onConflictDoNothing: () => ({
							returning: () =>
								record("insert").pipe(
									Effect.andThen(Ref.update(references, (all) => [...all, values])),
									Effect.as(options.inserted === false ? [] : [input]),
								),
						}),
					}),
				}),
				select: () => ({
					from: () => ({
						where: () => ({
							limit: () =>
								record("existing").pipe(Effect.as(options.existing ? [options.existing] : [])),
						}),
						leftJoin: () => ({
							where: () => ({
								limit: () =>
									record("plugin").pipe(
										Effect.as(
											options.active
												? [
														{
															slug: input.pluginId,
															scope: options.pluginScope ?? "system",
															installationId: options.installationId ?? null,
														},
													]
												: [],
										),
									),
							}),
						}),
					}),
				}),
			};
			const executor = Object.assign(Object.create(null), db);
			return SandboxWorkflowReferenceRepository.layer.pipe(
				Layer.provideMerge(
					Layer.merge(
						fakeDatabaseSession(executor),
						Layer.succeed(RegistrationDatabase, {
							events: Ref.get(events),
							references: Ref.get(references),
						}),
					),
				),
			);
		}),
	);

const releasingLayer = Layer.unwrap(
	Effect.gen(function* () {
		const rows = yield* Ref.make<ReadonlyArray<typeof reference>>([reference]);
		const releases = yield* Ref.make(0);
		const db = {
			delete: () => ({
				where: () =>
					Ref.update(releases, (count) => count + 1).pipe(Effect.andThen(Ref.set(rows, []))),
			}),
			select: (selection?: unknown) => ({
				from: () => {
					if (selection) {
						return {
							where: () => ({
								limit: () => Ref.get(rows).pipe(Effect.map((all) => all.slice(0, 1))),
							}),
						};
					}
					return Object.assign(Ref.get(rows), { where: () => Ref.get(rows) });
				},
			}),
		};
		return SandboxWorkflowReferenceRepository.layer.pipe(
			Layer.provideMerge(
				Layer.merge(
					fakeDatabaseSession(db),
					Layer.succeed(ReleaseDatabase, { releases: Ref.get(releases) }),
				),
			),
		);
	}),
);

layer(makeRegisterLayer({ active: true, pluginScope: "user", installationId: "installation" }))(
	(test) => {
		test.effect(
			"registers under the plugin ingestion lock after confirming the plugin is active",
			() =>
				Effect.gen(function* () {
					const repository = yield* SandboxWorkflowReferenceRepository;
					const database = yield* RegistrationDatabase;
					yield* repository.lockIngestionShared();
					expect(yield* repository.registerInTransaction({ ...input, userId: "owner" })).toEqual({
						status: "registered",
					});
					const events = yield* database.events;
					expect(events).toHaveLength(3);
					expect(events[0]).toContain("pg_advisory_xact_lock_shared");
					expect(events[0]).toContain("ryot-plugin-ingestion");
					expect(events.slice(1)).toEqual(["plugin", "insert"]);
					expect(yield* database.references).toEqual([
						{ ...input, pluginInstallationId: "installation" },
					]);
				}),
		);
	},
);

layer(makeRegisterLayer({ active: true, pluginScope: "user" }))((test) => {
	test.effect("refuses private plugin registration without user installation subject", () =>
		Effect.gen(function* () {
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
			expect((yield* (yield* RegistrationDatabase).events).slice(1)).toEqual(["plugin"]);
		}),
	);
});

layer(makeRegisterLayer({ active: false }))((test) => {
	test.effect("refuses registration when uninstall has deactivated the plugin", () =>
		Effect.gen(function* () {
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
			expect((yield* (yield* RegistrationDatabase).events).slice(1)).toEqual(["plugin"]);
		}),
	);
});

layer(makeRegisterLayer({ active: true, inserted: false, existing: reference }))((test) => {
	test.effect("treats registration replay for the same pin as idempotent", () =>
		Effect.gen(function* () {
			const repository = yield* SandboxWorkflowReferenceRepository;
			yield* repository.lockIngestionShared();
			expect(yield* repository.registerInTransaction(input)).toEqual({
				status: "already-registered",
			});
			expect((yield* (yield* RegistrationDatabase).events).slice(1)).toEqual([
				"plugin",
				"insert",
				"existing",
			]);
		}),
	);
});

layer(releasingLayer)((test) => {
	test.effect("exposes reusable reference liveness queries and idempotent release", () =>
		Effect.gen(function* () {
			const repository = yield* SandboxWorkflowReferenceRepository;
			expect(yield* repository.hasReferences(input.pluginId)).toBe(true);
			expect(yield* repository.hasInstallationReferences("installation")).toBe(true);
			expect(yield* repository.listReferences(input.pluginId)).toEqual([reference]);
			expect(yield* repository.listReferences()).toEqual([reference]);
			yield* repository.release(input.executionId);
			yield* repository.release(input.executionId);
			expect(yield* repository.hasReferences(input.pluginId)).toBe(false);
			expect(yield* repository.hasInstallationReferences("installation")).toBe(false);
			expect(yield* (yield* ReleaseDatabase).releases).toBe(2);
		}),
	);
});
