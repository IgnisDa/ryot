import { assert, expect, layer } from "@effect/vitest";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Ref } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";
import { fakeDatabaseSession } from "#lib/test-utils/effect";
import {
	installRevisionPackage,
	revisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/revision.test-support";

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

const makeRegisterLayer = (options: {
	active: boolean;
	inserted?: boolean;
	installationId?: string | null;
	pluginScope?: "system" | "user";
	existing?: typeof schema.sandboxWorkflowReference.$inferSelect;
	matchingScript?: boolean;
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
						innerJoin: () => ({
							where: () => ({
								limit: () =>
									record("script").pipe(Effect.as(options.matchingScript === false ? [] : [input])),
							}),
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
															installationId: options.installationId ?? null,
															ownerId: options.pluginScope === "user" ? "owner" : null,
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
					expect(events).toHaveLength(4);
					expect(events[0]).toContain("pg_advisory_xact_lock_shared");
					expect(events[0]).toContain("ryot-plugin-ingestion");
					expect(events.slice(1)).toEqual(["plugin", "script", "insert"]);
					expect(yield* database.references).toEqual([
						{
							scriptId: input.scriptId,
							executionId: input.executionId,
							pluginInstallationId: "installation",
						},
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
				"script",
				"insert",
				"existing",
			]);
		}),
	);
});

layer(revisionDatabaseLayer)((test) => {
	test.effect("validates the referenced script, preserves replay, and releases the pin", () =>
		Effect.gen(function* () {
			const installed = yield* installRevisionPackage(revisionPackage("pinned"));
			const other = yield* installRevisionPackage(revisionPackage("other"));
			const session = yield* DatabaseSession;
			const repository = yield* SandboxWorkflowReferenceRepository;
			const [script] = yield* session.run((db) =>
				db
					.select()
					.from(schema.sandboxScript)
					.where(eq(schema.sandboxScript.pluginRevisionId, installed.revisionId))
					.limit(1),
			);
			assert(script);
			const pin = {
				userId: "owner",
				pluginId: installed.pluginId,
				contentHash: script.contentHash,
				executionId: "pinned-execution",
				scriptId: SandboxScriptId.make(script.id),
			};
			yield* session.transaction(
				Effect.gen(function* () {
					yield* repository.lockIngestionShared();
					assertExitFails(
						yield* Effect.exit(repository.registerInTransaction({ ...pin, contentHash: "wrong" })),
						new SandboxWorkflowReferenceRegistrationError({
							reason: "script-mismatch",
							message: `Script '${script.id}' does not match plugin '${installed.pluginId}' and its content hash`,
						}),
					);
					assertExitFails(
						yield* Effect.exit(
							repository.registerInTransaction({ ...pin, pluginId: other.pluginId }),
						),
						new SandboxWorkflowReferenceRegistrationError({
							reason: "script-mismatch",
							message: `Script '${script.id}' does not match plugin '${other.pluginId}' and its content hash`,
						}),
					);
					expect(yield* repository.registerInTransaction(pin)).toEqual({ status: "registered" });
					expect(yield* repository.registerInTransaction(pin)).toEqual({
						status: "already-registered",
					});
				}),
			);
			expect(yield* repository.hasReferences(installed.pluginId)).toBe(true);
			expect(yield* repository.hasInstallationReferences(installed.installation.id)).toBe(true);
			expect(yield* repository.listReferences(installed.pluginId)).toEqual([
				{
					pluginId: pin.pluginId,
					scriptId: pin.scriptId,
					executionId: pin.executionId,
					contentHash: pin.contentHash,
					pluginInstallationId: installed.installation.id,
				},
			]);
			yield* repository.release(pin.executionId);
			yield* repository.release(pin.executionId);
			expect(yield* repository.hasReferences(installed.pluginId)).toBe(false);
			expect(yield* repository.hasInstallationReferences(installed.installation.id)).toBe(false);
		}),
	);
});
