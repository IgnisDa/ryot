import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError, unknownToMessage } from "@ryot/contract/errors";
import {
	TestSupportBadRequest,
	TestSupportConflict,
	TestSupportNotFound,
	TestSupportOperationFailure,
} from "@ryot/contract/modules/test-support/schemas";
import { Effect, Match } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

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
					() => new TestSupportBadRequest({ reason: { code: "invalid-request", diagnostic } }),
				),
				Match.when(
					(value: unknown) => Reflect.get(Object(value), "_tag") === "NotFound",
					() => new TestSupportNotFound({ reason: { code: "resource-not-found", diagnostic } }),
				),
				Match.when(
					(value: unknown) => Reflect.get(Object(value), "_tag") === "Conflict",
					() => new TestSupportConflict({ reason: { code: "resource-conflict", diagnostic } }),
				),
				Match.orElse(
					() =>
						new TestSupportOperationFailure({
							reason: { code: "operation-failed", diagnostic },
						}),
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
		.handle("getSandboxResult", ({ params, query }) =>
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
		.handle("sampleSandboxRuntime", () =>
			Effect.gen(function* () {
				const svc = yield* OperationalGateService;
				return yield* svc.sampleSandboxRuntime();
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
				return {
					deleted: yield* svc.deleteGlobalEntities([first, ...rest]),
				};
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
		.handle("listSignals", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listSignals(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("listSubscriptionRuns", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listSubscriptionRuns(payload);
			}).pipe(mapTestSupportFailure),
		)
		.handle("installSystemPlugin", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.installSystemPlugin(payload).pipe(dieOnDbError);
			}).pipe(mapTestSupportFailure),
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
				return yield* svc.listSystemPlugins();
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
