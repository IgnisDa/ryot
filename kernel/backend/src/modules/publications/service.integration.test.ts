import { expect } from "bun:test";

import { ClientPagePreparationError } from "@ryot-app/contract/modules/pages/schemas";
import { encodeEntitySourceReference } from "@ryot-app/contract/modules/ryotql/entity-source";
import {
	EntityId,
	type PublicationId,
	SavedViewId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import {
	ascending,
	column,
	concat,
	document,
	field,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { kernelPublicationPage } from "@ryot-app/ryotql-recipes/publication-browse";
import { assert } from "@ryot-app/testing/assert";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq } from "drizzle-orm";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import { ManagedAssetReferencesRepository } from "#modules/assets/storage/managed-asset-references-repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { PageAuthoringRepository } from "#modules/pages/authoring/repository";
import { ClientArtifactGrantService } from "#modules/pages/bundles/grant-service";
import { PagesService } from "#modules/pages/preparation/service";
import { publicationComposition } from "#modules/pages/preparation/test-fixtures";
import { RyotQLService } from "#modules/ryotql/service";
import { DatabaseSession } from "#platform/db/session";
import { TransientValues } from "#platform/transient-values";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { PublicationArtifactGrantsLive } from "./layer";
import { PublicationVisitLimits } from "./limits";
import { PublicationsRepository } from "./repository";
import { PublicationRuntime } from "./runtime";
import { PublicationsService } from "./service";
import { PublicationSessions } from "./sessions";
import { PublicationVisitsService } from "./visits";

const owner = { id: UserId.make("owner"), preferences: defaultUserPreferences };
const subject = table("entity", "subject");
const browser = kernelPublicationPage({
	schemas: [{ slug: "root", browse: null, pluginId: null }],
});
const stranger = { id: UserId.make("stranger"), preferences: defaultUserPreferences };

const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db.insert(tables.user).values([
				{ id: owner.id, name: "Owner", email: "owner@example.test" },
				{ id: stranger.id, name: "Stranger", email: "stranger@example.test" },
			]);
			yield* db
				.insert(tables.definitionEntitySchema)
				.values({
					icon: "box",
					position: 0,
					slug: "root",
					name: "Root",
					mergeIdentityProperties: [],
					propertiesSchema: {
						fields: {
							cover: {
								type: "object",
								label: "Cover",
								properties: {},
								description: "Stored cover",
								validation: { asset: true },
							},
						},
					},
				});
			yield* db
				.insert(tables.definitionSavedView)
				.values({
					icon: "box",
					position: 0,
					sortOrder: 0,
					name: "Roots",
					slug: "root-presentation",
					settings: browser.settings,
					renderer: { kind: "kernel", name: "entity-browser" },
					dataSources: document({
						items: rows(subject, {
							fields: [
								field("cover", jsonPath(column(subject, "properties"), "cover")),
								field("computedLabel", concat(literal("Name: "), column(subject, "name"))),
								field("unsafeOwner", column(subject, "userId")),
							],
						}),
					}),
				});
			yield* db
				.insert(tables.clientArtifact)
				.values({
					format: 1,
					apiVersion: 1,
					bridgeVersion: 1,
					compilerVersion: 1,
					hash: "page-artifact",
				});
			const definition = {
				files: [],
				pluginDependencies: {},
				entry: "client/page.tsx",
				queries: {
					queries: {
						names: rows(subject, {
							orderBy: [ascending(column(subject, "name"))],
							fields: [field("name", column(subject, "name"))],
						}),
					},
				},
			};
			yield* db
				.insert(tables.page)
				.values({
					id: "page",
					slug: "page",
					name: "Page",
					origin: "user",
					userId: owner.id,
					writeAccess: true,
					publishedRevision: 1,
					draftDefinition: definition,
					publishedDefinition: definition,
					draftDefinitionHash: "definition",
					publishedDefinitionHash: "definition",
					publishedArtifactHash: "page-artifact",
				});
			yield* db.insert(tables.entity).values([
				{ id: "a", name: "Alpha", userId: owner.id, entitySchemaSlug: "root" },
				{ id: "b", name: "Beta", userId: owner.id, entitySchemaSlug: "root" },
				{ id: "shelf", name: "Shelf", userId: owner.id, entitySchemaSlug: "collection" },
			]);
			yield* db
				.insert(tables.relationship)
				.values([
					{
						userId: owner.id,
						sourceEntityId: "a",
						targetEntityId: "shelf",
						properties: { rank: 1 },
						relationshipSchemaSlug: "member-of",
					},
				]);
			yield* db
				.insert(tables.savedView)
				.values({
					id: "roots",
					icon: "box",
					sortOrder: 0,
					slug: "roots",
					name: "Roots",
					userId: owner.id,
					settings: browser.settings,
					renderer: { kind: "kernel", name: "entity-browser" },
					dataSources: document({
						[browser.settings.sourceName]: rows(subject, {
							orderBy: [ascending(column(subject, "name"))],
							fields: [field("name", column(subject, "name"))],
						}),
					}),
				});
		}),
	);
});

