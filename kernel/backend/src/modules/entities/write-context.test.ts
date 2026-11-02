import { assert, expect, layer } from "@effect/vitest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

import { MutationReceipts } from "#modules/mutations/receipts";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { DomainWriteChecks, DomainWriteChecksLive, reuseLockedWriteChecks } from "./write-context";

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
	const accountGeneration = yield* (yield* MutationReceipts.make).currentAccount(userId);
	const subject = { userId, accountGeneration, type: "user" as const };
	const pin = yield* (yield* SandboxRepository.make).getScriptPin(
		SandboxScriptId.make(script.id),
		undefined,
		subject,
	);
	assert(pin?.pluginRevision);
	return {
		pluginId: installed.pluginId,
		command: {
			writeContext: yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject }),
		},
	};
});

layer(DomainWriteChecksLive.pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
	test.effect("reuses a locked write check only inside the opted-in scope", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const checks = yield* DomainWriteChecks;
			const { command, pluginId } = yield* installedWriter;
			const check = checks.check(command, definitionOwner(pluginId), userId, true);
			const outcome = yield* session.transaction(
				reuseLockedWriteChecks(
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
						const reused = yield* check;
						const fresh = yield* Effect.flip(reuseLockedWriteChecks(check));
						return { first, fresh, reused };
					}),
				),
			);
			expect(outcome.reused).toEqual(outcome.first);
			expect(outcome.fresh.message).toContain("installation authority is unavailable");
		}),
	);
});
