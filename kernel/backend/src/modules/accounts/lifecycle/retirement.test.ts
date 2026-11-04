import { expect } from "bun:test";

import { UserId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { AuthService } from "#modules/accounts/auth/service";
import { UserBootstrap } from "#modules/accounts/provisioning/bootstrap";
import { ObjectStorageService } from "#modules/assets/storage/object-storage";
import { ImportsRepository } from "#modules/imports/repository";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";
import { PluginBootstrapEntities } from "#modules/plugins/installations/bootstrap-entities";
import { ingestionRetirementTestLayer } from "#modules/plugins/packages/ingestion-retirement.test-support";
import { WorkflowAccounts } from "#platform/workflow/account";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import { makeWorkflowEngine } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { UserLifecycleJobOperations, UserLifecycleJobOperationsLive } from "./job";
import { UserLifecycleRepository } from "./repository";

const ownerWorkflow = Workflow.make("InjectedOwnerWorkflow", {
	error: Schema.Never,
	success: Schema.Void,
	payload: Schema.Struct({}),
	idempotencyKey: () => "owner",
});

const accessRevokedAt = new Date("2026-09-01T00:00:00Z");

const runRetirement = Effect.fnUntraced(function* (calls: Array<string>) {
	const repository = yield* UserLifecycleRepository.make;
	const operation: NonNullable<
		Effect.Success<ReturnType<UserLifecycleRepository["Service"]["getInternalById"]>>
	> = {
		accessRevokedAt,
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
		poll: () => Effect.succeedNone,
		interrupt: (workflow, executionId) =>
			Effect.sync(() => {
				expect(workflow._tag).toBe(ownerWorkflow._tag);
				expect(executionId).toBe("suspended-before-write");
				calls.push("interrupt");
			}),
	});
	const context = yield* Layer.build(
		UserLifecycleJobOperationsLive.pipe(
			Layer.provide(ingestionRetirementTestLayer),
			Layer.provide(
				Layer.mergeAll(
					Layer.mock(UserBootstrap)({}),
					Layer.mock(PluginBootstrapEntities)({}),
					WorkflowExecutionNotifications.layer,
					Layer.succeed(WorkflowEngine, engine),
					Layer.succeed(AdmittedWorkflowCatalogue, Object.freeze([])),
					Layer.succeed(
						WorkflowAccounts,
						WorkflowAccounts.of({
							adopt: () => Effect.void,
							listActive: () =>
								Effect.succeed([
									{ workflowName: ownerWorkflow._tag, executionId: "suspended-before-write" },
								]),
						}),
					),
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
					}),
					Layer.mock(AuthService)({ handler: () => Promise.reject(new Error("unused")) }),
					Layer.mock(ObjectStorageService)({}),
				),
			),
		),
	);
	return yield* Effect.flatMap(UserLifecycleJobOperations, (operations) =>
		operations
			.cleanupObjects("operation")
			.pipe(Effect.andThen(operations.deleteDatabaseUser("operation"))),
	).pipe(Effect.provide(context), Effect.result);
}, Effect.scoped);

layer(
	ImportsRepository.layer.pipe(Layer.provideMerge(isolatedDatabaseLayer("lifecycle_retirement"))),
)((test) => {
	test.effect(
		"retires a boot-injected owner before deleting receipts even when no source write occurred",
		() =>
			Effect.gen(function* () {
				const calls: Array<string> = [];
				expect((yield* runRetirement(calls))._tag).toBe("Success");
				expect(calls).toEqual(["interrupt", "delete", "complete"]);
			}),
		testTimeout,
	);
});