const testPages = Layer.effect(
	PagesService,
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		return {
			prepare: () => Effect.die("unused"),
			document: () => Effect.die("unused"),
			isIdentityCurrent: () => Effect.die("unused"),
			publicationDocument: () => Effect.die("unused"),
			retainPublicationComposition: () => Effect.void,
			preparePublication: Effect.fn(function* (userId, reference, frozen) {
				let page = frozen?.page ?? null;
				if (!page && reference.kind === "page") {
					const [row] = yield* session.run((db) =>
						db
							.select()
							.from(tables.page)
							.where(and(eq(tables.page.id, reference.pageId), eq(tables.page.userId, userId))),
					);
					if (
						!row?.publishedDefinition ||
						row.publishedRevision === null ||
						!row.publishedDefinitionHash ||
						!row.publishedArtifactHash
					) {
						return yield* new ClientPagePreparationError({
							reason: { code: "page-unavailable", pageId: reference.pageId },
						});
					}
					page = {
						pageId: row.id,
						name: row.name,
						revision: row.publishedRevision,
						definition: row.publishedDefinition,
						artifactHash: row.publishedArtifactHash,
						authorityRevision: row.authorityRevision,
						definitionHash: row.publishedDefinitionHash,
					};
				}
				return {
					page,
					contributors: [],
					rendererName: "publication",
					capturedComposition: frozen?.composition ?? (yield* publicationComposition(page)),
					composition: {
						format: 1,
						hash: "test",
						apiVersion: 1,
						bridgeVersion: 1,
						compilerVersion: 1,
					},
				};
			}),
		} satisfies PagesService["Service"];
	}),
);

const publicationsLayer = (disablePublications = false) =>
	Layer.mergeAll(PublicationsService.layer, PublicationVisitsService.layer).pipe(
		Layer.provideMerge(
			PublicationRuntime.layer.pipe(
				Layer.provideMerge(Layer.mergeAll(DefinitionCatalog.layer, RyotQLService.layer, testPages)),
			),
		),
		Layer.provideMerge(
			Layer.mergeAll(
				PublicationsRepository.layer,
				ManagedAssetReferencesRepository.layer,
				PageAuthoringRepository.layer,
				PublicationVisitLimits.layer,
				RyotQLService.layer,
				PublicationSessions.layer.pipe(Layer.provide(TransientValues.layer)),
				testPages,
				PublicationArtifactGrantsLive,
				Layer.succeed(ManagedAssetsService, {
					registerManagedAsset: () => Effect.die("unused"),
					listManagedAssetsForOwner: () => Effect.die("unused"),
					verifyManagedAssetOwnership: () => Effect.die("unused"),
					cleanupStagedPermanentAsset: () => Effect.die("unused"),
					stageContentAddressedPermanentAsset: () => Effect.die("unused"),
					registerManagedAssetInLockedTransaction: () => Effect.die("unused"),
					resolveDownloads: (_owner, locators) =>
						Effect.succeed(
							locators.map((asset) => ({
								asset,
								expiresAt: "2099-01-01T00:00:00.000Z",
								downloadUrl: `https://assets.test/${asset.key}`,
							})),
						),
				}),
			),
		),
		Layer.provideMerge(Layer.effectDiscard(seed)),
		Layer.provideMerge(TransientValues.layer),
		Layer.provide(makeAppConfigLayer({ server: { disablePublications } })),
		Layer.provideMerge(isolatedDatabaseLayer("publications")),
	);

