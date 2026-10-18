import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { SandboxExecutionSubject } from "@ryot-app/contract/modules/scripts/schemas";
import { PluginId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { MutationReceipts } from "#modules/mutations/receipts";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import {
	ScriptExecutionPrincipal,
	type ScriptExecutionPrincipal as ScriptExecutionPrincipalType,
} from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { scriptWork } from "#schema/tables/script-work";
import { makeWorkflowEngine, workflowEngineTestLayer } from "#testing/effect";

import {
	makeUserWorkScriptHost,
	UserWorkRepository,
	UserWorkWorkflow,
	UserWorkWorkflowLive,
} from "./user-work";
import { ScriptExecutionWorkflow } from "./workflow";

const userId = UserId.make("owner");
const callerSlug = "durable-user-work.task";
const targetSlug = "durable-user-work.worker";

const userWorkPackage = () => {
	const value = revisionPackage("durable-user-work");
	const caller = value.scripts.find(({ slug }) => slug === callerSlug);
	assert(caller?.metadata.kind === "script");
	const callerMetadata = {
		...caller.metadata,
		capabilities: ["requestUserWork" as const],
		executableDependencies: [{ slug: targetSlug, kind: "script" as const }],
	};
	const targetMetadata = {
		...caller.metadata,
		name: "Worker",
		slug: targetSlug,
		capabilities: [],
		executableDependencies: [],
	};
	const manifest = Schema.decodeSync(PluginManifest)({
		...value.manifest,
		scripts: [
			...value.manifest.scripts.map((script) =>
				script.slug === callerSlug ? { ...callerMetadata, entry: caller.entry } : script,
			),
			{ ...targetMetadata, entry: "backend/worker.sandbox.ts" },
		],
	});
	return {
		...value,
		manifest,
		scripts: [
			...value.scripts.map((script) =>
				script.slug === callerSlug
					? Object.assign({}, script, { metadata: callerMetadata })
					: script,
			),
			{
				...caller,
				name: "Worker",
				slug: targetSlug,
				metadata: targetMetadata,
				compiledCode: "compiled worker",
				contentHash: `${targetSlug}-hash`,
				entry: "backend/worker.sandbox.ts",
			},
		],
	};
};

type UserSubject = Extract<SandboxExecutionSubject, { readonly type: "user" }>;

type UserWorkFixtureValue = {
	readonly userId: UserId;
	readonly accountGeneration: UserSubject["accountGeneration"];
	readonly subject: UserSubject;
	readonly pluginId: PluginId;
	readonly targetScriptId: SandboxScriptId;
	readonly targetSlug: string;
	readonly principal: ScriptExecutionPrincipalType;
};

class UserWorkFixture extends Context.Service<UserWorkFixture, UserWorkFixtureValue>()(
	"test/UserWorkFixture",
) {}

const userWorkDatabaseLayer = () =>
	Layer.effect(
		UserWorkFixture,
		Effect.gen(function* () {
			const installed = yield* installRevisionPackage(userWorkPackage(), userId);
			const session = yield* DatabaseSession;
			const scripts = yield* session.run((db) =>
				db
					.select({ id: tables.sandboxScript.id, slug: tables.sandboxScript.slug })
					.from(tables.sandboxScript)
					.where(eq(tables.sandboxScript.pluginRevisionId, installed.revisionId)),
			);
			const caller = scripts.find(({ slug }) => slug === callerSlug);
			const target = scripts.find(({ slug }) => slug === targetSlug);
			assert(caller);
			assert(target);
			const accountGeneration = yield* (yield* MutationReceipts.make).currentAccount(userId);
			const subject = { userId, accountGeneration, type: "user" as const };
			const pin = yield* (yield* SandboxRepository.make).getScriptPin(
				SandboxScriptId.make(caller.id),
				undefined,
				subject,
			);
			assert(pin?.pluginRevision);
			const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
			return {
				userId,
				subject,
				principal,
				targetSlug,
				accountGeneration,
				pluginId: PluginId.make(installed.pluginId),
				targetScriptId: SandboxScriptId.make(target.id),
			};
		}),
	).pipe(Layer.provideMerge(revisionDatabaseLayer));

const inputHash = (scope: string, payload: JsonValue) => `test-${scope}-${JSON.stringify(payload)}`;

const workRow = (
	fixture: UserWorkFixtureValue,
	input: {
		readonly id: string;
		readonly key: string;
		readonly scope: string;
		readonly payload: JsonValue;
		readonly status?: typeof scriptWork.$inferSelect.status;
	},
): typeof scriptWork.$inferInsert => ({
	id: input.id,
	key: input.key,
	scope: input.scope,
	userId: fixture.userId,
	payload: input.payload,
	pluginId: fixture.pluginId,
	status: input.status ?? "queued",
	inputHash: inputHash(input.scope, input.payload),
});

const scriptExecution = (fixture: UserWorkFixtureValue, id: string, input: JsonValue) => {
	const pluginRevision = fixture.principal.pluginRevision;
	assert(pluginRevision);
	return {
		input,
		pluginRevision,
		subject: fixture.subject,
		executionId: `${id}-script`,
		lane: "background" as const,
		scriptId: fixture.targetScriptId,
		resolutionMode: "exact" as const,
	};
};

const runInput = (
	fixture: UserWorkFixtureValue,
	principal: ScriptExecutionPrincipalType = fixture.principal,
) => ({
	principal,
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	hostCallDiscriminator: 0,
	lane: "interactive" as const,
	executionId: "parent-execution",
	startedAt: "2026-01-01T00:00:00.000Z",
	workflowExecutionId: "parent-workflow",
});

const workRequest = (key: string, scope = "same-scope", input: JsonValue = { value: 1 }) => ({
	key,
	input,
	scope,
});

const workReference = { scriptSlug: targetSlug, referenceKind: "script" } as const;

type DispatchRecord = {
	readonly workflow: string;
	readonly executionId: string;
	readonly inTransaction: boolean;
};

class UserWorkHostCalls extends Context.Service<
	UserWorkHostCalls,
	{ readonly dispatches: Effect.Effect<ReadonlyArray<DispatchRecord>> }
>()("test/UserWorkHostCalls") {}

const userWorkHostLayer = () =>
	Layer.mergeAll(
		DomainWriteChecksLive,
		Layer.unwrap(
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const dispatches = yield* Ref.make<ReadonlyArray<DispatchRecord>>([]);
				const engine = makeWorkflowEngine({
					execute: (workflow, options) =>
						Effect.gen(function* () {
							const inTransaction = yield* session.isTransactionActive;
							yield* Ref.update(dispatches, (all) => [
								...all,
								{ inTransaction, workflow: workflow._tag, executionId: options.executionId },
							]);
							return options.executionId;
						}),
				});
				return Layer.merge(
					Layer.succeed(WorkflowEngine, engine),
					Layer.succeed(UserWorkHostCalls, { dispatches: Ref.get(dispatches) }),
				);
			}),
		),
	).pipe(Layer.provideMerge(userWorkDatabaseLayer()));

