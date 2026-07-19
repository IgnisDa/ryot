import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { OperationalGateService } from "./operational-gate-service";
import { TestSupportService } from "./service";

export const TestSupportRoutesLive = HttpApiBuilder.group(AppContract, "testSupport", (handlers) =>
	handlers
		.handle("getSandboxScript", ({ params }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.getSandboxScript(params.scriptId);
			}).pipe(dieOnDbError),
		)
		.handle("listSandboxScripts", () =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listSandboxScripts();
			}).pipe(dieOnDbError),
		)
		.handle("enqueueSandbox", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.enqueueSandbox(payload);
			}).pipe(dieOnDbError),
		)
		.handle("getSandboxResult", ({ params, query }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.getSandboxResult(query.executingUserId, params.jobId);
			}).pipe(dieOnDbError),
		)
		.handle("deleteSandboxReplayProjection", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.deleteSandboxReplayProjection(payload.executionId);
			}).pipe(dieOnDbError),
		)
		.handle("startWorkflowLoadGate", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* OperationalGateService;
				return yield* svc.startWorkflowLoad(payload);
			}).pipe(dieOnDbError),
		)
		.handle("getWorkflowLoadGateResult", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* OperationalGateService;
				return yield* svc.getWorkflowLoadResult(payload);
			}).pipe(dieOnDbError),
		)
		.handle("sampleOperationalPressure", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* OperationalGateService;
				return yield* svc.samplePressure(payload.executionIds);
			}).pipe(dieOnDbError),
		)
		.handle("createGlobalEntity", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.createGlobalEntity(payload);
			}).pipe(dieOnDbError),
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
			}).pipe(dieOnDbError),
		)
		.handle("upsertGlobalRelationship", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.upsertGlobalRelationship(payload);
			}).pipe(dieOnDbError),
		)
		.handle("listGlobalRelationships", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listGlobalRelationships(payload);
			}).pipe(dieOnDbError),
		)
		.handle("getBuiltinEntitySchema", ({ params }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.getBuiltinEntitySchema(params.slug);
			}).pipe(dieOnDbError),
		)
		.handle("setEntityPopulatedAt", ({ params, payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.setEntityPopulatedAt(params.entityId, payload.populatedAt);
			}).pipe(dieOnDbError),
		)
		.handle("upsertEntityTranslation", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.upsertEntityTranslation(payload);
			}).pipe(dieOnDbError),
		)
		.handle("listEntityTranslations", ({ params }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listEntityTranslations(params.entityId);
			}).pipe(dieOnDbError),
		)
		.handle("linkAuthAccount", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.linkAuthAccount(payload);
			}).pipe(dieOnDbError),
		)
		.handle("triggerPluginCron", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.triggerPluginCron(payload);
			}).pipe(dieOnDbError),
		)
		.handle("triggerPluginBoot", () =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.triggerPluginBoot;
			}),
		)
		.handle("setEntityInterest", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				yield* svc.setEntityInterest(payload);
			}),
		)
		.handle("listSignals", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listSignals(payload);
			}).pipe(dieOnDbError),
		)
		.handle("listSubscriptionRuns", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listSubscriptionRuns(payload);
			}).pipe(dieOnDbError),
		)
		.handle("countAutomationRules", ({ params }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.countAutomationRules(params.userId);
			}).pipe(dieOnDbError),
		),
);