const details = {
	icon: "book",
	mode: "live",
	title: "Shelf",
	description: null,
	showOwnerName: false,
	visitorParameters: ["search", "entityId"],
	page: { kind: "kernel", name: "publication" },
	arguments: {
		source: encodeEntitySourceReference({
			kind: "collection",
			collectionId: EntityId.make("shelf"),
		}),
	},
} as const;
const snapshotDetails = { ...details, mode: "snapshot", visitorParameters: [] } as const;

const publishWithLink = (expiresAt: null | string = null) =>
	Effect.gen(function* () {
		const publications = yield* PublicationsService;
		const { publicationId } = yield* publications.create(owner, details);
		const link = yield* publications.createLink(owner, {
			expiresAt,
			publicationId,
			label: "Friends",
		});
		return { link, publicationId };
	});

const visit = (publicationId: PublicationId, secret: string) =>
	Effect.gen(function* () {
		const visits = yield* PublicationVisitsService;
		const session = yield* visits.exchange({ secret, publicationId, visitorAddress: "1.1.1.1" });
		return yield* visits.authenticate(session.sessionToken);
	});

layer(publicationsLayer())((test) => {
	test.effect("lets a link holder read only the published subjects", () =>
		Effect.gen(function* () {
			const visits = yield* PublicationVisitsService;
			const { link, publicationId } = yield* publishWithLink();
			const principal = yield* visit(publicationId, link.secret);
			const result = (yield* visits.query(principal, { query: "items" })).data["items"];
			expect(
				result?.type === "rows" ? result.items.map((item) => item["__entityBrowserId"]) : null,
			).toEqual(["a"]);
		}),
	);

	test.effect("refuses a secret for another publication", () =>
		Effect.gen(function* () {
			const first = yield* publishWithLink();
			const second = yield* publishWithLink();
			const error = yield* visit(second.publicationId, first.link.secret).pipe(Effect.flip);
			expect(error).toMatchObject({ reason: { code: "not-found" } });
		}),
	);

	test.effect("ends existing sessions when their link is revoked", () =>
		Effect.gen(function* () {
			const publications = yield* PublicationsService;
			const visits = yield* PublicationVisitsService;
			const { link, publicationId } = yield* publishWithLink();
			const session = yield* visits.exchange({
				publicationId,
				secret: link.secret,
				visitorAddress: "1.1.1.1",
			});
			yield* publications.revokeLink(owner, link.linkId);
			const error = yield* visits.authenticate(session.sessionToken).pipe(Effect.flip);
			expect(error).toMatchObject({ reason: { code: "revoked" } });
		}),
	);

	test.effect("ends every link and preview when the publication is revoked", () =>
		Effect.gen(function* () {
			const publications = yield* PublicationsService;
			const visits = yield* PublicationVisitsService;
			const { link, publicationId } = yield* publishWithLink();
			const preview = yield* publications.preview(owner, publicationId);
			yield* publications.revoke(owner, publicationId);
			expect(yield* visits.authenticate(preview.sessionToken).pipe(Effect.flip)).toMatchObject({
				reason: { code: "revoked" },
			});
			expect(yield* visit(publicationId, link.secret).pipe(Effect.flip)).toMatchObject({
				reason: { code: "revoked" },
			});
		}),
	);

	test.effect("expires sessions with their link", () =>
		Effect.gen(function* () {
			const visits = yield* PublicationVisitsService;
			const { link, publicationId } = yield* publishWithLink("1970-01-01T00:10:00.000Z");
			const session = yield* visits.exchange({
				publicationId,
				secret: link.secret,
				visitorAddress: "1.1.1.1",
			});
			expect(session.expiresAt).toBe("1970-01-01T00:10:00.000Z");
			yield* TestClock.adjust(Duration.minutes(10));
			expect(yield* visits.authenticate(session.sessionToken).pipe(Effect.flip)).toMatchObject({
				reason: { code: "expired" },
			});
		}),
	);

	test.effect("refuses links that already expired", () =>
		Effect.gen(function* () {
			yield* TestClock.adjust(Duration.minutes(1));
			const error = yield* publishWithLink("1970-01-01T00:00:00.000Z").pipe(Effect.flip);
			expect(error).toMatchObject({ reason: { code: "expiry-in-past" } });
		}),
	);

	test.effect("keeps publications private to their owner", () =>
		Effect.gen(function* () {
			const publications = yield* PublicationsService;
			const { publicationId } = yield* publishWithLink();
			const error = yield* publications.revoke(stranger, publicationId).pipe(Effect.flip);
			expect(error._tag).toBe("PublicationNotFound");
		}),
	);

	test.effect("publishes a saved view's current results", () =>
		Effect.gen(function* () {
			const publications = yield* PublicationsService;
			const visits = yield* PublicationVisitsService;
			const { publicationId } = yield* publications.create(owner, {
				...details,
				arguments: {
					source: encodeEntitySourceReference({
						kind: "saved-view",
						reference: { kind: "custom", savedViewId: SavedViewId.make("roots") },
					}),
				},
			});
			expect(yield* publications.status(owner, publicationId)).toEqual({ status: "ready" });
			const preview = yield* publications.preview(owner, publicationId);
			const principal = yield* visits.authenticate(preview.sessionToken);
			const result = (yield* visits.query(principal, { query: "items" })).data["items"];
			expect(
				result?.type === "rows" ? result.items.map((item) => item["__entityBrowserId"]) : null,
			).toEqual(["a", "b"]);
		}),
	);

	test.effect("refuses a collection the owner does not have", () =>
		Effect.gen(function* () {
			const publications = yield* PublicationsService;
			const error = yield* publications.create(stranger, details).pipe(Effect.flip);
			expect(error).toMatchObject({ reason: { code: "source-unavailable" } });
		}),
	);

	test.effect("limits link exchanges per visitor address", () =>
		Effect.gen(function* () {
			const visits = yield* PublicationVisitsService;
			const { link, publicationId } = yield* publishWithLink();
			const exchange = (visitorAddress: string) =>
				visits.exchange({ publicationId, visitorAddress, secret: link.secret });
			yield* Effect.forEach(Array.from({ length: 10 }), () => exchange("2.2.2.2"));
			const error = yield* exchange("2.2.2.2").pipe(Effect.flip);
			expect(error._tag).toBe("PublicationRateLimited");
			yield* exchange("3.3.3.3");
		}),
	);
});

