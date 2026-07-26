import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import type { ListedSavedView } from "@ryot/contract/modules/saved-views/schemas";
import {
	EntitySchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	SavedViewId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { dbRunnerLayer } from "#lib/test-utils/effect";
import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { ProviderEntitySearchService } from "./search-service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const kernelView = kernelDefinitionSource().savedViews[0];
if (!kernelView) {
	throw new Error("Expected the kernel saved view fixture");
}

const view = {
	sortOrder: 0,
	icon: "film",
	isBuiltin: true,
	pluginSlug: null,
	isDisabled: false,
	slug: "all-movies",
	name: "All Movies",
	layouts: kernelView.layouts,
	id: SavedViewId.make("view-1"),
	createdAt: new Date(0).toISOString(),
	updatedAt: new Date(0).toISOString(),
	sandboxScripts: { search: ["movie.tmdb.search", "movie.tvdb.search"] },
} satisfies ListedSavedView;

const resolved = (slug: string) => {
	const source = slug.split(".")[1] ?? "provider";
	const providerId = SandboxProviderId.make(`${source}-provider-id`);
	return {
		entitySchemaSlug: EntitySchemaSlug.make("movie"),
		provider: {
			id: providerId,
			pluginSlug: "media",
			slug: `movie.${source}`,
			information: { source },
			name: source.toUpperCase(),
			createdAt: new Date(0),
			updatedAt: new Date(0),
		},
		script: {
			slug,
			providerId,
			source: "source",
			compiledFormat: 1,
			pluginSlug: "media",
			name: `${source} search`,
			compiledCode: "compiled",
			contentHash: `${slug}-hash`,
			createdAt: new Date(0),
			updatedAt: new Date(0),
			metadata: { kind: "provider" as const },
			id: SandboxScriptId.make(`${source}-script-id`),
		},
	};
};

const makeLayer = (input?: {
	readonly missingView?: boolean;
	readonly requestedUsers?: UserId[];
	readonly unavailableScripts?: ReadonlySet<string>;
	readonly execute?: SandboxExecutionService["Service"]["executeScript"];
}) =>
	ProviderEntitySearchService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.mock(SavedViewsRepository)({
					findBySlug: (userId) =>
						Effect.sync(() => {
							input?.requestedUsers?.push(userId);
							return input?.missingView ? null : view;
						}),
				}),
				Layer.mock(PluginRuntimeResolver)({
					resolveSavedViewSearchScript: (slug) =>
						Effect.succeed(input?.unavailableScripts?.has(slug) ? null : resolved(slug)),
				}),
				Layer.mock(SandboxExecutionService)({
					executeScript:
						input?.execute ??
						((run) =>
							Effect.succeed({
								logs: [],
								error: null,
								status: "completed" as const,
								value: {
									items: [
										{
											externalId: `${run.scriptId}-external`,
											titleProperty: { kind: "text", value: "Result" },
										},
									],
								},
							})),
				}),
			),
		),
	);

it.effect("searches every allowed provider with user authority and result provenance", () => {
	const executions: Array<Parameters<SandboxExecutionService["Service"]["executeScript"]>[0]> = [];
	return Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const result = yield* service.search(user, {
			savedViewSlug: view.slug,
			page: 2,
			pageSize: 10,
			query: "matrix",
		});

		expect(result.providers).toEqual([
			expect.objectContaining({
				status: "success",
				providerName: "TMDB",
				entitySchemaSlug: "movie",
				providerId: "tmdb-provider-id",
				items: [expect.objectContaining({ externalId: "tmdb-script-id-external" })],
			}),
			expect.objectContaining({
				status: "success",
				providerName: "TVDB",
				entitySchemaSlug: "movie",
				providerId: "tvdb-provider-id",
			}),
		]);
		expect(executions).toHaveLength(2);
		expect(executions[0]).toMatchObject({
			authority: { type: "user", userId: "user-1" },
			input: { query: "matrix", page: 2, pageSize: 10 },
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				execute: (input) => {
					executions.push(input);
					return Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: {
							items: [
								{
									externalId: `${input.scriptId}-external`,
									titleProperty: { kind: "text", value: "Result" },
								},
							],
						},
					});
				},
			}),
		),
	);
});

it.effect("keeps successful provider results when another provider fails", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const result = yield* service.search(user, {
			savedViewSlug: view.slug,
			page: 1,
			pageSize: 20,
			query: "matrix",
		});

		expect(result.providers.map(({ status }) => status)).toEqual(["failure", "success"]);
		expect(result.providers[0]).toMatchObject({
			status: "failure",
			providerId: "tmdb-provider-id",
			error: "execute: provider unavailable",
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				execute: (input) =>
					Effect.succeed({
						logs: [],
						status: "completed" as const,
						value: {
							items: [{ externalId: "movie-1", titleProperty: { kind: "text", value: "Movie" } }],
						},
						error:
							input.scriptId === "tmdb-script-id"
								? { phase: "execute" as const, message: "provider unavailable" }
								: null,
					}),
			}),
		),
	),
);

it.effect("reports malformed provider output as a provider-level failure", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const result = yield* service.search(user, {
			savedViewSlug: view.slug,
			page: 1,
			pageSize: 20,
			query: "matrix",
		});
		expect(result.providers.every(({ status }) => status === "failure")).toBe(true);
	}).pipe(
		Effect.provide(
			makeLayer({
				execute: () =>
					Effect.succeed({ logs: [], error: null, value: { items: [{}] }, status: "completed" }),
			}),
		),
	),
);

it.effect("rejects unavailable configured scripts before provider execution", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, {
				savedViewSlug: view.slug,
				query: "matrix",
				page: 1,
				pageSize: 20,
			}),
		);
		assertExitFails(
			exit,
			new BadRequest({
				message: "Saved view search script 'movie.tmdb.search' is missing, inactive, or invalid",
			}),
		);
	}).pipe(Effect.provide(makeLayer({ unavailableScripts: new Set(["movie.tmdb.search"]) }))),
);

it.effect("loads the saved view only within the authenticated user scope", () => {
	const requestedUsers: UserId[] = [];
	return Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, {
				savedViewSlug: view.slug,
				query: "matrix",
				page: 1,
				pageSize: 20,
			}),
		);
		assertExitFails(exit, new NotFound({ message: "Saved view not found" }));
		expect(requestedUsers).toEqual([user.id]);
	}).pipe(Effect.provide(makeLayer({ missingView: true, requestedUsers })));
});
