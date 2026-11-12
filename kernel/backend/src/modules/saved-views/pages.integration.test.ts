import { expect } from "bun:test";

import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { PageAuthoringError, type PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import { SavedViewBadRequest } from "@ryot-app/contract/modules/saved-views/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { pageClientArtifactMetadata, pageDeclarationHash } from "@ryot-app/plugin-client-contract";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { PageAuthoringRepository } from "#modules/pages/authoring/repository";
import { ClientArtifactsRepository } from "#modules/pages/bundles/repository";
import { PluginCatalogInvalidator } from "#modules/plugins/catalog/events";
import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";

import { SavedViewsRepository } from "./repository";
import { SavedViewsService } from "./service";

const owner: CurrentUserValue = {
	image: null,
	name: "Owner",
	id: UserId.make("owner"),
	email: "owner@example.test",
	preferences: {
		language: null,
		reportingTimeZone: UTC,
		ratingScale: "hundred",
		disableIntegrations: false,
	},
};
const definition: PageDefinition = {
	files: [],
	pluginDependencies: {},
	entry: "client/page.tsx",
	queries: { queries: {} },
};
const services = Layer.mergeAll(SavedViewsService.layer, PageAuthoringRepository.layer).pipe(
	Layer.provideMerge(SavedViewsRepository.layer),
	Layer.provide(PluginCatalogInvalidator.layer),
	Layer.provideMerge(revisionDatabaseLayer),
	Layer.provide(makeAppConfigLayer()),
);

layer(services)((test) => {
	test.effect(
		"creates, updates, clones and deletes page views with owner-preserving in-use protection",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const pages = yield* PageAuthoringRepository;
				const artifacts = yield* ClientArtifactsRepository;
				const service = yield* SavedViewsService;
				const repository = yield* SavedViewsRepository;
				const artifact = {
					...pageClientArtifactMetadata("Page", [], {
						imports: [],
						pageDeclarationHash: pageDeclarationHash(definition),
					}),
					files: [],
				};
				yield* artifacts.persistClientArtifact(artifact);
				const draft = yield* pages.create(owner.id, {
					definition,
					slug: "page",
					name: "Page",
					origin: "user",
					definitionHash: "definition",
				});
				const config = {
					settings: {},
					arguments: {},
					dataSources: null,
					renderer: { pageId: draft.pageId, kind: "page" as const },
				};
				assertExitFails(
					yield* Effect.exit(
						service.create(owner, { ...config, icon: "file", name: "Unpublished" }),
					),
					new SavedViewBadRequest({ reason: { code: "renderer-not-found" } }),
				);
				const current = yield* pages.find(owner.id, draft.pageId);
				assert(current);
				yield* pages.recordBuild(owner.id, draft.pageId, current, artifact.hash, true);
				const created = yield* service.create(owner, {
					...config,
					icon: "file",
					name: "Page view",
				});
				const replayInput = { ...config, icon: "file", name: "Replay" };
				const replay = yield* service.create(owner, replayInput, undefined, "view-create");
				expect(yield* service.create(owner, replayInput, undefined, "view-create")).toEqual(replay);
				const replayReference = { savedViewId: replay.id, kind: "custom" as const };
				const deleted = yield* service.delete(owner, replayReference, "view-delete");
				expect(yield* service.delete(owner, replayReference, "view-delete")).toEqual(deleted);
				const reference = { kind: "custom" as const, savedViewId: created.id };
				yield* service.update(owner, reference, { ...config, name: "Renamed", isHidden: false });
				const clone = yield* service.clone(owner, reference);
				expect(
					yield* repository.findByReference(owner.id, { kind: "custom", savedViewId: clone.id }),
				).toMatchObject({
					settings: {},
					arguments: {},
					dataSources: null,
					renderer: config.renderer,
				});
				expect(
					yield* service
						.update(owner, reference, { isHidden: false, arguments: { forbidden: true } })
						.pipe(Effect.flip),
				).toBeInstanceOf(SavedViewBadRequest);
				expect(
					yield* service
						.update(owner, reference, { isHidden: false, sort: "name-asc" })
						.pipe(Effect.flip),
				).toBeInstanceOf(SavedViewBadRequest);
				const other = { ...owner, id: UserId.make("recipient") };
				assertExitFails(
					yield* Effect.exit(service.create(other, { ...config, icon: "file", name: "Foreign" })),
					new SavedViewBadRequest({ reason: { code: "renderer-not-found" } }),
				);
				const crossOwner = yield* session
					.run((db) =>
						db
							.insert(tables.savedView)
							.values({
								icon: "file",
								settings: {},
								slug: "foreign",
								name: "Foreign",
								userId: other.id,
								renderer: config.renderer,
							}),
					)
					.pipe(Effect.flip);
				expect(crossOwner.code).toBe("23503");
				assertExitFails(
					yield* Effect.exit(pages.remove(owner.id, draft.pageId)),
					new PageAuthoringError({ reason: { code: "page-in-use" } }),
				);
				yield* service.delete(owner, reference);
				assertExitFails(
					yield* Effect.exit(pages.remove(owner.id, draft.pageId)),
					new PageAuthoringError({ reason: { code: "page-in-use" } }),
				);
				yield* service.delete(owner, { kind: "custom", savedViewId: clone.id });
				yield* pages.remove(owner.id, draft.pageId);
				expect(yield* pages.find(owner.id, draft.pageId)).toBeNull();
			}),
		testTimeout,
	);
});
