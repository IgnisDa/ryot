import { expect } from "bun:test";

import { CompilerWorkerUnavailable } from "@ryot-app/compiler-worker/pool";
import { BadRequest } from "@ryot-app/contract/errors";
import { PageAuthoringError, type PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import { PluginPackageId, UserId } from "@ryot-app/contract/schema/brands";
import {
	clientPluginCompilationFailure,
	clientPluginCompilerDiagnostic,
} from "@ryot-app/plugin-client-compiler/diagnostics";
import { clientArtifactFile, pageClientArtifactMetadata } from "@ryot-app/plugin-client-contract";
import { pageRecipe, pagesRecipe } from "@ryot-app/ryotql-recipes/pages";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { layer } from "@voila.dev/effect-bun-test";
import { sql } from "drizzle-orm";
import { Context, Deferred, Effect, Fiber, Layer, Result } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { ClientArtifactsRepository } from "#modules/pages/bundles/repository";
import { ClientPluginCompiler } from "#modules/pages/compiler";
import { RyotQLService } from "#modules/ryotql/service";
import { RyotQLSources } from "#modules/ryotql/sources";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { PageAuthoringRepository } from "./repository";
import { PageAuthoringService } from "./service";

const owner = UserId.make("page-owner");
const other = UserId.make("page-other");
const definition: PageDefinition = {
	pluginDependencies: {},
	entry: "client/page.tsx",
	files: [
		{
			path: "client/page.tsx",
			content: Buffer.from("export default () => null;").toString("base64"),
		},
	],
	queries: {
		queries: {
			items: {
				from: { alias: "item", table: "entity" },
				output: {
					type: "rows",
					pagination: { limit: 1, maxLimit: 10 },
					fields: [{ key: "id", expr: { field: "id", type: "column", tableAlias: "item" } }],
					orderBy: [
						{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "item" } },
					],
				},
			},
		},
	},
};
const CompileGate = Context.Reference<Effect.Effect<void>>("test/PageCompileGate", {
	defaultValue: () => Effect.void,
});
const CompileFailure = Context.Reference<"none" | "diagnostics" | "unavailable">(
	"test/PageCompileFailure",
	{ defaultValue: () => "none" },
);
const file = clientArtifactFile({
	path: "page.js",
	contentType: "text/javascript",
	bytes: new TextEncoder().encode("export default () => null;"),
});
const compiler = Layer.effect(
	ClientPluginCompiler,
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		return {
			compile: (input) =>
				Effect.gen(function* () {
					expect(yield* session.isTransactionActive).toBe(false);
					yield* yield* CompileGate;
					const compileFailure = yield* CompileFailure;
					if (compileFailure === "unavailable") {
						return yield* new CompilerWorkerUnavailable({ message: "Compiler worker exited" });
					}
					if (compileFailure === "diagnostics") {
						return yield* clientPluginCompilationFailure([
							{
								...clientPluginCompilerDiagnostic("TEST", "client/page.tsx", "Invalid page"),
								length: 7,
							},
						]);
					}
					return {
						...pageClientArtifactMetadata(input.name, [file], {
							imports: [],
							pageDeclarationHash: input.pageDeclarationHash,
						}),
						files: [file],
					};
				}),
		};
	}),
);
const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db.execute(
			sql`create table page_reference_test (page_id text not null, user_id text not null, foreign key (page_id, user_id) references page(id, user_id) on delete restrict)`,
		),
	);
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db.insert(tables.user).values([
				{ id: owner, name: "Page owner", email: "page-owner@test.local" },
				{ id: other, name: "Other", email: "page-other@test.local" },
			]);
			yield* db.insert(tables.entity).values([
				{ id: "first", userId: owner, name: "First", entitySchemaSlug: "root" },
				{ id: "second", userId: owner, name: "Second", entitySchemaSlug: "root" },
				{ id: "other", userId: other, name: "Other", entitySchemaSlug: "root" },
			]);
		}),
	);
});
const services = Layer.mergeAll(
	PageAuthoringService.layer,
	RyotQLService.layer,
	RyotQLSources.layer,
).pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			PageAuthoringRepository.layer,
			ClientArtifactsRepository.layer,
			DefinitionCatalog.layer,
			compiler,
		),
	),
	Layer.provide(DefinitionRepository.layer),
);
const database = services.pipe(
	Layer.provideMerge(
		Layer.effectDiscard(seed).pipe(Layer.provideMerge(isolatedDatabaseLayer("page_authoring"))),
	),
	Layer.provide(makeAppConfigLayer()),
);