const userWorkWorkflowLayer = () =>
	Layer.merge(
		UserWorkWorkflowLive,
		ScriptExecutionWorkflow.toLayer((payload) =>
			payload.input === "failure"
				? Effect.fail(new SandboxRunError({ kind: "script-failure", message: "x".repeat(9000) }))
				: Effect.succeed(null),
		),
	).pipe(Layer.provideMerge(workflowEngineTestLayer), Layer.provideMerge(userWorkDatabaseLayer()));

layer(userWorkDatabaseLayer())((test) => {
	test.effect("replays an identical user-work request as one durable row", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const repository = yield* UserWorkRepository.make;
			const session = yield* DatabaseSession;
			const id = `user-work-replay-${crypto.randomUUID()}`;
			const row = workRow(fixture, {
				id,
				key: "same-key",
				scope: "same-scope",
				payload: { value: 1 },
			});

			expect(yield* repository.request(row)).toBe("queued");
			expect(yield* repository.request(row)).toBe("queued");
			expect(
				yield* session.run((db) => db.select().from(scriptWork).where(eq(scriptWork.id, id))),
			).toHaveLength(1);
		}),
	);

	test.effect("rejects changed input for one work ID without replacing its payload", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const repository = yield* UserWorkRepository.make;
			const session = yield* DatabaseSession;
			const id = `user-work-changed-${crypto.randomUUID()}`;
			const original = workRow(fixture, {
				id,
				key: "same-key",
				scope: "same-scope",
				payload: { value: 1 },
			});
			yield* repository.request(original);

			const failure = yield* Effect.flip(
				repository.request({
					...original,
					payload: { value: 2 },
					inputHash: inputHash("same-scope", { value: 2 }),
				}),
			);
			expect(failure.message).toBe("Work key reused with different input");
			const [stored] = yield* session.run((db) =>
				db.select().from(scriptWork).where(eq(scriptWork.id, id)),
			);
			expect(stored?.payload).toEqual({ value: 1 });
		}),
	);

	test.effect("conflicts when one work key is reused across scopes", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const repository = yield* UserWorkRepository.make;
			const session = yield* DatabaseSession;
			const id = `user-work-scope-${crypto.randomUUID()}`;
			const original = workRow(fixture, {
				id,
				key: "same-key",
				scope: "first-scope",
				payload: { value: 1 },
			});
			yield* repository.request(original);

			const failure = yield* Effect.flip(
				repository.request({
					...original,
					scope: "second-scope",
					inputHash: inputHash("second-scope", { value: 1 }),
				}),
			);
			expect(failure.message).toBe("Work key reused with different input");
			const [stored] = yield* session.run((db) =>
				db.select().from(scriptWork).where(eq(scriptWork.id, id)),
			);
			expect(stored?.scope).toBe("first-scope");
		}),
	);
});