layer(publicationsLayer())("publication page execution", (test) => {
	test.effect("lets visitors change only allowed parameters and refuses undeclared names", () =>
		Effect.gen(function* () {
			const publications = yield* PublicationsService;
			const visits = yield* PublicationVisitsService;
			const { publicationId } = yield* publications.create(owner, details);
			const preview = yield* publications.preview(owner, publicationId);
			const principal = yield* visits.authenticate(preview.sessionToken);
			const otherSource = {
				source: encodeEntitySourceReference({
					kind: "collection",
					collectionId: EntityId.make("missing"),
				}),
			};
			expect(
				yield* visits.query(principal, { query: "items", arguments: otherSource }).pipe(Effect.flip),
			).toMatchObject({ reason: { code: "invalid-query" } });
			expect(
				yield* visits.describe(principal, "items", otherSource).pipe(Effect.flip),
			).toMatchObject({ reason: { code: "invalid-query" } });
			expect(
				yield* visits.query(principal, { query: "items", arguments: details.arguments }),
			).toMatchObject({ data: { items: { items: [{ __entityBrowserId: "a" }] } } });
			expect(
				yield* visits.query(principal, { query: "items", arguments: { search: "missing" } }),
			).toMatchObject({ data: { items: { items: [] } } });
			for (const input of [
				{ ...details, visitorParameters: ["unknown"] },
				{ ...details, mode: "snapshot" as const },
			]) {
				expect(yield* publications.create(owner, input).pipe(Effect.flip)).toMatchObject({
					reason: { code: "bindings-invalid" },
				});
			}
			expect(yield* visits.query(principal, { query: "guessed" }).pipe(Effect.flip)).toMatchObject({
				reason: { code: "invalid-query" },
			});
			expect(yield* visits.query(principal, { query: "item" })).toMatchObject({
				data: { item: { items: [] } },
			});
			expect(yield* visits.query(principal, { query: "linked" })).toMatchObject({
				data: { linked: { items: [] } },
			});
		}),
	);
	test.effect("captures every first page and atomically replaces snapshots on refresh", () =>
		Effect.gen(function* () {
			const publications = yield* PublicationsService;
			const visits = yield* PublicationVisitsService;
			const session = yield* DatabaseSession;
			const input = snapshotDetails;
			const { publicationId } = yield* publications.create(owner, input);
			const preview = yield* publications.preview(owner, publicationId);
			const principal = yield* visits.authenticate(preview.sessionToken);
			const first = yield* visits.query(principal, { query: "items" });
			expect(
				yield* visits.query(principal, { query: "items", arguments: details.arguments }),
			).toEqual(first);
			yield* session.run((db) =>
				db.update(tables.entity).set({ name: "Changed" }).where(eq(tables.entity.id, "a")),
			);
			expect(yield* visits.query(principal, { query: "items" })).toEqual(first);
			for (const request of [
				{ query: "items", arguments: { search: "Changed" } },
				{ query: "items", sort: "name:desc" },
				{ query: "items", filter: { filters: [], type: "and" as const } },
				{ query: "items", pages: { items: { limit: 1 } } },
			]) {
				expect(yield* visits.query(principal, request).pipe(Effect.flip)).toMatchObject({
					reason: { code: "invalid-query" },
				});
			}
			expect(yield* visits.query(principal, { query: "item" })).toMatchObject({
				data: { item: { items: [] } },
			});
			const failed = yield* publications
				.republish(owner, { ...input, publicationId, arguments: { source: "invalid" } })
				.pipe(Effect.flip);
			expect(failed._tag).toBe("PublicationBadRequest");
			expect(yield* visits.query(principal, { query: "items" })).toEqual(first);
			yield* publications.republish(owner, { ...input, publicationId });
			expect(yield* visits.query(principal, { query: "items" })).toMatchObject({
				data: { items: { items: [{ name: "Changed" }] } },
			});
			const live = yield* publications.create(owner, details);
			yield* session.run((db) => db.delete(tables.entity).where(eq(tables.entity.id, "shelf")));
			expect(yield* publications.status(owner, live.publicationId)).toMatchObject({
				status: "needs-attention",
				reason: { code: "source-unavailable" },
			});
			expect(yield* visits.query(principal, { query: "items" })).toMatchObject({
				data: { items: { items: [{ name: "Changed" }] } },
			});
		}),
	);
	test.effect(
		"follows published user pages live and freezes their snapshot definition and authority",
		() =>
			Effect.gen(function* () {
				const publications = yield* PublicationsService;
				const visits = yield* PublicationVisitsService;
				const session = yield* DatabaseSession;
				const input = {
					...details,
					arguments: {},
					visitorParameters: [],
					page: { pageId: "page", kind: "page" as const },
				};
				const live = yield* publications.create(owner, input);
				const snapshot = yield* publications.create(owner, { ...input, mode: "snapshot" });
				const livePrincipal = yield* publications
					.preview(owner, live.publicationId)
					.pipe(Effect.flatMap((preview) => visits.authenticate(preview.sessionToken)));
				const frozenPrincipal = yield* publications
					.preview(owner, snapshot.publicationId)
					.pipe(Effect.flatMap((preview) => visits.authenticate(preview.sessionToken)));
				const before = yield* visits.query(frozenPrincipal, { query: "names" });
				const definition = {
					files: [],
					pluginDependencies: {},
					entry: "client/page.tsx",
					queries: {
						queries: {
							renamed: rows(subject, { fields: [field("name", column(subject, "name"))] }),
						},
					},
				};
				yield* session.run((db) =>
					db
						.update(tables.page)
						.set({
							publishedRevision: 2,
							publishedDefinition: definition,
							publishedDefinitionHash: "changed",
						})
						.where(eq(tables.page.id, "page")),
				);
				expect(
					yield* visits.query(livePrincipal, { query: "names" }).pipe(Effect.flip),
				).toMatchObject({ reason: { code: "invalid-query" } });
				expect(yield* visits.query(livePrincipal, { query: "renamed" })).toMatchObject({
					data: { renamed: { type: "rows" } },
				});
				expect(yield* visits.query(frozenPrincipal, { query: "names" })).toEqual(before);
				expect(yield* visits.page(frozenPrincipal)).toMatchObject({
					publication: { mode: "snapshot" },
					context: { renderer: { revision: 1, kind: "page", writeAccess: false } },
				});
				expect(yield* publications.create(stranger, input).pipe(Effect.flip)).toMatchObject({
					reason: { code: "page-unavailable" },
				});
			}),
	);
});

