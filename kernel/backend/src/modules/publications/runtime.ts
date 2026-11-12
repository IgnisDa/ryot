import { BROWSE_SUBJECT_ALIAS } from "@ryot-app/contract/modules/filters/browse";
import { definitionOwnerPluginId } from "@ryot-app/contract/modules/plugins/references";
import type { PublicationDefinition } from "@ryot-app/contract/modules/publications/schemas";
import { PublicationBadRequest } from "@ryot-app/contract/modules/publications/schemas";
import {
	type FieldSelection,
	mapScalarExpression,
} from "@ryot-app/contract/modules/ryotql/authored";
import { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { bindArguments, bindPartialArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import type { VisitorRequest } from "@ryot-app/contract/modules/ryotql/request";
import { EntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { browseExpressionKind } from "@ryot-app/ryotql-recipes/browse-validation";
import {
	kernelPublicationPage,
	PublicationItemDetailField,
	publicationPresentationFields,
} from "@ryot-app/ryotql-recipes/publication-browse";
import { decodeSavedViewCount } from "@ryot-app/ryotql-recipes/saved-views";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Result, Schema } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { PagesService } from "#modules/pages/preparation/service";
import { RyotQLService } from "#modules/ryotql/service";

import { PUBLICATION_RESULT_BYTES, type PublicationSnapshot } from "./model";

const KernelSettings = Schema.Struct({
	browser: EntityBrowserSavedViewSettings,
	itemDetails: Schema.Array(PublicationItemDetailField),
});
const publicationRequest = (definition: PublicationDefinition, visitor: VisitorRequest) => ({
	...visitor,
	arguments: { ...visitor.arguments, ...definition.arguments },
});

export class PublicationRuntime extends Context.Service<PublicationRuntime>()(
	"@ryot-app/kernel-backend/modules/publications/runtime/PublicationRuntime",
	{
		make: Effect.gen(function* () {
			const pages = yield* PagesService;
			const catalogs = yield* DefinitionCatalog;
			const ryotql = yield* RyotQLService;
			const resolve = Effect.fn("PublicationRuntime.resolve")(function* (
				userId: UserId,
				definition: PublicationDefinition,
				snapshot?: null | PublicationSnapshot,
			) {
				if (definition.mode === "snapshot" && snapshot === null) {
					return yield* new PublicationBadRequest({ reason: { code: "page-unavailable" } });
				}
				if (snapshot) {
					const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(RyotQLResponse))(
						snapshot.result,
					).pipe(Effect.orDie);
					if (Buffer.byteLength(encoded) > PUBLICATION_RESULT_BYTES) {
						return yield* new PublicationBadRequest({
							reason: { code: "snapshot-too-large", limitBytes: PUBLICATION_RESULT_BYTES },
						});
					}
				}
				const prepared = yield* pages
					.preparePublication(userId, definition.page, snapshot ?? undefined)
					.pipe(
						Effect.catchTag("ClientPagePreparationError", (error) =>
							Effect.fail(
								new PublicationBadRequest({
									reason:
										"reference" in error.reason
											? { code: "dependency-unavailable", reference: error.reason.reference }
											: { code: "page-unavailable" },
								}),
							),
						),
					);
				if (snapshot) {
					return { prepared, document: snapshot.document, settings: snapshot.settings };
				}
				if (prepared.page) {
					return { prepared, settings: {}, document: prepared.page.definition.queries };
				}
				const catalog = yield* catalogs.forUser(userId);
				const projections = catalog.savedViews.flatMap((view) => {
					if (
						!view.isEffective ||
						view.pluginScope === "user" ||
						view.renderer.kind !== "kernel" ||
						(view.renderer.name !== "entity-browser" && view.renderer.name !== "collection-browser")
					) {
						return [];
					}
					const settings = Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)(
						view.settings,
					);
					if (Result.isFailure(settings)) {
						return [];
					}
					const query = view.dataSources?.queries[settings.success.sourceName];
					if (query?.output.type !== "rows") {
						return [];
					}
					const fields = query.output.fields.flatMap((field) =>
						"expr" in field
							? [
									{
										key: field.key,
										expr: mapScalarExpression(field.expr, {
											alias: (alias) =>
												alias === settings.success.subject.entityAlias
													? BROWSE_SUBJECT_ALIAS
													: alias,
										}),
									},
								]
							: [],
					);
					return [
						{
							schemas: settings.success.subject.schemas,
							fields: publicationPresentationFields(fields),
						},
					];
				});
				const schemas = [];
				for (const schema of catalog.entitySchemas.filter(
					(candidate) => candidate.isEffective && candidate.pluginScope !== "user",
				)) {
					const fields = new Map<string, FieldSelection>();
					for (const projection of projections) {
						if (
							!projection.schemas.some(
								(reference) =>
									reference.slug === schema.slug &&
									definitionOwnerPluginId(reference.owner) === schema.pluginId,
							)
						) {
							continue;
						}
						for (const field of projection.fields) {
							const existing = fields.get(field.key);
							if (existing && stableStringify(existing.expr) !== stableStringify(field.expr)) {
								return yield* new PublicationBadRequest({
									reason: {
										code: "bindings-invalid",
										issues: [
											{
												path: ["page", schema.slug, field.key],
												message: `Conflicting system presentation projections for '${schema.slug}.${field.key}'`,
											},
										],
									},
								});
							}
							fields.set(field.key, field);
						}
					}
					schemas.push({
						slug: schema.slug,
						browse: schema.browse,
						pluginId: schema.pluginId,
						presentationFields: [...fields.values()].sort((left, right) =>
							left.key.localeCompare(right.key),
						),
						sortTypes: Object.fromEntries(
							(schema.browse?.fields ?? []).flatMap((entry) => {
								if (entry.kind !== "sort") {
									return [];
								}
								const kind = browseExpressionKind(entry.expression);
								return kind === "text" || kind === "date" || kind === "boolean" || kind === "number"
									? [[entry.key, kind]]
									: [];
							}),
						),
					});
				}
				const [first, ...rest] = schemas;
				if (!first) {
					return yield* new PublicationBadRequest({ reason: { code: "source-unavailable" } });
				}
				const kernel = kernelPublicationPage({ schemas: [first, ...rest] });
				const settings = yield* Schema.encodeEffect(Schema.toCodecJson(KernelSettings))({
					browser: kernel.settings,
					itemDetails: kernel.itemDetails,
				}).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(Schema.Record(Schema.String, JsonValue))),
					Effect.orDie,
				);
				return { prepared, settings, document: kernel.document };
			});
			const validateBindings = Effect.fn("PublicationRuntime.validateBindings")(function* (
				document: Effect.Success<ReturnType<typeof resolve>>["document"],
				definition: PublicationDefinition,
			) {
				const bound = bindPartialArguments(document.parameters, definition.arguments);
				if (Result.isFailure(bound)) {
					return yield* new PublicationBadRequest({
						reason: { issues: bound.failure, code: "bindings-invalid" },
					});
				}
				return yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, JsonValue))(
					bound.success,
				).pipe(Effect.orDie);
			});
			const capture = Effect.fn("PublicationRuntime.capture")(function* (
				owner: { readonly userId: UserId; readonly language: null | string },
				definition: PublicationDefinition,
			) {
				const resolved = yield* resolve(owner.userId, definition);
				const bound = yield* validateBindings(resolved.document, definition);
				if (definition.mode === "live") {
					if (definition.page.kind === "kernel") {
						yield* ryotql
							.executeDeclared(
								owner,
								resolved.document,
								{ query: "count", arguments: bound },
								PUBLICATION_RESULT_BYTES,
							)
							.pipe(
								Effect.mapError(
									() => new PublicationBadRequest({ reason: { code: "source-unavailable" } }),
								),
							);
					}
					for (const query of Object.keys(resolved.document.queries)) {
						yield* ryotql
							.describeDeclared(owner, resolved.document, query, bound)
							.pipe(
								Effect.mapError(
									() => new PublicationBadRequest({ reason: { code: "source-unavailable" } }),
								),
							);
					}
					return null;
				}
				const argumentsResult = bindArguments(resolved.document.parameters, bound);
				if (Result.isFailure(argumentsResult)) {
					return yield* new PublicationBadRequest({
						reason: { code: "bindings-invalid", issues: argumentsResult.failure },
					});
				}
				const capturedArguments = yield* Schema.decodeUnknownEffect(
					Schema.Record(Schema.String, JsonValue),
				)(argumentsResult.success).pipe(Effect.orDie);
				const result =
					Object.keys(resolved.document.queries).length === 0
						? { data: {} }
						: yield* ryotql
								.executeDeclared(
									owner,
									resolved.document,
									{ arguments: capturedArguments },
									PUBLICATION_RESULT_BYTES,
								)
								.pipe(
									Effect.mapError(
										(error) =>
											new PublicationBadRequest({
												reason:
													error._tag === "RyotQLBadRequest" &&
													error.reason.code === "result-too-large"
														? { code: "snapshot-too-large", limitBytes: PUBLICATION_RESULT_BYTES }
														: { code: "source-unavailable" },
											}),
									),
								);
				if (
					Buffer.byteLength(
						yield* Schema.encodeEffect(Schema.fromJsonString(RyotQLResponse))(result).pipe(
							Effect.orDie,
						),
					) > PUBLICATION_RESULT_BYTES
				) {
					return yield* new PublicationBadRequest({
						reason: { code: "snapshot-too-large", limitBytes: PUBLICATION_RESULT_BYTES },
					});
				}
				const count = definition.page.kind === "kernel" ? decodeSavedViewCount(result) : undefined;
				const settings =
					count && Result.isSuccess(count)
						? { ...resolved.settings, itemCount: count.success }
						: resolved.settings;
				yield* pages.retainPublicationComposition(resolved.prepared.capturedComposition);
				return {
					result,
					settings,
					document: resolved.document,
					page: resolved.prepared.page,
					arguments: capturedArguments,
					composition: resolved.prepared.capturedComposition,
				} satisfies PublicationSnapshot;
			});

			return { resolve, capture, validateBindings, request: publicationRequest };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
