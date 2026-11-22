import { expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import {
	type DefinitionOwner,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { testPluginPackageId } from "@ryot-app/contract/testing";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { makeRecordingTracer, recordedStatements } from "@ryot-app/testing/recording-tracer";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq } from "drizzle-orm";
import { Effect, Layer, Schema, type Tracer } from "effect";

import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { WritePreparation, WriteTransaction } from "#platform/db/write-transaction";
import * as tables from "#schema/tables/combined";

import { DomainWriteChecks, DomainWriteChecksLive, DomainWriteConflict } from "./write-context";

const userId = UserId.make("owner");

const installedWriter = Effect.gen(function* () {
	const packageId = testPluginPackageId();
	const installed = yield* installRevisionPackage(
		revisionPackage("write-checks", "v1", undefined, packageId),
		userId,
	);
	const session = yield* DatabaseSession;
	const [script] = yield* session.run((db) =>
		db
			.select({ id: tables.sandboxScript.id })
			.from(tables.sandboxScript)
			.where(eq(tables.sandboxScript.pluginRevisionId, installed.revisionId))
			.limit(1),
	);
	assert(script);
	const subject = { userId, type: "user" as const };
	const pin = yield* (yield* SandboxRepository.make).getScriptPin(
		SandboxScriptId.make(script.id),
		undefined,
		subject,
	);
	assert(pin?.pluginRevision);
	return {
		pluginId: installed.pluginId,
		revisionId: installed.revisionId,
		command: {
			writeContext: yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject }),
		},
		upgrade: installRevisionPackage(
			revisionPackage("write-checks", "v2", undefined, packageId),
			userId,
		),
	};
});

layer(DomainWriteChecksLive.pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
	test.effect(
		"reuses locked authority for the rest of its transaction and reads it again in the next",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const checks = yield* DomainWriteChecks;
				const { command, pluginId, revisionId } = yield* installedWriter;
				const check = Effect.suspend(() =>
					checks.check(command, definitionOwner(pluginId), userId, new WriteTransaction()),
				);
				const outcome = yield* session.transaction(
					Effect.gen(function* () {
						const first = yield* check;
						yield* session.run((db) =>
							db
								.update(tables.pluginInstallation)
								.set({ uninstalledAt: new Date() })
								.where(
									and(
										eq(tables.pluginInstallation.pluginId, pluginId),
										eq(tables.pluginInstallation.userId, userId),
									),
								),
						);
						return { first, reused: yield* check };
					}),
				);
				expect(outcome.reused).toEqual(outcome.first);
				expect(outcome.first).toEqual({ id: revisionId, activeRevisionId: revisionId });
				expect(
					yield* checks.preparePin(
						command,
						definitionOwner(pluginId),
						userId,
						new WritePreparation(),
					),
				).toEqual(outcome.first);
				assertExitFails(
					yield* Effect.exit(session.transaction(check)),
					new DbError({ message: "Current domain write installation authority is unavailable" }),
				);
			}),
	);

	test.effect(
		"rejects an owner mismatch after the transaction checked the writer's own owner",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const checks = yield* DomainWriteChecks;
				const { command, pluginId } = yield* installedWriter;
				const mismatch = (actual: DefinitionOwner) =>
					new DomainWriteConflict({
						message: "Domain write belongs to another definition owner",
						reason: { actual, code: "owner-mismatch", expected: definitionOwner(pluginId) },
					});
				const foreign = definitionOwner("foreign-plugin");
				const kernel = definitionOwner(null);
				const outcomes = yield* session.transaction(
					Effect.gen(function* () {
						const transaction = new WriteTransaction();
						yield* checks.check(command, definitionOwner(pluginId), userId, transaction);
						return {
							kernel: yield* Effect.exit(checks.check(command, kernel, userId, transaction)),
							foreign: yield* Effect.exit(checks.check(command, foreign, userId, transaction)),
							collection: yield* checks.check(
								{ ...command, kernelCollection: true },
								kernel,
								userId,
								transaction,
							),
						};
					}),
				);
				assertExitFails(outcomes.foreign, mismatch(foreign));
				assertExitFails(outcomes.kernel, mismatch(kernel));
				expect(outcomes.collection).toBeNull();
				assertExitFails(
					yield* Effect.exit(checks.preparePin(command, foreign, userId, new WritePreparation())),
					mismatch(foreign),
				);
			}),
	);

	test.effect(
		"reads a writer's pin once per preparation and verifies it under the commit's locks",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const checks = yield* DomainWriteChecks;
				const { command, pluginId, revisionId } = yield* installedWriter;
				const owner = definitionOwner(pluginId);
				const spans: Tracer.Span[] = [];
				const preparation = new WritePreparation();
				const pin = yield* Effect.gen(function* () {
					const prepared = yield* checks.preparePin(command, owner, userId, preparation);
					expect(yield* checks.preparePin(command, owner, userId, preparation)).toEqual(prepared);
					return yield* session.transaction(
						checks.check(command, owner, userId, new WriteTransaction(preparation)),
					);
				}).pipe(Effect.withTracer(makeRecordingTracer(spans)));
				expect(pin).toEqual({ id: revisionId, activeRevisionId: revisionId });
				expect(
					recordedStatements(spans).filter((text) =>
						text.includes('from "plugin_revision" inner join "plugin"'),
					),
				).toHaveLength(1);
			}),
	);

	test.effect(
		"rejects or repins a prepared writer whose installation or active revision changed",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const checks = yield* DomainWriteChecks;
				const { command, upgrade, pluginId, revisionId } = yield* installedWriter;
				const owner = definitionOwner(pluginId);
				const preparation = new WritePreparation();
				const commit = session.transaction(
					checks.check(command, owner, userId, new WriteTransaction(preparation)),
				);
				yield* checks.preparePin(command, owner, userId, preparation);
				const upgraded = yield* upgrade;
				expect(upgraded.pluginId).toBe(pluginId);
				expect(yield* commit).toEqual({ id: revisionId, activeRevisionId: upgraded.revisionId });
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ uninstalledAt: new Date() })
						.where(
							and(
								eq(tables.pluginInstallation.pluginId, pluginId),
								eq(tables.pluginInstallation.userId, userId),
							),
						),
				);
				assertExitFails(
					yield* Effect.exit(commit),
					new DbError({ message: "Current domain write installation authority is unavailable" }),
				);
			}),
	);
});
