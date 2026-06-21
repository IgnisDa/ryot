import { badRequest, notFound, SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import type {
	MetadataLookupBody,
	MetadataLookupResponse,
} from "@ryot/contract/modules/metadata-lookup/schemas";
import type { SandboxScriptMetadata } from "@ryot/contract/modules/sandbox/schemas";
import type { IntegrationId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { SandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import {
	chooseBestMetadataLookupTitleMatch,
	type MetadataLookupTitleMatchCandidate,
} from "#lib/shared/title-matching";
import {
	extractMetadataLookupBaseTitle,
	extractMetadataLookupSeasonEpisode,
} from "#lib/shared/title-parsing";
import { EntitiesRepository } from "#modules/entities/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { SandboxRepository } from "#modules/sandbox/repository";

type SearchScriptSlug = "movie.tmdb" | "show.tmdb";

type SearchScript = {
	isBuiltin: boolean;
	id: SandboxScriptId;
	compiledCode: string;
	compiledFormat: number;
	slug: SearchScriptSlug;
	metadata: SandboxScriptMetadata;
};

const EntitySearchItem = Schema.Struct({
	externalId: Schema.NonEmptyString,
	titleProperty: Schema.Struct({ value: Schema.NonEmptyString, kind: Schema.Literal("text") }),
	primarySubtitleProperty: Schema.optional(
		Schema.Union(
			Schema.Struct({ kind: Schema.Literal("null"), value: Schema.Null }),
			Schema.Struct({ kind: Schema.Literal("number"), value: Schema.Number }),
		),
	),
});

const EntitySearchResult = Schema.Struct({ items: Schema.Array(EntitySearchItem) });

const searchScripts: ReadonlyArray<SearchScriptSlug> = ["movie.tmdb", "show.tmdb"];

const decodeEntitySearchResult = Schema.decodeUnknown(EntitySearchResult);

const toSandboxRunError = (error: unknown) =>
	error instanceof SandboxRunError
		? error
		: new SandboxRunError({ message: unknownToMessage(error) });

const scriptUnavailable = () => notFound("TMDB sandbox scripts are not available");

const toCandidate = (
	slug: SearchScriptSlug,
	item: typeof EntitySearchItem.Type,
): MetadataLookupTitleMatchCandidate => ({
	scriptSlug: slug,
	externalId: item.externalId,
	title: item.titleProperty.value,
	entitySchemaSlug: slug === "movie.tmdb" ? "movie" : "show",
	publishYear:
		item.primarySubtitleProperty?.kind === "number" ? item.primarySubtitleProperty.value : null,
});

export class MetadataLookupService extends Effect.Service<MetadataLookupService>()(
	"MetadataLookupService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const sandbox = yield* SandboxService;
			const sandboxRepository = yield* SandboxRepository;
			const entitiesRepository = yield* EntitiesRepository;
			const integrationsRepository = yield* IntegrationsRepository;

			const loadSearchScript = Effect.fn("MetadataLookupService.loadSearchScript")(function* (
				slug: SearchScriptSlug,
			) {
				const linkedScript = yield* runWithDb(
					entitiesRepository.findEntitySchemaSandboxScriptBySlug(slug),
				);
				if (!linkedScript) {
					return yield* scriptUnavailable();
				}

				const script = yield* runWithDb(
					sandboxRepository.getScriptForUser({
						userId: null,
						scriptId: linkedScript.sandboxScriptId,
					}),
				);
				if (!script || !script.isBuiltin) {
					return yield* scriptUnavailable();
				}

				return {
					slug,
					id: script.id,
					metadata: script.metadata,
					isBuiltin: script.isBuiltin,
					compiledCode: script.compiledCode,
					compiledFormat: script.compiledFormat,
				} satisfies SearchScript;
			});

			const runSearch = Effect.fn("MetadataLookupService.runSearch")(function* (
				userId: string,
				query: string,
				script: SearchScript,
			) {
				const result = yield* sandbox
					.run({
						userId,
						scriptId: script.id,
						driverName: "search",
						metadata: script.metadata,
						compiledCode: script.compiledCode,
						scriptIsBuiltin: script.isBuiltin,
						compiledFormat: script.compiledFormat,
						context: { query, page: 1, pageSize: 20 },
						executionId: `metadata-lookup-${script.slug}-${generateId()}`,
						allowedHostFunctions: script.metadata.allowedHostFunctions ?? [],
					})
					.pipe(Effect.mapError(toSandboxRunError));

				if (!result.success) {
					return yield* new SandboxRunError({
						message: result.error ?? "TMDB search failed",
					});
				}

				const decoded = yield* decodeEntitySearchResult(result.value).pipe(
					Effect.mapError(
						() => new SandboxRunError({ message: "TMDB search returned an invalid result" }),
					),
				);

				return decoded.items.map((item) => toCandidate(script.slug, item));
			});

			const lookup = Effect.fn("MetadataLookupService.lookup")(function* (
				integrationId: IntegrationId,
				body: MetadataLookupBody,
			) {
				const title = body.title.trim();
				if (!title) {
					return yield* badRequest("title is required");
				}

				const integration = yield* runWithDb(
					integrationsRepository.getByIdAnyUser({ integrationId }),
				);
				if (!integration || integration.isDisabled) {
					return yield* notFound("Integration not found");
				}
				if (integration.providerSpecifics.kind !== "ryot_browser_extension") {
					return yield* badRequest("Integration is not a browser extension integration");
				}

				const query = extractMetadataLookupBaseTitle(title).trim();
				if (!query) {
					return yield* badRequest("title is required");
				}

				const scripts = yield* Effect.forEach(searchScripts, loadSearchScript);
				const results = yield* Effect.forEach(
					scripts,
					(script) => runSearch(integration.userId, query, script),
					{ concurrency: 2 },
				);
				const match = chooseBestMetadataLookupTitleMatch({
					title,
					results: results.flat(),
				});

				if (!match) {
					return { notFound: true, status: "notFound" } satisfies MetadataLookupResponse;
				}

				const showInformation =
					match.entitySchemaSlug === "show" ? extractMetadataLookupSeasonEpisode(title) : undefined;

				return {
					status: "found",
					title: match.title,
					data: {
						source: "tmdb",
						lot: match.entitySchemaSlug,
						identifier: match.externalId,
					},
					...(showInformation ? { showInformation } : {}),
				} satisfies MetadataLookupResponse;
			});

			return { lookup };
		}),
	},
) {}
