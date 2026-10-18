import { assert, expect, layer } from "@effect/vitest";
import { DbError, SandboxRunError } from "@ryot-app/contract/errors";
import { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { SandboxExecutionSubject } from "@ryot-app/contract/modules/scripts/schemas";
import { PluginId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import {
	BackgroundWorkExecutor,
	BackgroundWorkProjectionFinalizer,
} from "#modules/background-work/model";
import { BackgroundWorkRepository } from "#modules/background-work/repository";
import { BackgroundWorkService, BackgroundWorkWorkflow } from "#modules/background-work/service";
import {
	BackgroundWorkWorkflowLive,
	runBackgroundWorkWorkflow,
} from "#modules/background-work/workflow";
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
import { BackgroundWorkExecutorLive } from "#modules/scripts/executions/background-work";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { DatabaseSession } from "#platform/db/session";
import { backgroundWork } from "#schema/tables/background-work";
import * as tables from "#schema/tables/combined";
import {
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
	workflowEngineTestLayer,
} from "#testing/effect";

import { makeUserWorkScriptHost } from "./user-work";
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
		readonly status?: typeof backgroundWork.$inferSelect.status;
	},
): typeof backgroundWork.$inferInsert => ({
	id: input.id,
	key: input.key,
	scope: input.scope,
	userId: fixture.userId,
	payload: input.payload,
	purpose: "user-script",
	pluginId: fixture.pluginId,
	status: input.status ?? "queued",
	accountToken: fixture.accountGeneration.token,
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

const backgroundWorkInput = (
	fixture: UserWorkFixtureValue,
	input: {
		readonly id: string;
		readonly key: string;
		readonly scope: string;
		readonly input: JsonValue;
	},
) => {
	const pluginRevision = fixture.principal.pluginRevision;
	assert(pluginRevision);
	const contentHash = pluginRevision.compiledHashes[targetSlug];
	assert(contentHash);
	return {
		contentHash,
		id: input.id,
		key: input.key,
		scope: input.scope,
		featureInput: null,
		purpose: "user-script" as const,
		accountGeneration: fixture.accountGeneration,
		execution: scriptExecution(fixture, input.id, input.input),
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

const markRunning = (id: string) =>
	Effect.flatMap(DatabaseSession, (session) =>
		session.run((db) =>
			db.update(backgroundWork).set({ status: "running" }).where(eq(backgroundWork.id, id)),
		),
	);

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

class UserWorkChildCalls extends Context.Service<
	UserWorkChildCalls,
	{ readonly executions: Effect.Effect<ReadonlyArray<string>> }
>()("test/UserWorkChildCalls") {}

const userWorkHostLayer = () =>
	Layer.mergeAll(DomainWriteChecksLive, BackgroundWorkService.layer).pipe(
		Layer.provideMerge(
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
		),
		Layer.provideMerge(userWorkDatabaseLayer()),
	);

const admitQueued = (fixture: UserWorkFixtureValue, id: string, scope: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const work = yield* BackgroundWorkService;
		yield* session.transaction(
			work.admit(backgroundWorkInput(fixture, { id, scope, key: id, input: null })),
		);
	});

const expireWrapper = (id: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const now = yield* DateTime.nowAsDate;
		yield* session.run((db) =>
			db
				.insert(tables.workflowExecution)
				.values({
					expiredAt: now,
					executionId: id,
					status: "failed",
					completedAt: now,
					rootExecutionId: id,
					workflowName: BackgroundWorkWorkflow._tag,
					rootWorkflowName: BackgroundWorkWorkflow._tag,
				}),
		);
	});

const workStatus = (id: string) =>
	Effect.gen(function* () {
		const row = yield* (yield* BackgroundWorkRepository.make).get(id);
		return row?.status;
	});

const runBody = (id: string, execute: () => Effect.Effect<unknown, DbError>) => {
	const instance = WorkflowInstance.initial(BackgroundWorkWorkflow, id);
	return runBackgroundWorkWorkflow({ id }).pipe(
		Effect.provideService(BackgroundWorkExecutor, { execute }),
		Effect.provideService(BackgroundWorkProjectionFinalizer, {
			publish: () => Effect.die("Unexpected projection output"),
			failed: () => Effect.die("Unexpected projection failure"),
		}),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
	);
};

const dispatchedIds = Effect.gen(function* () {
	return (yield* (yield* UserWorkHostCalls).dispatches).map(({ executionId }) => executionId);
});

const workflowCallsFor = (id: string) =>
	Effect.gen(function* () {
		return (yield* dispatchedIds).filter((executionId) => executionId === id);
	});

const userWorkWorkflowLayer = () =>
	Layer.mergeAll(
		BackgroundWorkService.layer,
		BackgroundWorkWorkflowLive.pipe(
			Layer.provide(
				Layer.merge(
					BackgroundWorkExecutorLive,
					Layer.succeed(BackgroundWorkProjectionFinalizer, {
						publish: () => Effect.die("User-script work must not publish projections"),
						failed: () => Effect.die("User-script work must not finalize projections"),
					}),
				),
			),
		),
		Layer.unwrap(
			Effect.gen(function* () {
				const calls = yield* Ref.make<ReadonlyArray<string>>([]);
				return Layer.merge(
					Layer.succeed(UserWorkChildCalls, { executions: Ref.get(calls) }),
					ScriptExecutionWorkflow.toLayer((payload) =>
						Ref.update(calls, (all) => [...all, payload.executionId]).pipe(
							Effect.andThen(
								payload.input === "failure"
									? Effect.fail(
											new SandboxRunError({ kind: "script-failure", message: "x".repeat(9000) }),
										)
									: Effect.succeed(null),
							),
						),
					),
				);
			}),
		),
	).pipe(Layer.provideMerge(workflowEngineTestLayer), Layer.provideMerge(userWorkDatabaseLayer()));

layer(userWorkDatabaseLayer())((test) => {
	test.effect("replays an identical user-work request as one durable row", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const repository = yield* BackgroundWorkRepository.make;
			const session = yield* DatabaseSession;
			const id = `user-work-replay-${crypto.randomUUID()}`;
			const payload = yield* Schema.encodeUnknownEffect(JsonValue)(
				backgroundWorkInput(fixture, {
					id,
					key: "same-key",
					scope: "same-scope",
					input: { value: 1 },
				}),
			);
			const row = workRow(fixture, { id, payload, key: "same-key", scope: "same-scope" });

			expect(yield* repository.request(row)).toBe("queued");
			expect(yield* repository.request(row)).toBe("queued");
			expect(
				yield* session.run((db) =>
					db.select().from(backgroundWork).where(eq(backgroundWork.id, id)),
				),
			).toHaveLength(1);
		}),
	);

	test.effect("rejects changed input for one work ID without replacing its payload", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const repository = yield* BackgroundWorkRepository.make;
			const session = yield* DatabaseSession;
			const id = `user-work-changed-${crypto.randomUUID()}`;
			const payload = yield* Schema.encodeUnknownEffect(JsonValue)(
				backgroundWorkInput(fixture, {
					id,
					key: "same-key",
					scope: "same-scope",
					input: { value: 1 },
				}),
			);
			const changedPayload = yield* Schema.encodeUnknownEffect(JsonValue)(
				backgroundWorkInput(fixture, {
					id,
					key: "same-key",
					scope: "same-scope",
					input: { value: 2 },
				}),
			);
			const original = workRow(fixture, { id, payload, key: "same-key", scope: "same-scope" });
			yield* repository.request(original);

			const failure = yield* Effect.flip(
				repository.request({
					...original,
					payload: changedPayload,
					inputHash: inputHash("same-scope", changedPayload),
				}),
			);
			expect(failure.message).toBe("Work key reused with different input");
			const [stored] = yield* session.run((db) =>
				db.select().from(backgroundWork).where(eq(backgroundWork.id, id)),
			);
			expect(stored?.payload).toEqual(payload);
		}),
	);

	test.effect("conflicts when one work key is reused across scopes", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const repository = yield* BackgroundWorkRepository.make;
			const session = yield* DatabaseSession;
			const id = `user-work-scope-${crypto.randomUUID()}`;
			const payload = yield* Schema.encodeUnknownEffect(JsonValue)(
				backgroundWorkInput(fixture, {
					id,
					key: "same-key",
					input: { value: 1 },
					scope: "first-scope",
				}),
			);
			const changedScopePayload = yield* Schema.encodeUnknownEffect(JsonValue)(
				backgroundWorkInput(fixture, {
					id,
					key: "same-key",
					input: { value: 1 },
					scope: "second-scope",
				}),
			);
			const original = workRow(fixture, { id, payload, key: "same-key", scope: "first-scope" });
			yield* repository.request(original);

			const failure = yield* Effect.flip(
				repository.request({ ...original, scope: "second-scope", payload: changedScopePayload }),
			);
			expect(failure.message).toBe("Work key reused with different input");
			const [stored] = yield* session.run((db) =>
				db.select().from(backgroundWork).where(eq(backgroundWork.id, id)),
			);
			expect(stored?.scope).toBe("first-scope");
		}),
	);

	test.effect("rejects work ID reuse across users, plugins, and account generations", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const repository = yield* BackgroundWorkRepository.make;
			const id = `user-work-owner-conflict-${crypto.randomUUID()}`;
			const payload = yield* Schema.encodeUnknownEffect(JsonValue)(
				backgroundWorkInput(fixture, {
					id,
					key: "same-key",
					scope: "same-scope",
					input: { value: 1 },
				}),
			);
			const original = workRow(fixture, { id, payload, key: "same-key", scope: "same-scope" });
			yield* repository.request(original);

			for (const conflict of [
				{ ...original, userId: UserId.make("recipient") },
				{ ...original, pluginId: PluginId.make("different-plugin") },
				{ ...original, accountToken: "different-account-generation" },
			]) {
				const failure = yield* Effect.flip(repository.request(conflict));
				expect(failure.message).toBe("Work key reused with different input");
			}
		}),
	);

	test.effect("does not start work after settlement", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const repository = yield* BackgroundWorkRepository.make;
			const id = `user-work-settled-${crypto.randomUUID()}`;
			const payload = yield* Schema.encodeUnknownEffect(JsonValue)(
				backgroundWorkInput(fixture, {
					id,
					key: id,
					input: { value: 1 },
					scope: "terminal-transition",
				}),
			);
			yield* repository.request(
				workRow(fixture, { id, key: id, payload, scope: "terminal-transition" }),
			);
			expect(yield* repository.settle(id, "succeeded")).toBe(true);
			expect(yield* repository.start(id)).toBeNull();
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
				const work = yield* BackgroundWorkService;
				const host = yield* makeUserWorkScriptHost;
				const references = yield* SandboxWorkflowReferenceRepository.make;
				const calls = yield* UserWorkHostCalls;
				const key = `host-work-${crypto.randomUUID()}`;
				const request = workRequest(key);
				const first = yield* host.requestUserWork(runInput(fixture), request, workReference);
				const replay = yield* host.requestUserWork(runInput(fixture), request, workReference);
				expect(replay).toEqual(first);

				const [queued] = yield* session.run((db) =>
					db.select().from(backgroundWork).where(eq(backgroundWork.id, first.workId)),
				);
				expect(queued?.status).toBe("running");
				expect(queued?.payload).toMatchObject({
					id: first.workId,
					key: request.key,
					featureInput: null,
					scope: request.scope,
					purpose: "user-script",
					accountGeneration: fixture.accountGeneration,
					execution: { executionId: `${first.workId}-script` },
					contentHash: fixture.principal.pluginRevision?.compiledHashes[targetSlug],
				});
				expect(yield* references.listReferences(fixture.pluginId)).toMatchObject([
					{
						pluginId: fixture.pluginId,
						scriptId: fixture.targetScriptId,
						contentHash: fixture.principal.pluginRevision?.compiledHashes[targetSlug],
					},
				]);
				expect(yield* calls.dispatches).toEqual([
					{ inTransaction: false, executionId: first.workId, workflow: "BackgroundWorkWorkflow" },
					{ inTransaction: false, executionId: first.workId, workflow: "BackgroundWorkWorkflow" },
				]);

				yield* work.finish(first.workId, "succeeded");
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
							db.select().from(backgroundWork).where(eq(backgroundWork.key, entry.key)),
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
							db.select().from(backgroundWork).where(eq(backgroundWork.key, retiredKey)),
						),
					).toEqual([]);
				}
				expect(yield* calls.dispatches).toEqual(beforeDenials);
				yield* session.run((db) =>
					db
						.update(tables.user)
						.set({ accountGeneration: fixture.accountGeneration.token })
						.where(eq(tables.user.id, fixture.userId)),
				);
			}),
	);

	test.effect("recovers admitted user work by dispatching the common workflow", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const session = yield* DatabaseSession;
			const work = yield* BackgroundWorkService;
			const calls = yield* UserWorkHostCalls;
			const id = `user-work-recover-${crypto.randomUUID()}`;
			const before = yield* calls.dispatches;
			const input = backgroundWorkInput(fixture, {
				id,
				key: id,
				input: { value: 1 },
				scope: "recover-test",
			});

			yield* session.transaction(work.admit(input));
			yield* work.recover();

			expect((yield* calls.dispatches).slice(before.length)).toContainEqual({
				executionId: id,
				inTransaction: false,
				workflow: "BackgroundWorkWorkflow",
			});
			yield* work.finish(id, "failed");
		}),
	);

	test.effect("keeps a second job in one scope queued until the first settles, then runs it", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const work = yield* BackgroundWorkService;
			const scope = `serial-${crypto.randomUUID()}`;
			const first = `${scope}-first`;
			const second = `${scope}-second`;
			yield* admitQueued(fixture, first, scope);
			yield* admitQueued(fixture, second, scope);

			yield* work.dispatch(first);
			yield* work.dispatch(second);
			expect(yield* workStatus(first)).toBe("running");
			expect(yield* workStatus(second)).toBe("queued");
			expect(yield* workflowCallsFor(second)).toEqual([]);

			yield* runBody(first, () => Effect.void);
			expect(yield* workStatus(first)).toBe("succeeded");
			expect(yield* workStatus(second)).toBe("running");
			expect(yield* workflowCallsFor(second)).toEqual([second]);
		}),
	);

	test.effect("runs jobs concurrently across scopes and across purposes in one scope", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const work = yield* BackgroundWorkService;
			const repository = yield* BackgroundWorkRepository.make;
			const scope = `parallel-${crypto.randomUUID()}`;
			const otherScope = `${scope}-other`;
			const userJob = `${scope}-user`;
			const otherScopeJob = `${scope}-other-scope`;
			const projectionJob = `${scope}-projection`;
			yield* admitQueued(fixture, userJob, scope);
			yield* admitQueued(fixture, otherScopeJob, otherScope);
			yield* repository.request({
				...workRow(fixture, { scope, payload: {}, id: projectionJob, key: projectionJob }),
				purpose: "event-projection",
			});

			for (const id of [userJob, otherScopeJob, projectionJob]) {
				yield* work.dispatch(id);
			}
			expect([
				yield* workStatus(userJob),
				yield* workStatus(otherScopeJob),
				yield* workStatus(projectionJob),
			]).toEqual(["running", "running", "running"]);
		}),
	);

	test.effect("hands the scope to the next job when the running job fails", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const work = yield* BackgroundWorkService;
			const scope = `failure-${crypto.randomUUID()}`;
			const first = `${scope}-first`;
			const second = `${scope}-second`;
			yield* admitQueued(fixture, first, scope);
			yield* admitQueued(fixture, second, scope);
			yield* work.dispatch(first);

			yield* runBody(first, () => Effect.fail(new DbError({ message: "boom" })));
			expect(yield* workStatus(first)).toBe("failed");
			expect(yield* workStatus(second)).toBe("running");
			expect(yield* workflowCallsFor(second)).toEqual([second]);
		}),
	);

	test.effect("fails a running job whose wrapper expired and dispatches the next job", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const work = yield* BackgroundWorkService;
			const scope = `expired-${crypto.randomUUID()}`;
			const first = `${scope}-first`;
			const second = `${scope}-second`;
			yield* admitQueued(fixture, first, scope);
			yield* admitQueued(fixture, second, scope);
			yield* work.dispatch(first);
			yield* expireWrapper(first);

			yield* work.recover();
			expect(yield* workStatus(first)).toBe("failed");
			expect(yield* workStatus(second)).toBe("running");
			expect(yield* workflowCallsFor(second)).toEqual([second]);
		}),
	);

	test.effect("recovers a job claimed before its workflow was executed", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const work = yield* BackgroundWorkService;
			const id = `claimed-${crypto.randomUUID()}`;
			yield* admitQueued(fixture, id, id);
			yield* markRunning(id);
			expect(yield* workflowCallsFor(id)).toEqual([]);

			yield* work.recover();
			expect(yield* workflowCallsFor(id)).toEqual([id]);
			expect(yield* workStatus(id)).toBe("running");
		}),
	);

	test.effect("claims exactly one row when one scope is dispatched concurrently", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const session = yield* DatabaseSession;
			const work = yield* BackgroundWorkService;
			const scope = `race-${crypto.randomUUID()}`;
			const ids = [0, 1, 2].map((index) => `${scope}-${index}`);
			for (const id of ids) {
				yield* admitQueued(fixture, id, scope);
			}

			yield* Effect.forEach(ids, (id) => work.dispatch(id), { concurrency: "unbounded" });
			const rows = yield* session.run((db) =>
				db.select().from(backgroundWork).where(eq(backgroundWork.scope, scope)),
			);
			expect(rows.filter(({ status }) => status === "running")).toHaveLength(1);
			expect(rows.filter(({ status }) => status === "queued")).toHaveLength(2);
		}),
	);

	test.effect("heals an expired head in one recovery pass despite many queued rows elsewhere", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const session = yield* DatabaseSession;
			const work = yield* BackgroundWorkService;
			const base = `crowd-${crypto.randomUUID()}`;
			const crowdScope = `${base}-crowd`;
			const scope = `${base}-target`;
			const first = `${scope}-first`;
			const second = `${scope}-second`;
			const old = DateTime.toDateUtc(DateTime.makeUnsafe(0));
			yield* session.run((db) =>
				db
					.insert(backgroundWork)
					.values(
						Array.from({ length: 102 }, (_, index) => ({
							...workRow(fixture, {
								payload: {},
								scope: crowdScope,
								id: `${crowdScope}-${index}`,
								key: `${crowdScope}-${index}`,
								status: index === 0 ? ("running" as const) : ("queued" as const),
							}),
							createdAt: old,
							updatedAt: old,
						})),
					),
			);
			yield* admitQueued(fixture, first, scope);
			yield* admitQueued(fixture, second, scope);
			yield* work.dispatch(first);
			yield* expireWrapper(first);

			yield* work.recover();
			expect(yield* workStatus(first)).toBe("failed");
			expect(yield* workStatus(second)).toBe("running");
			expect(yield* workflowCallsFor(second)).toEqual([second]);
			yield* session.run((db) =>
				db
					.update(backgroundWork)
					.set({ status: "failed" })
					.where(eq(backgroundWork.scope, crowdScope)),
			);
		}),
	);

	test.effect("fails an expired running head when its scope is dispatched", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const work = yield* BackgroundWorkService;
			const repository = yield* BackgroundWorkRepository.make;
			const scope = `heal-${crypto.randomUUID()}`;
			const first = `${scope}-first`;
			const second = `${scope}-second`;
			yield* admitQueued(fixture, first, scope);
			yield* admitQueued(fixture, second, scope);
			yield* work.dispatch(first);
			yield* expireWrapper(first);

			yield* work.dispatch(second);
			expect((yield* repository.get(first))?.error).toBe(
				"Background workflow ended before settlement",
			);
			expect(yield* workStatus(first)).toBe("failed");
			expect(yield* workStatus(second)).toBe("running");
		}),
	);

	test.effect("rolls back work admission and its retained reference", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const session = yield* DatabaseSession;
			const work = yield* BackgroundWorkService;
			const references = yield* SandboxWorkflowReferenceRepository.make;
			const id = `user-work-rollback-${crypto.randomUUID()}`;
			const input = backgroundWorkInput(fixture, {
				id,
				key: id,
				input: { value: 1 },
				scope: "rollback-test",
			});
			const failure = new DbError({ message: "rollback admission" });

			assertExitFails(
				yield* Effect.exit(
					session.transaction(work.admit(input).pipe(Effect.andThen(Effect.fail(failure)))),
				),
				failure,
			);
			expect(
				yield* session.run((db) =>
					db.select().from(backgroundWork).where(eq(backgroundWork.id, id)),
				),
			).toEqual([]);
			expect(
				(yield* references.listReferences(fixture.pluginId)).filter(
					({ executionId }) => executionId === id,
				),
			).toEqual([]);
		}),
	);

	test.effect("retains suspended work and resumes it without recording a failure", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const session = yield* DatabaseSession;
			const work = yield* BackgroundWorkService;
			const repository = yield* BackgroundWorkRepository.make;
			const references = yield* SandboxWorkflowReferenceRepository.make;
			const id = `user-work-suspended-${crypto.randomUUID()}`;
			yield* session.transaction(
				work.admit(backgroundWorkInput(fixture, { id, key: id, input: null, scope: "suspension" })),
			);
			yield* markRunning(id);
			const suspended = WorkflowInstance.initial(BackgroundWorkWorkflow, id);
			const failure = yield* Effect.exit(
				runBackgroundWorkWorkflow({ id }).pipe(
					Effect.provideService(BackgroundWorkExecutor, {
						execute: () =>
							Effect.gen(function* () {
								suspended.suspended = true;
								return yield* Effect.interrupt;
							}),
					}),
					Effect.provideService(BackgroundWorkProjectionFinalizer, {
						publish: () => Effect.die("Unexpected projection output"),
						failed: () => Effect.die("Unexpected projection failure"),
					}),
					Effect.provideService(WorkflowInstance, suspended),
					Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(suspended)),
				),
			);
			expect(failure._tag).toBe("Failure");
			expect(yield* repository.get(id)).toMatchObject({ error: null, status: "running" });
			expect(
				(yield* references.listReferences(fixture.pluginId)).some(
					({ executionId }) => executionId === id,
				),
			).toBe(true);
			const resumed = WorkflowInstance.initial(BackgroundWorkWorkflow, id);
			yield* runBackgroundWorkWorkflow({ id }).pipe(
				Effect.provideService(BackgroundWorkExecutor, { execute: () => Effect.succeed(null) }),
				Effect.provideService(BackgroundWorkProjectionFinalizer, {
					publish: () => Effect.die("Unexpected projection output"),
					failed: () => Effect.die("Unexpected projection failure"),
				}),
				Effect.provideService(WorkflowInstance, resumed),
				Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(resumed)),
			);
			expect(yield* repository.get(id)).toMatchObject({ error: null, status: "succeeded" });
			expect(
				(yield* references.listReferences(fixture.pluginId)).some(
					({ executionId }) => executionId === id,
				),
			).toBe(false);
		}),
	);

	test.effect(
		"settles expired workflow jobs and rejects purpose changes without retaining resources",
		() =>
			Effect.gen(function* () {
				const fixture = yield* UserWorkFixture;
				const session = yield* DatabaseSession;
				const work = yield* BackgroundWorkService;
				const repository = yield* BackgroundWorkRepository.make;
				const references = yield* SandboxWorkflowReferenceRepository.make;
				const calls = yield* UserWorkHostCalls;
				const id = `user-work-expired-${crypto.randomUUID()}`;
				const job = backgroundWorkInput(fixture, { id, key: id, input: null, scope: "expiry" });
				const denied = { ...job, id: `${id}-invalid`, purpose: "event-projection" as const };
				assertExitFails(
					yield* Effect.exit(session.transaction(work.admit(denied))),
					new DbError({ message: "Background work requires exact purpose-bound user authority" }),
				);
				expect(yield* repository.get(denied.id)).toBeNull();
				yield* session.transaction(work.admit(job));
				yield* markRunning(id);
				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.insert(tables.workflowExecution)
						.values({
							expiredAt: now,
							executionId: id,
							status: "failed",
							completedAt: now,
							rootExecutionId: id,
							workflowName: BackgroundWorkWorkflow._tag,
							rootWorkflowName: BackgroundWorkWorkflow._tag,
						}),
				);
				const before = yield* calls.dispatches;
				yield* work.recover();
				expect((yield* calls.dispatches).filter(({ executionId }) => executionId === id)).toEqual(
					before.filter(({ executionId }) => executionId === id),
				);
				expect(yield* repository.get(id)).toMatchObject({ status: "failed" });
				expect(yield* repository.start(id)).toBeNull();
				expect(yield* work.finish(id, "succeeded")).toBe(false);
				expect(
					(yield* references.listReferences(fixture.pluginId)).some(
						({ executionId }) => executionId === id,
					),
				).toBe(false);
			}),
	);
});

