import { HttpApiBuilder } from "@effect/platform";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { TestSupportService } from "./service";

export const TestSupportRoutesLive = HttpApiBuilder.group(AppContract, "testSupport", (handlers) =>
	handlers
		.handle("getSandboxScript", ({ path }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).getSandboxScript(path.scriptId);
			}).pipe(dieOnDbError),
		)
		.handle("listSandboxScripts", ({ urlParams }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).listSandboxScripts(urlParams.userId ?? null);
			}).pipe(dieOnDbError),
		)
		.handle("patchSandboxScript", ({ path, payload }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).patchSandboxScript({
					...payload,
					scriptId: path.scriptId,
				});
			}).pipe(dieOnDbError),
		)
		.handle("promoteSandboxScript", ({ path }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).promoteSandboxScript(path.scriptId);
			}).pipe(dieOnDbError),
		)
		.handle("deleteSandboxScript", ({ path }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).deleteSandboxScript(path.scriptId);
			}).pipe(dieOnDbError),
		)
		.handle("linkSandboxScriptToEntitySchema", ({ path }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).linkSandboxScriptToEntitySchema({
					sandboxScriptId: path.scriptId,
					entitySchemaId: path.entitySchemaId,
				});
			}).pipe(dieOnDbError),
		)
		.handle("createGlobalEntity", ({ payload }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).createGlobalEntity(payload);
			}).pipe(dieOnDbError),
		)
		.handle("deleteGlobalEntities", ({ payload }) =>
			Effect.gen(function* () {
				const [first, ...rest] = payload.ids;
				if (!first) {
					return { deleted: 0 };
				}
				return {
					deleted: yield* (yield* TestSupportService).deleteGlobalEntities([first, ...rest]),
				};
			}).pipe(dieOnDbError),
		)
		.handle("upsertGlobalRelationship", ({ payload }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).upsertGlobalRelationship(payload);
			}).pipe(dieOnDbError),
		)
		.handle("listGlobalRelationships", ({ payload }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).listGlobalRelationships(payload);
			}).pipe(dieOnDbError),
		)
		.handle("getBuiltinEntitySchema", ({ path }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).getBuiltinEntitySchema(path.slug);
			}).pipe(dieOnDbError),
		)
		.handle("setEntityPopulatedAt", ({ path, payload }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).setEntityPopulatedAt(
					path.entityId,
					payload.populatedAt,
				);
			}).pipe(dieOnDbError),
		)
		.handle("upsertEntityTranslation", ({ payload }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).upsertEntityTranslation(payload);
			}).pipe(dieOnDbError),
		)
		.handle("listEntityTranslations", ({ path }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).listEntityTranslations(path.entityId);
			}).pipe(dieOnDbError),
		)
		.handle("linkAuthAccount", ({ payload }) =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).linkAuthAccount(payload);
			}).pipe(dieOnDbError),
		)
		.handle("triggerInfrequentCron", () =>
			Effect.gen(function* () {
				return yield* (yield* TestSupportService).triggerInfrequentCron();
			}),
		),
);
