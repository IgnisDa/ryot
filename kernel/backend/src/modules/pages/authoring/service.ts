import { CompilerWorkerUnavailable } from "@ryot-app/compiler-worker/pool";
import { BadRequest, DbError } from "@ryot-app/contract/errors";
import type { PageDraftBuildIdentity } from "@ryot-app/contract/modules/pages/identity";
import {
	type CreatePageBody,
	PageAuthoringError,
	PageBuildResult,
	PageDraftResult,
	type PageDefinition,
	type PageDraftRevisionBody,
	PageMutationResult,
	type PageOrigin,
	type ReplacePageDraftBody,
} from "@ryot-app/contract/modules/pages/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { storedValidationBranches } from "@ryot-app/ryotql-recipes/stored-validation";
import { Context, Effect, Layer, Result } from "effect";

import { DefinitionCatalog, isReadyPackage } from "#modules/definitions/catalog";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { idempotencyIdentity, IdempotencyKeys } from "#modules/mutations/idempotency";
import { ClientArtifactsRepository } from "#modules/pages/bundles/repository";
import { ClientPluginCompiler } from "#modules/pages/compiler";
import { pageQueryDocument } from "#modules/pages/query-document";
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
			const keys = yield* IdempotencyKeys.make;
			const admission = yield* AccountAdmission.make;
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
					if (!catalog.plugins.some(isReadyPackage(reference))) {
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
				yield* admission.admitAccount(userId);
			});
			const onceDraft = <E, R>(
				actor: PageAuthoringActor,
				kind: string,
				request: unknown,
				idempotencyKey: string | undefined,
				write: Effect.Effect<typeof PageDraftResult.Type, E, R>,
			) =>
				idempotencyKey === undefined
					? write
					: keys
							.once(
								idempotencyIdentity({
									kind,
									key: idempotencyKey,
									userId: actor.userId,
									request: { actor, input: request },
								}),
								PageDraftResult,
								write,
							)
							.pipe(
								Effect.catchTag("IdempotencyConflict", () =>
									definitionInvalid("Page idempotency key was reused with different input"),
								),
							);
			const create = Effect.fn("PageAuthoringService.create")(function* (
				actor: PageAuthoringActor,
				input: CreatePageBody,
				idempotencyKey?: string,
			) {
				const prepared = yield* preparePageDefinition(input.definition);
				return yield* session
					.transaction(
						Effect.gen(function* () {
							yield* lockCatalog(actor.userId);
							yield* checkDependencies(actor.userId, prepared.definition);
							const write = repository.create(actor.userId, {
								...input,
								...prepared,
								origin: actor.kind,
							});
							return yield* idempotencyKey === undefined
								? write
								: keys
										.once(
											idempotencyIdentity({
												key: idempotencyKey,
												kind: "page:create",
												userId: actor.userId,
												request: { actor, input },
											}),
											PageDraftResult,
											write,
										)
										.pipe(
											Effect.catchTag("IdempotencyConflict", () =>
												definitionInvalid("Page idempotency key was reused with different input"),
											),
										);
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
				idempotencyKey?: string,
			) {
				const prepared = yield* preparePageDefinition(input.definition);
				const write = Effect.gen(function* () {
					yield* requireRevision(actor.userId, input, true);
					yield* checkDependencies(actor.userId, prepared.definition);
					return yield* repository.replaceDraft(
						actor.userId,
						input.pageId,
						prepared.definition,
						prepared.definitionHash,
						actor.kind,
					);
				});
				return yield* session.transaction(
					Effect.gen(function* () {
						yield* lockCatalog(actor.userId);
						return yield* onceDraft(actor, "page:replace", input, idempotencyKey, write);
					}),
				);
			});
			const editDraft = Effect.fn("PageAuthoringService.editDraft")(function* (
				actor: PageAuthoringActor,
				input: PageDraftRevisionBody,
				change: {
					readonly request: unknown;
					readonly apply: (definition: PageDefinition) => Result.Result<PageDefinition, string>;
				},
				idempotencyKey?: string,
			) {
				const write = Effect.gen(function* () {
					const row = yield* requireRevision(actor.userId, input, true);
					const prepared = yield* preparePageDefinition(
						yield* Effect.fromResult(change.apply(row.draftDefinition)).pipe(
							Effect.mapError((message) => new BadRequest({ message })),
						),
					);
					yield* checkDependencies(actor.userId, prepared.definition);
					return yield* repository.replaceDraft(
						actor.userId,
						input.pageId,
						prepared.definition,
						prepared.definitionHash,
						actor.kind,
					);
				});
				return yield* session.transaction(
					Effect.gen(function* () {
						yield* lockCatalog(actor.userId);
						return yield* onceDraft(
							actor,
							"page:edit",
							{ input, change: change.request },
							idempotencyKey,
							write,
						);
					}),
				);
			});
			const readDraft = Effect.fn("PageAuthoringService.readDraft")(function* (
				userId: UserId,
				pageId: string,
			) {
				const row = yield* requirePage(userId, pageId, false);
				return {
					name: row.name,
					slug: row.slug,
					pageId: row.id,
					definition: row.draftDefinition,
					draftRevision: row.draftRevision,
				};
			});
			const recordBuild = Effect.fn(function* (
				userId: UserId,
				pageId: string,
				locked: Effect.Success<ReturnType<typeof requirePage>>,
				artifactHash: string,
				publish: boolean,
			) {
				const catalog = yield* checkDependencies(userId, locked.draftDefinition);
				const document = yield* pageQueryDocument(catalogs, userId, locked.draftDefinition).pipe(
					Effect.mapError((error) => definitionInvalid(error.message)),
				);
				if (Object.keys(document.queries).length > 0) {
					const branches = yield* Effect.fromResult(
						storedValidationBranches(document, catalog.entitySchemas),
					).pipe(Effect.mapError((error) => definitionInvalid(error.message)));
					for (const branch of branches) {
						yield* bindRyotQLDocument(
							branch,
							{ userId, type: "user", language: null, audience: "plugin", accessClass: "standard" },
							catalog.plugins.filter(
								(plugin) => plugin.isExecutable && plugin.isDefinitionEffective,
							),
						).pipe(
							Effect.mapError(() => definitionInvalid("Query references an unavailable plugin")),
						);
					}
				}
				yield* repository.recordBuild(userId, pageId, locked, artifactHash, publish);
				return {
					pageId,
					artifactHash,
					draftRevision: locked.draftRevision,
					definitionHash: locked.draftDefinitionHash,
				};
			});
			const build = Effect.fn("PageAuthoringService.build")(function* (
				userId: UserId,
				input: PageDraftRevisionBody,
				publish: boolean,
				idempotencyKey?: string,
			) {
				yield* session.requireRoot;
				const identity =
					idempotencyKey === undefined
						? undefined
						: idempotencyIdentity({
								userId,
								request: input,
								key: idempotencyKey,
								kind: publish ? "page:publish" : "page:compile",
							});
				const replay =
					identity === undefined
						? null
						: yield* keys
								.read(identity, PageBuildResult)
								.pipe(
									Effect.catchTag("IdempotencyConflict", () =>
										definitionInvalid("Page idempotency key was reused with different input"),
									),
								);
				if (replay) {
					return replay.response;
				}
				const current = yield* requireRevision(userId, input, false);
				const prepared = yield* preparePageDefinition(current.draftDefinition);
				yield* checkDependencies(userId, prepared.definition);
				const artifact = yield* compiler
					.compile(prepared.compilerInput)
					.pipe(
						Effect.mapError(
							(error) =>
								new PageAuthoringError({
									reason:
										error instanceof CompilerWorkerUnavailable
											? { code: "compiler-unavailable" }
											: {
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
				const write = Effect.gen(function* () {
					const locked = yield* requireRevision(userId, input, true);
					yield* artifacts.persistClientArtifact(artifact);
					return yield* recordBuild(userId, input.pageId, locked, artifact.hash, publish);
				});
				return yield* session.transaction(
					Effect.gen(function* () {
						yield* lockCatalog(userId);
						return yield* identity === undefined
							? write
							: keys
									.once(identity, PageBuildResult, write)
									.pipe(
										Effect.catchTag("IdempotencyConflict", () =>
											definitionInvalid("Page idempotency key was reused with different input"),
										),
									);
					}),
				);
			});
			const publishCompiledDraft = Effect.fn("PageAuthoringService.publishCompiledDraft")(
				function* (userId: UserId, input: PageDraftBuildIdentity, idempotencyKey: string) {
					return yield* session
						.transaction(
							Effect.gen(function* () {
								yield* lockCatalog(userId);
								const identity = idempotencyIdentity({
									userId,
									request: input,
									key: idempotencyKey,
									kind: "page:publish-compiled-draft",
								});
								const replay = yield* keys.lockedRead(identity, PageBuildResult);
								if (replay) {
									return replay.response;
								}
								yield* repository.lock(userId, input.pageId);
								const current = yield* repository.findCompiledDraft(userId, input);
								if (!current) {
									return null;
								}
								const result = yield* recordBuild(
									userId,
									input.pageId,
									current,
									input.artifactHash,
									true,
								);
								yield* keys.record(identity, PageBuildResult, result);
								return result;
							}),
						)
						.pipe(
							Effect.catchTag("IdempotencyConflict", () =>
								definitionInvalid("Page idempotency key was reused with different input"),
							),
						);
				},
			);
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
				idempotencyKey?: string,
			) {
				const write = Effect.gen(function* () {
					yield* requirePage(userId, pageId, true);
					return yield* repository.remove(userId, pageId);
				});
				return yield* session.transaction(
					Effect.gen(function* () {
						yield* lockCatalog(userId);
						return yield* idempotencyKey === undefined
							? write
							: keys
									.once(
										idempotencyIdentity({
											userId,
											key: idempotencyKey,
											kind: "page:delete",
											request: { pageId },
										}),
										PageMutationResult,
										write,
									)
									.pipe(
										Effect.catchTag("IdempotencyConflict", () =>
											definitionInvalid("Page idempotency key was reused with different input"),
										),
									);
					}),
				);
			});
			return {
				create,
				remove,
				editDraft,
				readDraft,
				replaceDraft,
				setWriteAccess,
				publishCompiledDraft,
				publish: (userId: UserId, input: PageDraftRevisionBody, idempotencyKey?: string) =>
					build(userId, input, true, idempotencyKey),
				compile: (userId: UserId, input: PageDraftRevisionBody, idempotencyKey?: string) =>
					build(userId, input, false, idempotencyKey),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