layer(userWorkWorkflowLayer())((test) => {
	test.effect("coalesces concurrent dispatch and uses a fresh child for an intentional retry", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const session = yield* DatabaseSession;
			const work = yield* BackgroundWorkService;
			const engine = yield* WorkflowEngine;
			const calls = yield* UserWorkChildCalls;
			const id = `user-work-concurrent-${crypto.randomUUID()}`;
			yield* session.transaction(
				work.admit(
					backgroundWorkInput(fixture, { id, key: id, input: "failure", scope: "concurrency" }),
				),
			);
			yield* markRunning(id);
			yield* Effect.forEach(
				[0, 1],
				() => engine.execute(BackgroundWorkWorkflow, { executionId: id, payload: { id } }),
				{ concurrency: "unbounded" },
			);
			expect(
				(yield* calls.executions).filter((executionId) => executionId === `${id}-script`),
			).toEqual([`${id}-script`]);
			const retryId = `${id}-retry`;
			yield* session.transaction(
				work.admit(
					backgroundWorkInput(fixture, {
						id: retryId,
						key: retryId,
						input: "success",
						scope: "concurrency",
					}),
				),
			);
			yield* markRunning(retryId);
			yield* engine.execute(BackgroundWorkWorkflow, {
				executionId: retryId,
				payload: { id: retryId },
			});
			expect((yield* calls.executions).filter((executionId) => executionId.startsWith(id))).toEqual(
				[`${id}-script`, `${retryId}-script`],
			);
			expect((yield* (yield* BackgroundWorkRepository.make).get(retryId))?.status).toBe(
				"succeeded",
			);
		}),
	);

	test.effect("marks successful and failed child executions as terminal work", () =>
		Effect.gen(function* () {
			const fixture = yield* UserWorkFixture;
			const work = yield* BackgroundWorkService;
			const session = yield* DatabaseSession;

			for (const [name, input, status] of [
				["success", "success", "succeeded"],
				["failure", "failure", "failed"],
			] as const) {
				const id = `user-work-${name}-${crypto.randomUUID()}`;
				const job = backgroundWorkInput(fixture, { id, input, key: id, scope: "workflow-test" });
				yield* session.transaction(work.admit(job));
				yield* markRunning(id);
				yield* BackgroundWorkWorkflow.execute({ id });

				const [stored] = yield* session.run((db) =>
					db.select().from(backgroundWork).where(eq(backgroundWork.id, id)),
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
			const work = yield* BackgroundWorkService;
			const session = yield* DatabaseSession;
			const references = yield* SandboxWorkflowReferenceRepository.make;
			const id = `user-work-retired-${crypto.randomUUID()}`;
			const job = backgroundWorkInput(fixture, {
				id,
				key: id,
				input: "success",
				scope: "retirement-test",
			});
			yield* session.transaction(work.admit(job));
			yield* markRunning(id);
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: "replacement-generation" })
					.where(eq(tables.user.id, fixture.userId)),
			);

			yield* BackgroundWorkWorkflow.execute({ id });
			const [stored] = yield* session.run((db) =>
				db.select().from(backgroundWork).where(eq(backgroundWork.id, id)),
			);
			expect(stored?.status).toBe("failed");
			expect(stored?.error).toContain("Mutation command belongs to a retired account");
			expect(yield* references.listReferences(fixture.pluginId)).toEqual([]);
		}),
	);
});
