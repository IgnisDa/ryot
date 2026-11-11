import { expect } from "bun:test";

import {
	EntityId,
	type PublicationId,
	SavedViewId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { ascending, column, document, field, rows, table } from "@ryot-app/ryotql";
import { publicationBrowserSource } from "@ryot-app/ryotql-recipes/publication-browse";
import { layer } from "@voila.dev/effect-bun-test";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import { ManagedAssetReferencesRepository } from "#modules/assets/storage/managed-asset-references-repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { PagesService } from "#modules/pages/preparation/service";
import { RyotQLService } from "#modules/ryotql/service";
import { DatabaseSession } from "#platform/db/session";
import { TransientValues } from "#platform/transient-values";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { PublicationVisitLimits } from "./limits";
import { PublicationsRepository } from "./repository";
import { PublicationsService } from "./service";
import { PublicationSessions } from "./sessions";
import { PublicationVisitsService } from "./visits";

const owner = { id: UserId.make("owner"), preferences: defaultUserPreferences };
const subject = table("entity", "subject");
const browser = publicationBrowserSource([{ slug: "root", pluginId: null }]);
const stranger = { id: UserId.make("stranger"), preferences: defaultUserPreferences };

const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db.insert(tables.user).values([
				{ id: owner.id, name: "Owner", email: "owner@example.test" },
				{ id: stranger.id, name: "Stranger", email: "stranger@example.test" },
			]);
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

const publicationsLayer = (disablePublications = false) =>
	Layer.mergeAll(PublicationsService.layer, PublicationVisitsService.layer).pipe(
		Layer.provide(
			Layer.mergeAll(
				PublicationsRepository.layer,
				ManagedAssetReferencesRepository.layer,
				PublicationVisitLimits.layer,
				RyotQLService.layer,
				PublicationSessions.layer.pipe(Layer.provide(TransientValues.layer)),
				Layer.mock(PagesService)({}),
				Layer.mock(ManagedAssetsService)({}),
			),
		),
		Layer.provideMerge(Layer.effectDiscard(seed)),
		Layer.provide(makeAppConfigLayer({ server: { disablePublications } })),
		Layer.provideMerge(isolatedDatabaseLayer("publications")),
	);

const details = {
	icon: "book",
	title: "Shelf",
	description: null,
	showOwnerName: false,
	source: { kind: "collection", collectionId: EntityId.make("shelf") },
} as const;

const subjectIds = {
	queries: { rows: rows(subject, { fields: [field("id", column(subject, "id"))] }) },
};

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
			const result = (yield* visits.query(principal, {
				source: { kind: "inline", document: subjectIds },
			})).data["rows"];
			expect(result?.type === "rows" ? result.items : null).toEqual([{ id: "a" }]);
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
				source: {
					kind: "saved-view",
					reference: { kind: "custom", savedViewId: SavedViewId.make("roots") },
				},
			});
			expect(yield* publications.status(owner, publicationId)).toEqual({
				itemCount: 2,
				status: "ready",
			});
			const preview = yield* publications.preview(owner, publicationId);
			const principal = yield* visits.authenticate(preview.sessionToken);
			const result = (yield* visits.query(principal, {
				source: { kind: "inline", document: subjectIds },
			})).data["rows"];
			expect(result?.type === "rows" ? result.items : null).toEqual([{ id: "a" }, { id: "b" }]);
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
