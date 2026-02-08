import { HttpApiBuilder } from "@effect/platform";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { TestSupportService } from "./service";

export const TestSupportRoutesLive = HttpApiBuilder.group(AppContract, "testSupport", (handlers) =>
	handlers
		.handle("getSandboxScript", ({ path }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.getSandboxScript(path.scriptId);
			}).pipe(dieOnDbError),
		)
		.handle("listSandboxScripts", ({ urlParams }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listSandboxScripts(urlParams.userId ?? null);
			}).pipe(dieOnDbError),
		)
		.handle("patchSandboxScript", ({ path, payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.patchSandboxScript({
					...payload,
					scriptId: path.scriptId,
				});
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
		.handle("getBuiltinEntitySchema", ({ path }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.getBuiltinEntitySchema(path.slug);
			}).pipe(dieOnDbError),
		)
		.handle("setEntityPopulatedAt", ({ path, payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.setEntityPopulatedAt(path.entityId, payload.populatedAt);
			}).pipe(dieOnDbError),
		)
		.handle("upsertEntityTranslation", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.upsertEntityTranslation(payload);
			}).pipe(dieOnDbError),
		)
		.handle("listEntityTranslations", ({ path }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.listEntityTranslations(path.entityId);
			}).pipe(dieOnDbError),
		)
		.handle("linkAuthAccount", ({ payload }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.linkAuthAccount(payload);
			}).pipe(dieOnDbError),
		)
		.handle("triggerInfrequentCron", () =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.triggerInfrequentCron();
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
		.handle("countAutomationRules", ({ path }) =>
			Effect.gen(function* () {
				const svc = yield* TestSupportService;
				return yield* svc.countAutomationRules(path.userId);
			}).pipe(dieOnDbError),
		),
);