layer(userWorkHostLayer())((test) => {
	test.effect(
		"retains pending work pins, skips terminal replay retention, and rejects invalid or retired callers",
		() =>
			Effect.gen(function* () {
				const fixture = yield* UserWorkFixture;
				const session = yield* DatabaseSession;
				const host = yield* makeUserWorkScriptHost;
				const references = yield* SandboxWorkflowReferenceRepository.make;
				const calls = yield* UserWorkHostCalls;
				const key = `host-work-${crypto.randomUUID()}`;
				const request = workRequest(key);
				const first = yield* host.requestUserWork(runInput(fixture), request, workReference);
				const replay = yield* host.requestUserWork(runInput(fixture), request, workReference);
				expect(replay).toEqual(first);

				const [queued] = yield* session.run((db) =>
					db.select().from(scriptWork).where(eq(scriptWork.id, first.workId)),
				);
				expect(queued?.status).toBe("queued");
				expect(yield* references.listReferences(fixture.pluginId)).toMatchObject([
					{
						pluginId: fixture.pluginId,
						scriptId: fixture.targetScriptId,
						contentHash: fixture.principal.pluginRevision?.compiledHashes[targetSlug],
					},
				]);
				expect(yield* calls.dispatches).toEqual([
					{ inTransaction: false, executionId: first.workId, workflow: "UserWorkWorkflow" },
					{ inTransaction: false, executionId: first.workId, workflow: "UserWorkWorkflow" },
				]);

				yield* session.run((db) =>
					db.update(scriptWork).set({ status: "succeeded" }).where(eq(scriptWork.id, first.workId)),
				);
				yield* references.release(first.workId);
				expect(yield* host.requestUserWork(runInput(fixture), request, workReference)).toEqual(
					first,
				);
				expect(yield* references.listReferences(fixture.pluginId)).toEqual([]);

				const beforeDenials = yield* calls.dispatches;
				const denied = [
					{
						key: `${key}-system`,
						message: "not available for system executions",
						input: runInput(fixture, { ...fixture.principal, subject: { type: "system" } }),
					},
					{
						key: `${key}-unpinned`,
						message: "pinned user execution",
						input: runInput(fixture, { ...fixture.principal, pluginRevision: null }),
					},
					{
						key: `${key}-undeclared`,
						message: "not a declared dependency",
						input: runInput(fixture, {
							...fixture.principal,
							metadata: { ...fixture.principal.metadata, executableDependencies: [] },
						}),
					},
				];
				for (const entry of denied) {
					const failure = yield* Effect.flip(
						host.requestUserWork(entry.input, workRequest(entry.key), workReference),
					);
					expect(failure.message).toContain(entry.message);
					expect(
						yield* session.run((db) =>
							db.select().from(scriptWork).where(eq(scriptWork.key, entry.key)),
						),
					).toEqual([]);
				}

				yield* session.run((db) =>
					db
						.update(tables.user)
						.set({ accountGeneration: "replacement-generation" })
						.where(eq(tables.user.id, fixture.userId)),
				);
				for (const attempt of [1, 2]) {
					const retiredKey = `${key}-retired-${attempt}`;
					const failure = yield* Effect.flip(
						host.requestUserWork(runInput(fixture), workRequest(retiredKey), workReference),
					);
					expect(failure.message).toContain("Mutation command belongs to a retired account");
					expect(
						yield* session.run((db) =>
							db.select().from(scriptWork).where(eq(scriptWork.key, retiredKey)),
						),
					).toEqual([]);
				}
				expect(yield* calls.dispatches).toEqual(beforeDenials);
			}),
	);
});