layer(publicationsLayer())("publication result assets", (test) => {
	test.effect("authorizes only successful result locators and retains snapshot assets", () =>
		Effect.gen(function* () {
			const publications = yield* PublicationsService;
			const visits = yield* PublicationVisitsService;
			const session = yield* DatabaseSession;
			const locator = { type: "local" as const, key: "permanent/cover.png" };
			const guessed = { type: "local" as const, key: "permanent/secret.png" };
			yield* session.run((db) =>
				db
					.update(tables.entity)
					.set({ properties: { cover: locator, hidden: guessed } })
					.where(eq(tables.entity.id, "a")),
			);
			const input = {
				...details,
				arguments: {},
				visitorParameters: [],
				page: { kind: "page", pageId: "page" } as const,
			};
			yield* session.run((db) =>
				db
					.update(tables.page)
					.set({
						publishedDefinition: {
							files: [],
							pluginDependencies: {},
							entry: "client/page.tsx",
							queries: {
								queries: {
									items: rows(subject, {
										fields: [field("cover", jsonPath(column(subject, "properties"), "cover"))],
									}),
								},
							},
						},
					})
					.where(eq(tables.page.id, "page")),
			);
			const live = yield* publications.create(owner, input);
			const principal = yield* publications
				.preview(owner, live.publicationId)
				.pipe(Effect.flatMap((preview) => visits.authenticate(preview.sessionToken)));
			expect(yield* visits.resolveAssets(principal, [locator, guessed])).toEqual([]);
			yield* visits.query(principal, { query: "items" });
			expect(yield* visits.resolveAssets(principal, [locator, guessed])).toMatchObject([
				{ asset: locator },
			]);
			const other = yield* publications
				.preview(owner, live.publicationId)
				.pipe(Effect.flatMap((preview) => visits.authenticate(preview.sessionToken)));
			expect(yield* visits.resolveAssets(other, [locator])).toEqual([]);
			yield* publications.republish(owner, { ...input, publicationId: live.publicationId });
			expect(yield* visits.resolveAssets(principal, [locator])).toEqual([]);
			const snapshot = yield* publications.create(owner, { ...input, mode: "snapshot" });
			const frozen = yield* publications
				.preview(owner, snapshot.publicationId)
				.pipe(Effect.flatMap((preview) => visits.authenticate(preview.sessionToken)));
			yield* session.run((db) =>
				db.update(tables.entity).set({ properties: {} }).where(eq(tables.entity.id, "a")),
			);
			expect(yield* visits.resolveAssets(frozen, [locator, guessed])).toMatchObject([
				{ asset: locator },
			]);
			const references = yield* ManagedAssetReferencesRepository;
			expect(yield* references.referencedLocators(owner.id, [locator, guessed])).toEqual([locator]);
		}),
	);
	test.effect("scopes code grants to sessions, revisions and link revocation", () =>
		Effect.gen(function* () {
			const publications = yield* PublicationsService;
			const grants = yield* ClientArtifactGrantService;
			const { link, publicationId } = yield* publishWithLink();
			const principal = yield* visit(publicationId, link.secret);
			const granted = yield* grants.issue(owner.id, "page-artifact", { ...principal, revision: 1 });
			expect(yield* grants.resolve(granted.token)).toMatchObject({ artifactHash: "page-artifact" });
			yield* publications.republish(owner, { ...details, publicationId });
			expect(yield* grants.resolve(granted.token)).toBeNull();
			const next = yield* grants.issue(owner.id, "page-artifact", { ...principal, revision: 2 });
			expect(yield* grants.resolve(next.token)).toMatchObject({ artifactHash: "page-artifact" });
			yield* publications.revokeLink(owner, link.linkId);
			expect(yield* grants.resolve(next.token)).toBeNull();
		}),
	);
	test.effect(
		"rejects incomplete and oversized captures without replacing the prior snapshot",
		() =>
			Effect.gen(function* () {
				const publications = yield* PublicationsService;
				const visits = yield* PublicationVisitsService;
				const session = yield* DatabaseSession;
				const pageRepository = yield* PageAuthoringRepository;
				const input = {
					...details,
					arguments: {},
					visitorParameters: [],
					mode: "snapshot" as const,
					page: { pageId: "page", kind: "page" as const },
				};
				const published = yield* publications.create(owner, input);
				const principal = yield* publications
					.preview(owner, published.publicationId)
					.pipe(Effect.flatMap((preview) => visits.authenticate(preview.sessionToken)));
				const before = yield* visits.query(principal, { query: "items" });
				const query = rows(subject, {
					fields: [field("properties", column(subject, "properties"))],
				});
				const requiredDefinition = {
					files: [],
					pluginDependencies: {},
					entry: "client/page.tsx",
					queries: {
						queries: { names: query },
						parameters: {
							fields: {
								required: {
									label: "Required",
									type: "string" as const,
									description: "Capture value",
									validation: { required: true as const },
								},
							},
						},
					},
				};
				yield* session.run((db) =>
					db
						.update(tables.page)
						.set({ publishedDefinition: requiredDefinition })
						.where(eq(tables.page.id, "page")),
				);
				expect(
					yield* publications
						.republish(owner, { ...input, publicationId: published.publicationId })
						.pipe(Effect.flip),
				).toMatchObject({ reason: { code: "bindings-invalid" } });
				yield* session.run((db) =>
					db
						.update(tables.page)
						.set({
							publishedDefinition: {
								...requiredDefinition,
								queries: {
									...requiredDefinition.queries,
									queries: { names: query, second: query },
								},
							},
						})
						.where(eq(tables.page.id, "page")),
				);
				yield* session.run((db) =>
					db
						.update(tables.entity)
						.set({ properties: { payload: "x".repeat(1100 * 1024) } })
						.where(eq(tables.entity.id, "a")),
				);
				expect(
					yield* publications
						.republish(owner, {
							...input,
							arguments: { required: "bound" },
							publicationId: published.publicationId,
						})
						.pipe(Effect.flip),
				).toMatchObject({ reason: { code: "snapshot-too-large" } });
				expect(yield* visits.query(principal, { query: "items" })).toEqual(before);
				expect(yield* pageRepository.remove(owner.id, "page").pipe(Effect.flip)).toMatchObject({
					reason: { code: "page-in-use" },
				});
			}),
	);
});

