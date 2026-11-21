import { expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import {
	type DefinitionOwner,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { DomainWriteChecks, DomainWriteChecksLive, DomainWriteConflict } from "./write-context";

const userId = UserId.make("owner");

const installedWriter = Effect.gen(function* () {
	const installed = yield* installRevisionPackage(revisionPackage("write-checks"), userId);
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
				const check = checks.check(command, definitionOwner(pluginId), userId, true);
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
				expect(yield* checks.preparePin(command, definitionOwner(pluginId), userId)).toEqual(
					outcome.first,
				);
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
						yield* checks.check(command, definitionOwner(pluginId), userId, true);
						return {
							kernel: yield* Effect.exit(checks.check(command, kernel, userId, true)),
							foreign: yield* Effect.exit(checks.check(command, foreign, userId, true)),
							collection: yield* checks.check(
								{ ...command, kernelCollection: true },
								kernel,
								userId,
								true,
							),
						};
					}),
				);
				assertExitFails(outcomes.foreign, mismatch(foreign));
				assertExitFails(outcomes.kernel, mismatch(kernel));
				expect(outcomes.collection).toBeNull();
				assertExitFails(
					yield* Effect.exit(checks.preparePin(command, foreign, userId)),
					mismatch(foreign),
				);
			}),
	);
});