layer(userWorkWorkflowLayer())((test) => {
	test.effect("marks successful and failed child executions as terminal work", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const repository = yield* UserWorkRepository.make;
			const session = yield* DatabaseSession;

			for (const [name, input, status] of [
				["success", "success", "succeeded"],
				["failure", "failure", "failed"],
			] as const) {
				const id = `user-work-${name}-${crypto.randomUUID()}`;
				const execution = scriptExecution(fixture, id, input);
				const payload = yield* Schema.encodeUnknownEffect(JsonValue)(execution);
				yield* repository.request(
					workRow(fixture, { id, key: id, payload, scope: "workflow-test" }),
				);
				yield* UserWorkWorkflow.execute({ id, execution });

				const [stored] = yield* session.run((db) =>
					db.select().from(scriptWork).where(eq(scriptWork.id, id)),
				);
				expect(stored?.status).toBe(status);
				if (status === "failed") {
					expect(stored?.error).toHaveLength(8192);
					expect(stored?.error).toContain("x".repeat(100));
				} else {
					expect(stored?.error).toBeNull();
				}
			}
		}),
	);

	test.effect("does not revive work after its account generation is retired", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const repository = yield* UserWorkRepository.make;
			const session = yield* DatabaseSession;
			const references = yield* SandboxWorkflowReferenceRepository.make;
			const id = `user-work-retired-${crypto.randomUUID()}`;
			const execution = scriptExecution(fixture, id, "success");
			const payload = yield* Schema.encodeUnknownEffect(JsonValue)(execution);
			yield* repository.request(
				workRow(fixture, { id, key: id, payload, scope: "retirement-test" }),
			);
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: "replacement-generation" })
					.where(eq(tables.user.id, fixture.userId)),
			);

			yield* UserWorkWorkflow.execute({ id, execution });
			const [stored] = yield* session.run((db) =>
				db.select().from(scriptWork).where(eq(scriptWork.id, id)),
			);
			expect(stored?.status).toBe("failed");
			expect(stored?.error).toContain("Mutation command belongs to a retired account");
			expect(yield* references.listReferences(fixture.pluginId)).toEqual([]);
		}),
	);
});
