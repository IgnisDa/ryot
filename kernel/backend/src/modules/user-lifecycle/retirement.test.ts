import { expect, layer } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { databaseLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { UserLifecycleRepository } from "./repository";
import { UserLifecycleWorkflowOperations, UserLifecycleWorkflowOperationsLive } from "./workflow";

const ownerWorkflow = Workflow.make("InjectedOwnerWorkflow", {
	error: Schema.Never,
	success: Schema.Void,
	payload: Schema.Struct({}),
	idempotencyKey: () => "owner",
});

const accessRevokedAt = new Date("2026-09-01T00:00:00Z");

const runRetirement = Effect.fnUntraced(function* (workflowName: string, calls: Array<string>) {
	const repository = yield* UserLifecycleRepository.make;
	const operation: NonNullable<
		Effect.Success<ReturnType<UserLifecycleRepository["Service"]["getInternalById"]>>
	> = {
		accessRevokedAt,
		workflowAttempt: 0,
		databaseCleanupCompletedAt: null,
		operation: {
			failure: null,
			kind: "delete",
			id: "operation",
			finishedAt: null,
			resetResult: null,
			status: "running",
			userId: UserId.make("owner"),
			createdAt: "2026-09-01T00:00:00Z",
			startedAt: "2026-09-01T00:00:00Z",
		},
		metadata: {
			apiKeys: [],
			accounts: [],
			locators: [],
			usesLocalAuth: false,
			recreatedAccountId: "account",
			user: {
				name: "Owner",
				disabledAt: null,
				emailVerified: true,
				id: UserId.make("owner"),
				email: "owner@example.test",
				accountGeneration: "original",
			},
		},
	};
	const engine = makeWorkflowEngine({
		interrupt: (workflow, executionId) =>
			Effect.sync(() => {
				expect(workflow).toBe(ownerWorkflow);
				expect(executionId).toBe("suspended-before-write");
				calls.push("interrupt");
			}),
	});
	const context = yield* Layer.build(
		UserLifecycleWorkflowOperationsLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(WorkflowEngine, engine),
					Layer.succeed(AdmittedWorkflowCatalogue, Object.freeze([ownerWorkflow])),
					Layer.succeed(UserLifecycleRepository, {
						...repository,
						getInternalById: () => Effect.succeed(operation),
						deleteUserData: () =>
							Effect.sync(() => {
								calls.push("delete");
							}),
						markDatabaseCleanupCompleted: () =>
							Effect.sync(() => {
								calls.push("complete");
							}),
						listUserMutationWork: () =>
							Effect.succeed([{ workflowName, executionId: "suspended-before-write" }]),
					}),
					Layer.mock(AuthService)({ handler: () => Effect.die("unused").pipe(Effect.runPromise) }),
					Layer.mock(ObjectStorageService)({}),
				),
			),
		),
	);
	return yield* Effect.flatMap(UserLifecycleWorkflowOperations, (operations) =>
		operations.deleteDatabaseUser("operation"),
	).pipe(Effect.provide(context), Effect.result);
}, Effect.scoped);

layer(databaseLayer)((test) => {
	test.effect(
		"retires a boot-injected owner before deleting receipts even when no source write occurred",
		() =>
			Effect.gen(function* () {
				const calls: Array<string> = [];
				expect((yield* runRetirement(ownerWorkflow._tag, calls))._tag).toBe("Success");
				expect(calls).toEqual(["interrupt", "delete", "complete"]);
			}),
	);

	test.effect("fails closed for a retained owner absent from the injected catalogue", () =>
		Effect.gen(function* () {
			const calls: Array<string> = [];
			expect((yield* runRetirement("UnknownOwnerWorkflow", calls))._tag).toBe("Failure");
			expect(calls).toEqual([]);
		}),
	);
});