layer(database)((test) => {
	test.effect("replays assistant creates, edits, builds and deletes from atomic receipts", () =>
		Effect.gen(function* () {
			const service = yield* PageAuthoringService;
			const repository = yield* PageAuthoringRepository;
			const actor = { userId: owner, kind: "assistant" as const };
			const input = { definition, slug: "replay", name: "Replay" };
			const created = yield* service.create(actor, input, "create");
			expect(yield* service.create(actor, input, "create")).toEqual(created);
			yield* service.setWriteAccess(owner, created.pageId, true);
			const replacement = { definition, pageId: created.pageId, expectedDraftRevision: 1 };
			const replaced = yield* service.replaceDraft(actor, replacement, "replace");
			expect(yield* service.replaceDraft(actor, replacement, "replace")).toEqual(replaced);
			expect((yield* repository.find(owner, created.pageId))?.writeAccess).toBe(false);
			expect((yield* repository.find(owner, created.pageId))?.draftRevision).toBe(2);
			const build = { pageId: created.pageId, expectedDraftRevision: 2 };
			const compiled = yield* service.compile(owner, build, "compile");
			expect(yield* service.compile(owner, build, "compile")).toEqual(compiled);
			const removed = yield* service.remove(owner, created.pageId, "remove");
			expect(yield* service.remove(owner, created.pageId, "remove")).toEqual(removed);
			expect(yield* repository.find(owner, created.pageId)).toBeNull();
			expect(
				Result.isFailure(
					yield* Effect.result(service.create(actor, { ...input, name: "Changed" }, "create")),
				),
			).toBe(true);
		}),
	);

	test.effect("edits the locked draft in place and replays the edit from its receipt", () =>
		Effect.gen(function* () {
			const service = yield* PageAuthoringService;
			const actor = { userId: owner, kind: "assistant" as const };
			const created = yield* service.create(actor, { definition, slug: "edit", name: "Edit" });
			let applied = 0;
			const change = {
				request: { entry: "client/page.tsx" },
				apply: (current: PageDefinition) => {
					applied += 1;
					return Result.succeed({ ...current, files: [...current.files, { path: "client/extra.ts", content: "" }] });
				},
			};
			const input = { pageId: created.pageId, expectedDraftRevision: 1 };
			const edited = yield* service.editDraft(actor, input, change, "edit");
			expect(yield* service.editDraft(actor, input, change, "edit")).toEqual(edited);
			expect(applied).toBe(1);
			const draft = yield* service.readDraft(owner, created.pageId);
			expect(draft).toMatchObject({ name: "Edit", draftRevision: 2 });
			expect(draft.definition.files.map(({ path }) => path)).toEqual(["client/extra.ts", "client/page.tsx"]);
			assertExitFails(
				yield* Effect.exit(
					service.editDraft(
						actor,
						{ pageId: created.pageId, expectedDraftRevision: 2 },
						{ request: null, apply: () => Result.fail("oldText was not found") },
					),
				),
				new BadRequest({ message: "oldText was not found" }),
			);
			expect((yield* service.readDraft(owner, created.pageId)).draftRevision).toBe(2);
		}),
	);

	test.effect("compiled publication fences admission and replays after draft replacement", () =>
		Effect.gen(function* () {
			const service = yield* PageAuthoringService;
			const repository = yield* PageAuthoringRepository;
			const session = yield* DatabaseSession;
			const actor = { userId: owner, kind: "assistant" as const };
			const { pageId } = yield* service.create(actor, {
				definition,
				slug: "compiled-publication",
				name: "Compiled publication",
			});
			const compiled = yield* service.compile(owner, { pageId, expectedDraftRevision: 1 });
			expect(
				yield* service.publishCompiledDraft(
					owner,
					{ ...compiled, artifactHash: "wrong" },
					"wrong-artifact",
				),
			).toBeNull();
			expect(
				yield* service.publishCompiledDraft(
					owner,
					{ ...compiled, definitionHash: "wrong" },
					"wrong-definition",
				),
			).toBeNull();
			expect(yield* service.publishCompiledDraft(other, compiled, "other-owner")).toBeNull();
			expect((yield* repository.find(owner, pageId))?.publishedRevision).toBeNull();
			const published = yield* service
				.publishCompiledDraft(owner, compiled, "publication")
				.pipe(Effect.provideService(CompileFailure, "diagnostics"));
			expect(published).toEqual(compiled);
			yield* service.replaceDraft(actor, { pageId, definition, expectedDraftRevision: 1 });
			const edited = yield* repository.find(owner, pageId);
			expect(yield* service.publishCompiledDraft(owner, compiled, "publication")).toEqual(compiled);
			expect(yield* repository.find(owner, pageId)).toEqual(edited);
			expect(yield* service.publishCompiledDraft(owner, compiled, "new-publication")).toBeNull();
			expect(
				Result.isFailure(
					yield* Effect.result(
						service.publishCompiledDraft(
							owner,
							{ ...compiled, artifactHash: "changed" },
							"publication",
						),
					),
				),
			).toBe(true);
			const receipts = yield* session.run((db) =>
				db
					.select()
					.from(tables.idempotencyKey)
					.where(
						sql`${tables.idempotencyKey.userId} = ${owner} and ${tables.idempotencyKey.key} like 'page:publish-compiled-draft:%'`,
					),
			);
			expect(receipts).toHaveLength(1);
		}),
	);

	test.effect("publishes a static page without named queries", () =>
		Effect.gen(function* () {
			const service = yield* PageAuthoringService;
			const repository = yield* PageAuthoringRepository;
			const created = yield* service.create(
				{ kind: "user", userId: owner },
				{ slug: "static", name: "Static", definition: { ...definition, queries: { queries: {} } } },
			);
			const published = yield* service.publish(owner, {
				pageId: created.pageId,
				expectedDraftRevision: 1,
			});
			const page = yield* repository.find(owner, created.pageId);
			assert(page);
			expect(page.publishedRevision).toBe(1);
			expect(page.publishedArtifactHash).toBe(published.artifactHash);
			expect(page.publishedDefinition?.queries).toEqual({ queries: {} });
		}),
	);

	test.effect(
		"assistant edits clear grants and invalidate compiled previews while retaining the published page",
		() =>
			Effect.gen(function* () {
				const service = yield* PageAuthoringService;
				const repository = yield* PageAuthoringRepository;
				const created = yield* service.create(
					{ userId: owner, kind: "assistant" },
					{ definition, slug: "assistant", name: "Assistant" },
				);
				expect((yield* repository.find(owner, created.pageId))?.writeAccess).toBe(false);
				const published = yield* service.publish(owner, {
					pageId: created.pageId,
					expectedDraftRevision: 1,
				});
				yield* service.setWriteAccess(owner, created.pageId, true);
				const granted = yield* repository.find(owner, created.pageId);
				expect(granted?.writeAccess).toBe(true);
				const edited = yield* service.replaceDraft(
					{ userId: owner, kind: "assistant" },
					{ definition, pageId: created.pageId, expectedDraftRevision: 1 },
				);
				const current = yield* repository.find(owner, created.pageId);
				expect(edited.draftRevision).toBe(2);
				expect(current?.origin).toBe("assistant");
				expect(current?.writeAccess).toBe(false);
				expect(current?.authorityRevision).toBe((granted?.authorityRevision ?? 0) + 1);
				expect(current?.draftArtifactHash).toBeNull();
				expect(current?.draftCompiledRevision).toBeNull();
				expect(current?.publishedRevision).toBe(1);
				expect(current?.publishedArtifactHash).toBe(published.artifactHash);
				const compiled = yield* service.compile(owner, {
					pageId: created.pageId,
					expectedDraftRevision: 2,
				});
				expect(compiled.draftRevision).toBe(2);
				expect((yield* repository.find(owner, created.pageId))?.draftCompiledRevision).toBe(2);
				const reconstructed = yield* (yield* ClientArtifactsRepository).loadClientArtifact(
					compiled.artifactHash,
				);
				expect("pageDeclarationHash" in reconstructed).toBe(true);
			}),
	);
	test.effect("fences publication before and after compilation", () =>
		Effect.gen(function* () {
			const service = yield* PageAuthoringService;
			const repository = yield* PageAuthoringRepository;
			const { pageId } = yield* service.create(
				{ kind: "user", userId: owner },
				{ definition, slug: "fenced", name: "Fenced" },
			);
			const started = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const building = yield* service.publish(owner, { pageId, expectedDraftRevision: 1 }).pipe(
				Effect.provideService(
					CompileGate,
					Effect.gen(function* () {
						yield* Deferred.succeed(started, undefined);
						yield* Deferred.await(release);
					}),
				),
				Effect.exit,
				Effect.forkChild,
			);
			yield* Deferred.await(started);
			yield* service
				.replaceDraft(
					{ kind: "user", userId: owner },
					{ pageId, definition, expectedDraftRevision: 1 },
				)
				.pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
			assertExitFails(
				yield* Fiber.join(building),
				new PageAuthoringError({ reason: { draftRevision: 2, code: "draft-revision-stale" } }),
			);
			assertExitFails(
				yield* Effect.exit(service.compile(owner, { pageId, expectedDraftRevision: 1 })),
				new PageAuthoringError({ reason: { draftRevision: 2, code: "draft-revision-stale" } }),
			);
			const row = yield* repository.find(owner, pageId);
			expect(row?.publishedRevision).toBeNull();
			expect(row?.draftArtifactHash).toBeNull();
		}),
	);
	test.effect(
		"returns compiler diagnostics, reports an unavailable compiler, and rejects invalid stored query branches when publishing",
		() =>
			Effect.gen(function* () {
				const service = yield* PageAuthoringService;
				const { pageId } = yield* service.create(
					{ kind: "user", userId: owner },
					{ definition, slug: "diagnostics", name: "Diagnostics" },
				);
				assertExitFails(
					yield* service
						.compile(owner, { pageId, expectedDraftRevision: 1 })
						.pipe(Effect.provideService(CompileFailure, "diagnostics"), Effect.exit),
					new PageAuthoringError({
						reason: {
							code: "build-failed",
							diagnostics: [
								clientPluginCompilerDiagnostic("TEST", "client/page.tsx", "Invalid page"),
							],
						},
					}),
				);
				assertExitFails(
					yield* service
						.compile(owner, { pageId, expectedDraftRevision: 1 })
						.pipe(Effect.provideService(CompileFailure, "unavailable"), Effect.exit),
					new PageAuthoringError({ reason: { code: "compiler-unavailable" } }),
				);
				const items = definition.queries.queries["items"];
				assert(items);
				const invalid: PageDefinition = {
					...definition,
					queries: {
						parameters: {
							fields: {
								mode: {
									type: "enum",
									label: "Mode",
									defaultValue: "safe",
									description: "Query mode",
									choices: { kind: "static", values: [{ value: "safe" }, { value: "bad" }] },
								},
							},
						},
						queries: {
							items: {
								...items,
								where: {
									type: "choice",
									parameter: "mode",
									cases: {
										safe: {
											operator: "eq",
											type: "comparison",
											left: { value: 1, type: "literal" },
											right: { value: 1, type: "literal" },
										},
										bad: {
											operator: "eq",
											type: "comparison",
											right: { value: 1, type: "literal" },
											left: { type: "column", field: "missing", tableAlias: "item" },
										},
									},
								},
							},
						},
					},
				};
				yield* service.replaceDraft(
					{ kind: "user", userId: owner },
					{ pageId, definition: invalid, expectedDraftRevision: 1 },
				);
				const failure = yield* Effect.flip(
					service.publish(owner, { pageId, expectedDraftRevision: 2 }),
				);
				assert(failure instanceof PageAuthoringError);
				expect(failure.reason.code).toBe("definition-invalid");
				expect(
					(yield* (yield* PageAuthoringRepository).find(owner, pageId))?.publishedRevision,
				).toBeNull();
			}),
	);
	test.effect("owner-scopes mutations, page rows, and named published query sources", () =>
		Effect.gen(function* () {
			const service = yield* PageAuthoringService;
			const sources = yield* RyotQLSources;
			const queries = yield* RyotQLService;
			const { pageId } = yield* service.create(
				{ kind: "user", userId: owner },
				{ definition, slug: "isolation", name: "Isolation" },
			);
			const scope = {
				type: "user",
				userId: owner,
				language: null,
				audience: "kernel",
				accessClass: "standard",
			} as const;
			const source = { pageId, kind: "page", query: "items" } as const;
			const unavailable = new RyotQLBadRequest({
				reason: { kind: "page", code: "source-unavailable" },
			});
			assertExitFails(yield* Effect.exit(sources.resolve(scope, source)), unavailable);
			yield* service.publish(owner, { pageId, expectedDraftRevision: 1 });
			const published = yield* sources.resolve(scope, source);
			const detailResponse = yield* queries.executeForUser(owner, null, "kernel", {
				arguments: { pageId },
				source: { kind: "inline", document: pageRecipe.document },
			});
			const detail = yield* Effect.fromResult(pageRecipe.decode(detailResponse));
			expect(detail?.draftDefinition).toEqual(definition);
			expect(detail?.publishedRevision).toBe(1);
			expect(detail?.draftCompiledRevision).toBe(1);
			expect(published.selectedQuery).toBe("items");
			expect(published.values).toEqual({});
			assertExitFails(
				yield* Effect.exit(sources.resolve({ ...scope, userId: other }, source)),
				unavailable,
			);
			assertExitFails(
				yield* Effect.exit(sources.resolve(scope, { ...source, query: "missing" })),
				unavailable,
			);
			assertExitFails(
				yield* Effect.exit(service.setWriteAccess(other, pageId, true)),
				new PageAuthoringError({ reason: { code: "page-not-found" } }),
			);
			assertExitFails(
				yield* Effect.exit(service.remove(other, pageId)),
				new PageAuthoringError({ reason: { code: "page-not-found" } }),
			);
			assertExitFails(
				yield* Effect.exit(
					service.replaceDraft(
						{ userId: other, kind: "assistant" },
						{ pageId, definition, expectedDraftRevision: 1 },
					),
				),
				new PageAuthoringError({ reason: { code: "page-not-found" } }),
			);
			const rows = yield* queries.executeForUser(other, null, "kernel", {
				arguments: { pageId },
				source: { kind: "inline", document: pageRecipe.document },
			});
			expect(rows.data["page"]?.items).toEqual([]);
			const list = yield* queries.executeForUser(other, null, "kernel", {
				source: { kind: "inline", document: pagesRecipe.document },
			});
			expect(list.data["pages"]?.items).toEqual([]);
			const executed = yield* queries.executeForUser(owner, null, "plugin", { source });
			expect(executed.data["items"]?.items).toEqual([{ id: "first" }]);
			const first = executed.data["items"];
			assert(first?.type === "rows" && first.pageInfo.nextCursor);
			yield* service.replaceDraft(
				{ kind: "user", userId: owner },
				{ pageId, definition, expectedDraftRevision: 1 },
			);
			expect((yield* sources.resolve(scope, source)).identity).toBe(published.identity);
			yield* service.publish(owner, { pageId, expectedDraftRevision: 2 });
			expect((yield* sources.resolve(scope, source)).identity).not.toBe(published.identity);
			assertExitFails(
				yield* Effect.exit(
					queries.executeForUser(owner, null, "plugin", {
						source,
						pages: { items: { after: first.pageInfo.nextCursor } },
					}),
				),
				new RyotQLBadRequest({ reason: { code: "invalid-cursor" } }),
			);
		}),
	);
	test.effect("rejects unavailable dependencies and invalid files without creating a page", () =>
		Effect.gen(function* () {
			const service = yield* PageAuthoringService;
			const reference = { scope: "user", packageId: PluginPackageId.make("test/missing") } as const;
			assertExitFails(
				yield* Effect.exit(
					service.create(
						{ kind: "user", userId: owner },
						{
							slug: "missing",
							name: "Missing",
							definition: { ...definition, pluginDependencies: { dependency: reference } },
						},
					),
				),
				new PageAuthoringError({ reason: { reference, code: "dependency-unavailable" } }),
			);
			const invalid = yield* Effect.flip(
				service.create(
					{ kind: "user", userId: owner },
					{
						name: "Invalid",
						slug: "invalid-files",
						definition: { ...definition, files: [...definition.files, ...definition.files] },
					},
				),
			);
			assert(invalid instanceof PageAuthoringError);
			expect(invalid.reason.code).toBe("definition-invalid");
		}),
	);
	test.effect("rejects invalid queries and unresolved plugin queries when compiling a draft", () =>
		Effect.gen(function* () {
			const service = yield* PageAuthoringService;
			const compileFailure = Effect.fn(function* (slug: string, changes: Partial<PageDefinition>) {
				const { pageId } = yield* service.create(
					{ userId: owner, kind: "assistant" },
					{ slug, name: slug, definition: { ...definition, ...changes } },
				);
				const failure = yield* Effect.flip(
					service.compile(owner, { pageId, expectedDraftRevision: 1 }),
				);
				assert(failure instanceof PageAuthoringError);
				return failure.reason;
			});
			expect(
				yield* compileFailure("unknown-table", {
					queries: {
						queries: {
							items: {
								from: { alias: "item", table: "missing" },
								output: {
									fields: [],
									orderBy: [],
									type: "rows",
									pagination: { limit: 1, maxLimit: 1 },
								},
							},
						},
					},
				}),
			).toEqual({ code: "definition-invalid", message: "Query 'items': Unknown table 'missing'" });
			expect(
				yield* compileFailure("unresolved-import", {
					pluginQueries: { found: { query: "search", dependency: "missing" } },
				}),
			).toEqual({
				code: "definition-invalid",
				message: "Plugin query 'found' names undeclared dependency 'missing'",
			});
		}),
	);
	test.effect("maps referencing foreign keys to page-in-use and deletes unreferenced pages", () =>
		Effect.gen(function* () {
			const service = yield* PageAuthoringService;
			const session = yield* DatabaseSession;
			const { pageId } = yield* service.create(
				{ kind: "user", userId: owner },
				{ definition, slug: "referenced", name: "Referenced" },
			);
			yield* session.run((db) =>
				db.execute(
					sql`insert into page_reference_test (page_id, user_id) values (${pageId}, ${owner})`,
				),
			);
			assertExitFails(
				yield* Effect.exit(service.remove(owner, pageId)),
				new PageAuthoringError({ reason: { code: "page-in-use" } }),
			);
			expect((yield* (yield* PageAuthoringRepository).find(owner, pageId))?.id).toBe(pageId);
			yield* session.run((db) =>
				db.execute(sql`delete from page_reference_test where page_id = ${pageId}`),
			);
			expect(yield* service.remove(owner, pageId)).toEqual({ pageId });
			expect(yield* (yield* PageAuthoringRepository).find(owner, pageId)).toBeNull();
		}),
	);

	test.effect(
		"binds preview queries to the exact compiled draft and invalidates them on replacement",
		() =>
			Effect.gen(function* () {
				const service = yield* PageAuthoringService;
				const sources = yield* RyotQLSources;
				const queries = yield* RyotQLService;
				const { pageId } = yield* service.create(
					{ userId: owner, kind: "assistant" },
					{ definition, slug: "preview", name: "Preview" },
				);
				const scope = {
					type: "user",
					userId: owner,
					language: null,
					audience: "plugin",
					accessClass: "standard",
				} as const;
				const unavailable = new RyotQLBadRequest({
					reason: { kind: "page-preview", code: "source-unavailable" },
				});
				const built = yield* service.compile(owner, { pageId, expectedDraftRevision: 1 });
				const source = { ...built, query: "items", kind: "page-preview" } as const;
				const resolved = yield* sources.resolve(scope, source);
				expect(resolved.document).toEqual(definition.queries);
				expect(resolved.values).toEqual({});
				const result = yield* queries.executeForUser(owner, null, "plugin", { source });
				expect(result.data["items"]?.items).toEqual([{ id: "first" }]);
				assertExitFails(
					yield* Effect.exit(sources.resolve({ ...scope, userId: other }, source)),
					unavailable,
				);
				for (const invalid of [
					{ ...source, draftRevision: 2 },
					{ ...source, definitionHash: "different" },
					{ ...source, artifactHash: "different" },
					{ ...source, query: "undeclared" },
				]) {
					assertExitFails(yield* Effect.exit(sources.resolve(scope, invalid)), unavailable);
				}
				yield* service.replaceDraft(
					{ userId: owner, kind: "assistant" },
					{ pageId, definition, expectedDraftRevision: 1 },
				);
				assertExitFails(yield* Effect.exit(sources.resolve(scope, source)), unavailable);
				assertExitFails(
					yield* Effect.exit(sources.resolve(scope, { ...source, draftRevision: 2 })),
					unavailable,
				);
				const rebuilt = yield* service.compile(owner, { pageId, expectedDraftRevision: 2 });
				const next = yield* sources.resolve(scope, {
					...rebuilt,
					query: "items",
					kind: "page-preview",
				});
				expect(next.identity).not.toBe(resolved.identity);
				assertExitFails(
					yield* Effect.exit(sources.resolve(scope, { pageId, kind: "page", query: "items" })),
					new RyotQLBadRequest({ reason: { kind: "page", code: "source-unavailable" } }),
				);
			}),
	);
});
