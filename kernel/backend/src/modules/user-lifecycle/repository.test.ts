import { expect, it } from "@effect/vitest";
import { DEFAULT_AUTOMATION_RETRY_POLICY } from "@ryot-app/contract/modules/automations/lifecycle";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
import {
	installRevisionPackage,
	revisionPackage,
	withRevisionDatabase,
} from "#modules/plugins/revision.test-support";

import { UserLifecycleRepository } from "./repository";

const lifecycleCleanupNow = new Date("2026-09-16T00:00:00Z");

it.effect("acquires the per-user lock before reading an active operation", () => {
	const events: string[] = [];
	const active = {
		failure: null,
		startedAt: null,
		finishedAt: null,
		userId: "user-1",
		id: "operation-1",
		resetResult: null,
		workflowAttempt: 0,
		accessRevokedAt: null,
		kind: "delete" as const,
		status: "pending" as const,
		accessRevocationStartedAt: null,
		databaseCleanupCompletedAt: null,
		createdAt: new Date("2026-08-24T00:00:00.000Z"),
		metadata: {
			apiKeys: [],
			locators: [],
			accounts: [],
			usesLocalAuth: true,
			recreatedAccountId: "account-1",
			user: {
				id: "user-1",
				name: "User",
				disabledAt: null,
				emailVerified: true,
				email: "user@example.com",
			},
		},
	};
	const database = Database.of(
		Object.assign(Object.create(null), {
			execute: () => Effect.sync(() => void events.push("lock")),
			select: () => {
				events.push("active");
				return { from: () => ({ where: () => ({ limit: () => Effect.succeed([active]) }) }) };
			},
		}),
	);
	const repositoryLayer = UserLifecycleRepository.layer.pipe(
		Layer.provide(Layer.succeed(Database, database)),
	);
	return Effect.gen(function* () {
		const repository = yield* UserLifecycleRepository;
		const prepared = yield* repository.loadPreparationForUpdate(UserId.make("user-1"), "reset");
		expect(prepared?.active?.operation.id).toBe("operation-1");
		expect(events).toEqual(["lock", "active"]);
	}).pipe(Effect.provide(Layer.merge(repositoryLayer, Layer.succeed(Database, database))));
});