layer(publicationsLayer())("system publication projections", (test) => {
	test.effect("does not derive public presentation data from saved-view fields", () =>
		Effect.gen(function* () {
			const publications = yield* PublicationsService;
			const visits = yield* PublicationVisitsService;
			const { publicationId } = yield* publications.create(owner, details);
			const principal = yield* publications
				.preview(owner, publicationId)
				.pipe(Effect.flatMap((preview) => visits.authenticate(preview.sessionToken)));
			const result = yield* visits.query(principal, { query: "items" });
			expect(result.data["items"]?.items[0]).toMatchObject({ __entityPresentation: null });
			expect(result.data["items"]?.items[0]).not.toHaveProperty("computedLabel");
			expect(result.data["items"]?.items[0]).not.toHaveProperty("unsafeOwner");
		}),
	);
});

layer(publicationsLayer())("stored snapshot validation", (test) => {
	test.effect(
		"reports oversized stored snapshots and never falls back when capture is missing",
		() =>
			Effect.gen(function* () {
				const publications = yield* PublicationsService;
				const visits = yield* PublicationVisitsService;
				const repository = yield* PublicationsRepository;
				const session = yield* DatabaseSession;
				const { publicationId } = yield* publications.create(owner, snapshotDetails);
				const principal = yield* publications
					.preview(owner, publicationId)
					.pipe(Effect.flatMap((preview) => visits.authenticate(preview.sessionToken)));
				const stored = yield* repository.findOwned(owner.id, publicationId);
				assert(stored?.snapshot);
				const snapshot = stored.snapshot;
				yield* session.run((db) =>
					db
						.update(tables.publication)
						.set({
							snapshot: {
								...snapshot,
								result: {
									data: {
										oversized: {
											type: "aggregate",
											items: [{ payload: "x".repeat(2 * 1024 * 1024) }],
										},
									},
								},
							},
						})
						.where(eq(tables.publication.id, publicationId)),
				);
				expect(yield* publications.status(owner, publicationId)).toMatchObject({
					status: "needs-attention",
					reason: { code: "snapshot-too-large" },
				});
				expect(yield* visits.query(principal, { query: "items" }).pipe(Effect.flip)).toMatchObject({
					reason: { code: "snapshot-too-large" },
				});
				yield* session.run((db) =>
					db
						.update(tables.publication)
						.set({ snapshot: null })
						.where(eq(tables.publication.id, publicationId)),
				);
				expect(yield* visits.query(principal, { query: "items" }).pipe(Effect.flip)).toMatchObject({
					reason: { code: "page-unavailable" },
				});
			}),
	);
});

layer(publicationsLayer(true))((test) => {
	test.effect("refuses publishing and visiting when the instance disables publications", () =>
		Effect.gen(function* () {
			const publications = yield* PublicationsService;
			const visits = yield* PublicationVisitsService;
			const error = yield* publications.create(owner, details).pipe(Effect.flip);
			expect(error._tag).toBe("PublicationsDisabled");
			const visitError = yield* visits.authenticate("x".repeat(43)).pipe(Effect.flip);
			expect(visitError).toMatchObject({ reason: { code: "disabled" } });
		}),
	);
});
