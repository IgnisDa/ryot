import { DbError } from "@ryot-app/contract/errors";
import {
	type CreatePageBody,
	PageAuthoringError,
	type PageDraftRevisionBody,
	type PageOrigin,
	type ReplacePageDraftBody,
} from "@ryot-app/contract/modules/pages/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { storedValidationBranches } from "@ryot-app/ryotql-recipes/stored-validation";
import { Context, Effect, Layer } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { ClientArtifactsRepository } from "#modules/pages/bundles/repository";
import { ClientPluginCompiler } from "#modules/pages/compiler";
import { lockPluginIngestionShared } from "#modules/plugins/packages/ingestion-fence";
import { bindRyotQLDocument } from "#modules/ryotql/binding";
import { DatabaseSession } from "#platform/db/session";

import { definitionInvalid, preparePageDefinition } from "./definition";
import { PageAuthoringRepository } from "./repository";

type PageAuthoringActor = { readonly userId: UserId; readonly kind: PageOrigin };

export class PageAuthoringService extends Context.Service<PageAuthoringService>()(
	"@ryot-app/kernel-backend/modules/pages/authoring/service/PageAuthoringService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* PageAuthoringRepository;
			const compiler = yield* ClientPluginCompiler;
			const artifacts = yield* ClientArtifactsRepository;
			const catalogs = yield* DefinitionCatalog;
			const requirePage = Effect.fn(function* (userId: UserId, pageId: string, lock: boolean) {
				const row = yield* lock ? repository.lock(userId, pageId) : repository.find(userId, pageId);
				if (!row) {
					return yield* new PageAuthoringError({ reason: { code: "page-not-found" } });
				}
				return row;
			});
			const requireRevision = Effect.fn(function* (
				userId: UserId,
				input: PageDraftRevisionBody,
				lock: boolean,
			) {
				const row = yield* requirePage(userId, input.pageId, lock);
				if (row.draftRevision !== input.expectedDraftRevision) {
					return yield* new PageAuthoringError({
						reason: { code: "draft-revision-stale", draftRevision: row.draftRevision },
					});
				}
				return row;
			});
			const checkDependencies = Effect.fn(function* (
				userId: UserId,
				definition: CreatePageBody["definition"],
			) {
				const catalog = yield* catalogs.forUser(userId);
				for (const reference of Object.values(definition.pluginDependencies)) {
					const dependency = catalog.plugins.find(
						(plugin) =>
							plugin.packageId === reference.packageId &&
							plugin.scope === reference.scope &&
							plugin.isExecutable &&
							plugin.isDefinitionEffective &&
							plugin.health === "ready",
					);
					if (!dependency) {
						return yield* new PageAuthoringError({
							reason: { reference, code: "dependency-unavailable" },
						});
					}
				}
				return catalog;
			});
			const lockCatalog = Effect.fn(function* (userId: UserId) {
				yield* lockPluginIngestionShared(session, [userId]);
				yield* session.acquireUserWriteLock(userId);
			});
			const create = Effect.fn("PageAuthoringService.create")(function* (
				actor: PageAuthoringActor,
				input: CreatePageBody,
			) {
				const prepared = yield* preparePageDefinition(input.definition);
				return yield* session
					.transaction(
						Effect.gen(function* () {
							yield* lockCatalog(actor.userId);
							yield* checkDependencies(actor.userId, prepared.definition);
							return yield* repository.create(actor.userId, {
								...input,
								...prepared,
								origin: actor.kind,
							});
						}),
					)
					.pipe(
						Effect.mapError((error) =>
							error instanceof DbError && error.constraint === "page_user_slug_unique"
								? definitionInvalid("Page slug is already in use")
								: error,
						),
					);
			});
			const replaceDraft = Effect.fn("PageAuthoringService.replaceDraft")(function* (
				actor: PageAuthoringActor,
				input: ReplacePageDraftBody,
			) {
				const prepared = yield* preparePageDefinition(input.definition);
				return yield* session.transaction(
					Effect.gen(function* () {
						yield* lockCatalog(actor.userId);
						yield* requireRevision(actor.userId, input, true);
						yield* checkDependencies(actor.userId, prepared.definition);
						return yield* repository.replaceDraft(
							actor.userId,
							input.pageId,
							prepared.definition,
							prepared.definitionHash,
							actor.kind,
						);
					}),
				);
			});
			const build = Effect.fn("PageAuthoringService.build")(function* (
				userId: UserId,
				input: PageDraftRevisionBody,
				publish: boolean,
			) {
				yield* session.requireRoot;
				const current = yield* requireRevision(userId, input, false);
				const prepared = yield* preparePageDefinition(current.draftDefinition);
				yield* checkDependencies(userId, prepared.definition);
				const artifact = yield* compiler
					.compile(prepared.compilerInput)
					.pipe(
						Effect.mapError(
							(error) =>
								new PageAuthoringError({
									reason: {
										code: "build-failed",
										diagnostics: error.diagnostics.map(
											({ line, code, file, column, message, severity }) => ({
												line,
												code,
												file,
												column,
												message,
												severity,
											}),
										),
									},
								}),
						),
					);
				return yield* session.transaction(
					Effect.gen(function* () {
						yield* lockCatalog(userId);
						const locked = yield* requireRevision(userId, input, true);
						const catalog = yield* checkDependencies(userId, locked.draftDefinition);
						if (publish && Object.keys(locked.draftDefinition.queries.queries).length > 0) {
							const branches = yield* Effect.fromResult(
								storedValidationBranches(locked.draftDefinition.queries, catalog.entitySchemas),
							).pipe(Effect.mapError((error) => definitionInvalid(error.message)));
							for (const branch of branches) {
								yield* bindRyotQLDocument(
									branch,
									{
										userId,
										type: "user",
										language: null,
										audience: "plugin",
										accessClass: "standard",
									},
									catalog.plugins.filter(
										(plugin) => plugin.isExecutable && plugin.isDefinitionEffective,
									),
								).pipe(
									Effect.mapError(() =>
										definitionInvalid("Query references an unavailable plugin"),
									),
								);
							}
						}
						yield* artifacts.persistClientArtifact(artifact);
						yield* repository.recordBuild(userId, input.pageId, locked, artifact.hash, publish);
						return {
							pageId: input.pageId,
							artifactHash: artifact.hash,
							draftRevision: locked.draftRevision,
							definitionHash: locked.draftDefinitionHash,
						};
					}),
				);
			});
			const setWriteAccess = Effect.fn("PageAuthoringService.setWriteAccess")(function* (
				ownerUserId: UserId,
				pageId: string,
				writeAccess: boolean,
			) {
				return yield* session.transaction(
					Effect.gen(function* () {
						yield* requirePage(ownerUserId, pageId, true);
						return yield* repository.setWriteAccess(ownerUserId, pageId, writeAccess);
					}),
				);
			});
			const remove = Effect.fn("PageAuthoringService.remove")(function* (
				userId: UserId,
				pageId: string,
			) {
				return yield* session.transaction(
					Effect.gen(function* () {
						yield* requirePage(userId, pageId, true);
						return yield* repository.remove(userId, pageId);
					}),
				);
			});
			return {
				create,
				remove,
				replaceDraft,
				setWriteAccess,
				publish: (userId: UserId, input: PageDraftRevisionBody) => build(userId, input, true),
				compile: (userId: UserId, input: PageDraftRevisionBody) => build(userId, input, false),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