describe("user lifecycle persistence cleanup", () => {
	it.effect("deletes private history while preserving a shared recipient and encryption key", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const db = yield* Database;
				const repository = yield* UserLifecycleRepository;
				const owner = UserId.make("owner");
				const now = lifecycleCleanupNow;
				const privatePlugin = yield* installRevisionPackage(revisionPackage("private"), owner);
				const systemPlugin = yield* installRevisionPackage(revisionPackage("system"));
				const [privateScript] = yield* db
					.select()
					.from(tables.sandboxScript)
					.where(eq(tables.sandboxScript.pluginRevisionId, privatePlugin.revisionId));
				const [systemScript] = yield* db
					.select()
					.from(tables.sandboxScript)
					.where(eq(tables.sandboxScript.pluginRevisionId, systemPlugin.revisionId));
				assert(privateScript && systemScript && privatePlugin.installation.activeConfigRevisionId);

				yield* db
					.update(tables.pluginInstallation)
					.set({ isDisabled: true, uninstalledAt: now })
					.where(eq(tables.pluginInstallation.userId, owner));
				yield* db
					.insert(tables.sandboxWorkflowReference)
					.values({
						scriptId: systemScript.id,
						pluginId: systemPlugin.pluginId,
						contentHash: systemScript.contentHash,
						executionId: "owned-installation-workflow",
						pluginInstallationId: systemPlugin.installation.id,
					});

				const trigger = (id: string) =>
					({
						id,
						depth: 0,
						source: "api",
						payload: null,
						occurredAt: now,
						operation: "emit",
						category: "signal",
						scopeUserId: owner,
						initiatorId: owner,
						payloadPrunedAt: now,
						initiatorKind: "user",
						resourceKind: "signal",
						executionId: `${id}-execution`,
						rootExecutionId: `${id}-execution`,
					}) satisfies typeof tables.automationTrigger.$inferInsert;
				yield* db
					.insert(tables.automationTrigger)
					.values([trigger("private-trigger"), trigger("shared-trigger")]);
				yield* db.insert(tables.automationTriggerRecipient).values([
					{ userId: owner, triggerId: "private-trigger" },
					{ userId: owner, triggerId: "shared-trigger" },
					{ userId: "recipient", triggerId: "shared-trigger" },
				]);

				const run = (id: string, triggerId: string, executionUserId: string) =>
					({
						id,
						triggerId,
						stage: "after",
						executionUserId,
						delivery: "async",
						hookName: "Notify",
						status: "succeeded",
						artifactsExpireAt: now,
						hookSlug: `${id}.notify`,
						scriptSlug: `${id}.script`,
						scriptContentHash: `${id}-hash`,
						retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
					}) satisfies typeof tables.automationRun.$inferInsert;
				yield* db
					.insert(tables.automationRun)
					.values([
						{
							...run("private-run", "private-trigger", owner),
							scriptSlug: privateScript.slug,
							pluginId: privatePlugin.pluginId,
							sandboxScriptId: privateScript.id,
							pluginRevisionId: privatePlugin.revisionId,
							scriptContentHash: privateScript.contentHash,
							pluginConfigRevisionId: privatePlugin.installation.activeConfigRevisionId,
						},
						run("owner-shared-run", "shared-trigger", owner),
						run("recipient-shared-run", "shared-trigger", "recipient"),
					]);
				yield* db.insert(tables.automationRunAttempt).values([
					{
						startedAt: now,
						finishedAt: now,
						retryable: false,
						attemptNumber: 1,
						status: "succeeded",
						id: "owner-attempt",
						runId: "owner-shared-run",
						workflowExecutionId: "owner-attempt-workflow",
					},
					{
						startedAt: now,
						finishedAt: now,
						retryable: false,
						attemptNumber: 1,
						status: "succeeded",
						id: "recipient-attempt",
						runId: "recipient-shared-run",
						workflowExecutionId: "recipient-attempt-workflow",
					},
				]);
				const encryptionKeys = yield* db.select().from(tables.pluginConfigEncryptionKey);

				yield* repository.deleteUserData(owner);

				expect(yield* db.select().from(tables.user)).toEqual([
					expect.objectContaining({ id: "recipient" }),
				]);
				expect(yield* db.select().from(tables.automationRun)).toEqual([
					expect.objectContaining({ id: "recipient-shared-run", executionUserId: "recipient" }),
				]);
				expect(yield* db.select().from(tables.automationRunAttempt)).toEqual([
					expect.objectContaining({ id: "recipient-attempt", runId: "recipient-shared-run" }),
				]);
				expect(yield* db.select().from(tables.automationTriggerRecipient)).toEqual([
					{ userId: "recipient", triggerId: "shared-trigger" },
				]);
				expect(yield* db.select().from(tables.automationTrigger)).toEqual([
					expect.objectContaining({ scopeUserId: null, id: "shared-trigger" }),
				]);
				expect(yield* db.select().from(tables.pluginConfigRevision)).toEqual([
					expect.objectContaining({
						ownerUserId: null,
						scope: "environment",
						pluginInstallationId: null,
					}),
				]);
				expect(
					yield* db
						.select({ id: tables.plugin.id })
						.from(tables.plugin)
						.where(eq(tables.plugin.id, privatePlugin.pluginId)),
				).toEqual([]);
				expect(
					yield* db
						.select({ id: tables.pluginRevision.id })
						.from(tables.pluginRevision)
						.where(eq(tables.pluginRevision.id, privatePlugin.revisionId)),
				).toEqual([]);
				expect(yield* db.select().from(tables.pluginInstallation)).toEqual([]);
				expect(yield* db.select().from(tables.sandboxWorkflowReference)).toEqual([]);
				expect(yield* db.select().from(tables.pluginConfigEncryptionKey)).toEqual(encryptionKeys);
			}).pipe(Effect.provide(UserLifecycleRepository.layer)),
		),
	);
});
