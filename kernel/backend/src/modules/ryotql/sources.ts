import type { DbError } from "@ryot-app/contract/errors";
import { ownerIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { mapPluginIdentityReferences } from "@ryot-app/contract/modules/ryotql/authored";
import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import { decodeEntitySourceReference } from "@ryot-app/contract/modules/ryotql/entity-source";
import { bindArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import type { ExecutionRequest, ExecutionSource } from "@ryot-app/contract/modules/ryotql/request";
import { EntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { and, entitySchemaPredicate, or, table } from "@ryot-app/ryotql";
import type { MembershipSource } from "@ryot-app/ryotql-recipes/controls";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Context, Effect, Layer, Schema } from "effect";

import { collectionMembershipSchema } from "#modules/collections/fields";
import { CollectionsRepository } from "#modules/collections/repository";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { PageAuthoringRepository } from "#modules/pages/authoring/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import type { RyotQLExecutionScope } from "./catalog";

export type ResolvedSource = {
	readonly identity: string;
	readonly document: RyotQLDocument;
	readonly selectedQuery?: string | undefined;
	readonly values: Omit<ExecutionRequest, "source">;
};
const unavailable = (kind: ExecutionSource["kind"]) =>
	new RyotQLBadRequest({ reason: { kind, code: "source-unavailable" } });

export class RyotQLSources extends Context.Service<RyotQLSources>()(
	"@ryot-app/kernel-backend/modules/ryotql/sources/RyotQLSources",
	{
		make: Effect.gen(function* () {
			const savedViews = yield* SavedViewsRepository;
			const pages = yield* PageAuthoringRepository;
			const catalogs = yield* DefinitionCatalog;
			const collections = yield* CollectionsRepository;
			const resolve = Effect.fn("RyotQLSources.resolve")(function* (
				scope: RyotQLExecutionScope,
				source: ExecutionSource,
			): Effect.fn.Return<ResolvedSource, DbError | RyotQLBadRequest> {
				if (source.kind === "inline") {
					if (source.query !== undefined && !Object.hasOwn(source.document.queries, source.query)) {
						return yield* unavailable("inline");
					}
					return {
						values: {},
						document: source.document,
						selectedQuery: source.query,
						identity: stableStringify(source),
					};
				}
				if (
					scope.type === "plugin" &&
					source.kind === "plugin" &&
					source.scope === "system" &&
					source.packageId === scope.packageId
				) {
					const declaration = (yield* catalogs.revision(scope.pluginRevisionId)).sections.queries?.[
						source.query
					];
					if (!declaration) {
						return yield* unavailable("plugin");
					}
					const document = yield* Effect.fromResult(
						mapPluginIdentityReferences(declaration.document, (owner) =>
							owner.kind === "self" ? { kind: "local", pluginId: scope.pluginId } : owner,
						),
					).pipe(Effect.mapError(() => unavailable("plugin")));
					return {
						document,
						values: {},
						identity: stableStringify({ source, document, revision: scope.pluginRevisionId }),
					};
				}
				if (scope.type !== "user") {
					return yield* unavailable(source.kind);
				}

				if (source.kind === "page-preview") {
					const page = yield* pages.findCompiledDraft(UserId.make(scope.userId), source);
					if (!page || !Object.hasOwn(page.draftDefinition.queries.queries, source.query)) {
						return yield* unavailable("page-preview");
					}
					return {
						values: {},
						selectedQuery: source.query,
						identity: stableStringify(source),
						document: page.draftDefinition.queries,
					};
				}

				if (source.kind === "page") {
					const page = yield* pages.find(UserId.make(scope.userId), source.pageId);
					if (
						!page?.publishedDefinition ||
						page.publishedRevision === null ||
						page.publishedArtifactHash === null ||
						!Object.hasOwn(page.publishedDefinition.queries.queries, source.query)
					) {
						return yield* unavailable("page");
					}
					return {
						values: {},
						selectedQuery: source.query,
						document: page.publishedDefinition.queries,
						identity: stableStringify({
							source,
							revision: page.publishedRevision,
							definitionHash: page.publishedDefinitionHash,
						}),
					};
				}
				if (source.kind === "savedView") {
					const view = yield* savedViews.findByReference(
						UserId.make(scope.userId),
						source.reference,
					);
					let query = view?.dataSources?.queries[source.query];
					if (!view || !query || view.isHidden || !view.dataSources) {
						return yield* unavailable("savedView");
					}
					let document = view.dataSources;
					if (
						view.renderer.kind === "kernel" &&
						(view.renderer.name === "entity-browser" || view.renderer.name === "collection-browser")
					) {
						const settings = yield* Schema.decodeUnknownEffect(EntityBrowserSavedViewSettings)(
							view.settings,
						).pipe(Effect.mapError(() => unavailable("savedView")));
						const subject = table("entity", settings.subject.entityAlias);
						const guard = or(
							...settings.subject.schemas.map(({ slug, owner }) =>
								entitySchemaPredicate(subject, slug, ownerIdentityReference(owner)),
							),
						);
						query = {
							...query,
							where: and(...(query.where === undefined ? [] : [query.where]), guard),
						};
						document = { ...document, queries: { ...document.queries, [source.query]: query } };
					}
					return {
						document,
						selectedQuery: source.query,
						identity: stableStringify({
							source,
							revision: view.revision,
							document: view.dataSources,
						}),
						values: {
							arguments: view.arguments,
							...(view.filter === undefined ? {} : { filter: view.filter }),
							...(view.sort === undefined ? {} : { sort: view.sort }),
						},
					};
				}
				const catalog = yield* catalogs.forUser(scope.userId);
				const installed = catalog.plugins.find(
					(entry) =>
						entry.packageId === source.packageId &&
						entry.scope === source.scope &&
						entry.health === "ready" &&
						entry.isDefinitionEffective &&
						entry.isExecutable,
				);
				if (!installed) {
					return yield* unavailable("plugin");
				}
				const revisionId =
					scope.definitionContext?.pluginId === installed.pluginId
						? scope.definitionContext.pluginRevisionId
						: installed.activeRevisionId;
				const declaration = (yield* catalogs.revision(revisionId)).sections.queries?.[source.query];
				if (!declaration) {
					return yield* unavailable("plugin");
				}
				const document = yield* Effect.fromResult(
					mapPluginIdentityReferences(declaration.document, (owner) =>
						owner.kind === "self"
							? { kind: "local", pluginId: PluginId.make(installed.pluginId) }
							: owner,
					),
				).pipe(Effect.mapError(() => unavailable("plugin")));
				return {
					document,
					values: {},
					identity: stableStringify({ source, document, revisionId }),
				};
			});
			const entitySource = Effect.fn("RyotQLSources.entitySource")(function* (
				scope: RyotQLExecutionScope,
				reference: string,
			) {
				if (scope.type !== "user") {
					return yield* unavailable("savedView");
				}
				const source = yield* Effect.fromResult(decodeEntitySourceReference(reference)).pipe(
					Effect.mapError(() => unavailable("savedView")),
				);
				if (source.kind === "collection") {
					const collection = yield* collections.getCollectionById(
						source.collectionId,
						UserId.make(scope.userId),
					);
					const revision = yield* collections.getOrderRevision(
						source.collectionId,
						UserId.make(scope.userId),
					);
					if (!collection || revision === null) {
						return yield* unavailable("savedView");
					}
					const membership = yield* Effect.fromResult(
						collectionMembershipSchema(
							isObjectRecord(collection.properties)
								? collection.properties["membershipFields"]
								: undefined,
						),
					).pipe(Effect.mapError(() => unavailable("savedView")));
					return { revision, membership, id: source.collectionId, kind: "collection" as const };
				}
				const view = yield* savedViews.findByReference(UserId.make(scope.userId), source.reference);
				if (
					!view ||
					view.isHidden ||
					view.renderer.kind !== "kernel" ||
					view.renderer.name !== "entity-browser"
				) {
					return yield* unavailable("savedView");
				}
				const settings = yield* Schema.decodeUnknownEffect(EntityBrowserSavedViewSettings)(
					view.settings,
				).pipe(Effect.mapError(() => unavailable("savedView")));
				return {
					kind: "savedView" as const,
					query: settings.sourceName,
					reference: source.reference,
					subjectAlias: settings.subject.entityAlias,
				};
			});

			const membershipAuthority = Effect.fn("RyotQLSources.membershipAuthority")(function* (
				scope: RyotQLExecutionScope,
				source: ResolvedSource,
				argumentsValue?: ExecutionRequest["arguments"],
				visited: readonly string[] = [],
				budget = { sources: 0 },
			): Effect.fn.Return<readonly MembershipSource[], DbError | RyotQLBadRequest> {
				const parsed = yield* Effect.fromResult(
					bindArguments(source.document.parameters, {
						...source.values.arguments,
						...argumentsValue,
					}),
				).pipe(Effect.mapError(() => unavailable("inline")));
				const schemas: MembershipSource[] = [];
				for (const [name, property] of Object.entries(source.document.parameters?.fields ?? {})) {
					if (property.type !== "string" || property.reference?.kind !== "entity-source") {
						continue;
					}
					const reference = parsed[name];
					if (typeof reference !== "string") {
						continue;
					}
					if (visited.includes(reference) || visited.length >= 16 || ++budget.sources > 64) {
						return yield* unavailable("savedView");
					}
					const selected = yield* entitySource(scope, reference);
					if (selected.kind === "collection") {
						schemas.push({ collectionId: selected.id, propertiesSchema: selected.membership });
					} else {
						const nested = yield* resolve(scope, {
							kind: "savedView",
							query: selected.query,
							reference: selected.reference,
						});
						schemas.push(
							...(yield* membershipAuthority(
								scope,
								nested,
								undefined,
								[...visited, reference],
								budget,
							)),
						);
					}
					if (schemas.length > 64) {
						return yield* unavailable("savedView");
					}
				}
				return schemas;
			});
			return { resolve, entitySource, membershipAuthority };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(SavedViewsRepository.layer),
		Layer.provide(PageAuthoringRepository.layer),
		Layer.provide(CollectionsRepository.layer),
		Layer.provide(DefinitionRepository.layer),
		Layer.provide(DefinitionCatalog.layer),
	);
}
