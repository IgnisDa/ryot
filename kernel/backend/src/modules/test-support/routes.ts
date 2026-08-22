import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError, unknownToMessage } from "@ryot-app/contract/errors";
import {
	TestSupportBadRequest,
	TestSupportConflict,
	TestSupportNotFound,
	TestSupportOperationFailure,
} from "@ryot-app/contract/modules/test-support/schemas";
import { Effect, Match } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { AutomationReconciliation } from "#modules/automations/reconciliation";

import { BenchmarkProfilingService } from "./benchmark-profiling-service";
import { OperationalGateService } from "./operational-gate-service";
import { TestSupportService } from "./service";

const mapTestSupportFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.mapError((error) => {
			if (
				error instanceof TestSupportBadRequest ||
				error instanceof TestSupportNotFound ||
				error instanceof TestSupportConflict ||
				error instanceof TestSupportOperationFailure
			) {
				return error;
			}
			const diagnostic = unknownToMessage(error);
			return Match.value(error).pipe(
				Match.when(
					(value: unknown) => Reflect.get(Object(value), "_tag") === "BadRequest",
					() => new TestSupportBadRequest({ reason: { diagnostic, code: "invalid-request" } }),
				),
				Match.when(
					(value: unknown) => Reflect.get(Object(value), "_tag") === "NotFound",
					() => new TestSupportNotFound({ reason: { diagnostic, code: "resource-not-found" } }),
				),
				Match.when(
					(value: unknown) => Reflect.get(Object(value), "_tag") === "Conflict",
					() => new TestSupportConflict({ reason: { diagnostic, code: "resource-conflict" } }),
				),
				Match.orElse(
					() =>
						new TestSupportOperationFailure({ reason: { diagnostic, code: "operation-failed" } }),
				),
			);
		}),
	);

export const TestSupportRoutesLive = HttpApiBuilder.group(AppContract, "testSupport", (handlers) =>
	handlers
		.handle("getSandboxScript", ({ params }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.getSandboxScript(params.scriptId);
			}).pipe(mapTestSupportFailure),
		)
		.handle("listSandboxScripts", () =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listSandboxScripts();
			}).pipe(mapTestSupportFailure),
		)
		.handle("enqueueSandbox", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.enqueueSandbox(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("getSandboxResult", ({ query, params }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.getSandboxResult(query.executingUserId, params.jobId);
			}).pipe(mapTestSupportFailure),
		)
		.handle("deleteSandboxReplayProjection", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.deleteSandboxReplayProjection(payload.executionId);
			}).pipe(mapTestSupportFailure),
		)
		.handle("startWorkflowLoadGate", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* OperationalGateService;
				return yield* svc.startWorkflowLoad(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("getWorkflowLoadGateResult", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* OperationalGateService;
				return yield* svc.getWorkflowLoadResult(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("sampleOperationalPressure", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* OperationalGateService;
				return yield* svc.samplePressure(payload.executionIds);
			}).pipe(mapTestSupportFailure),
		)
		.handle("sampleSandboxRuntime", ({ query }) =>
			Effect.gen(function* () {
				const svc = yield* OperationalGateService;
				return yield* svc.sampleSandboxRuntime({
					includeSmaps: query.includeSmaps === "true",
					completedAfterSequence: query.completedAfterSequence ?? 0,
				});
			}).pipe(mapTestSupportFailure),
		)
		.handle("listProviderImportPhaseSegments", ({ query }) =>
			Effect.gen(function* () {
				const svc = yield* OperationalGateService;
				return yield* svc.listProviderImportPhaseSegments(query.afterSequence);
			}).pipe(mapTestSupportFailure),
		)
		.handle("armSandboxProfile", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* BenchmarkProfilingService;
				return yield* svc.armSandboxProfile(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("getSandboxProfileStatus", ({ params }) =>
			Effect.gen(function* () {
				const svc = yield* BenchmarkProfilingService;
				return yield* svc.getSandboxProfileStatus(params.token);
			}).pipe(mapTestSupportFailure),
		)
		.handle("disarmSandboxProfiles", () =>
			Effect.gen(function* () {
				const svc = yield* BenchmarkProfilingService;
				return yield* svc.disarmSandboxProfiles();
			}).pipe(mapTestSupportFailure),
		)
		.handle("captureBackendProfile", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* BenchmarkProfilingService;
				return yield* svc.captureBackendProfile(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("createGlobalEntity", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.createGlobalEntity(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("deleteGlobalEntities", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				const [first, ...rest] = payload.ids;
				if (!first) {
					return { deleted: 0 };
				}
				return { deleted: yield* svc.deleteGlobalEntities([first, ...rest]) };
			}).pipe(mapTestSupportFailure),
		)
		.handle("upsertGlobalRelationship", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.upsertGlobalRelationship(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("listGlobalRelationships", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listGlobalRelationships(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("getBuiltinEntitySchema", ({ params }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.getBuiltinEntitySchema(params.slug);
			}).pipe(mapTestSupportFailure),
		)
		.handle("setEntityPopulatedAt", ({ params, payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.setEntityPopulatedAt(params.entityId, payload.populatedAt);
			}).pipe(mapTestSupportFailure),
		)
		.handle("upsertEntityTranslation", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.upsertEntityTranslation(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("listEntityTranslations", ({ params }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listEntityTranslations(params.entityId);
			}).pipe(mapTestSupportFailure),
		)
		.handle("linkAuthAccount", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.linkAuthAccount(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("triggerPluginCron", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.triggerPluginCron(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("triggerPluginBoot", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.triggerPluginBoot(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("setEntityInterestMembership", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				yield* svc.setEntityInterestMembership(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("listAutomationTriggers", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listAutomationTriggers(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("listAutomationTriggerRecipients", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listAutomationTriggerRecipients(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("listAutomationRuns", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listAutomationRuns(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("reconcileAutomations", () =>
			Effect.gen(function* () {
				const reconciliation = yield* AutomationReconciliation;
				yield* reconciliation.reconcile();
			}).pipe(mapTestSupportFailure),
		)
		.handle("listAutomationRunAttempts", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listAutomationRunAttempts(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("installSystemPlugin", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.installSystemPlugin(payload).pipe(dieOnDbError);
			}),
		)
		.handle("installPrivatePlugin", ({ params, payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.installPrivatePlugin(params.userId, payload).pipe(dieOnDbError);
			}),
		)
		.handle("updatePrivatePlugin", ({ params, payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc
					.updatePrivatePlugin(params.userId, params.pluginSlug, payload)
					.pipe(dieOnDbError);
			}),
		)
		.handle("reconcilePluginInstallations", () =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				yield* svc.reconcilePluginInstallations;
			}).pipe(mapTestSupportFailure),
		)
		.handle("listSystemPlugins", () =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listSystemPlugins;
			}).pipe(mapTestSupportFailure),
		)
		.handle("uninstallSystemPlugin", ({ params }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.uninstallSystemPlugin(params.pluginSlug).pipe(dieOnDbError);
			}),
		)
		.handle("countAutomationRules", ({ params }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.countAutomationRules(params.userId);
			}).pipe(mapTestSupportFailure),
		),
);
