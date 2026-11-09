import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { PublicationPrincipalValue } from "@ryot-app/contract/modules/publications/contract";
import {
	PUBLICATION_SUBJECT_LIMIT,
	PublicationDocumentStale,
	PublicationUnavailable,
	type PublicationUnavailableCode,
	type PublicationVisitorPage,
} from "@ryot-app/contract/modules/publications/schemas";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { type PublicationId, UserId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Clock, Context, Effect, Layer } from "effect";

import { ManagedAssetReferencesRepository } from "#modules/assets/storage/managed-asset-references-repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { PagesService } from "#modules/pages/preparation/service";
import { RyotQLService } from "#modules/ryotql/service";
import { AppConfig } from "#platform/config/service";
import { isOpaqueTicket } from "#platform/http/opaque-tickets";

import { PublicationVisitLimits } from "./limits";
import { PublicationsRepository } from "./repository";
import { PublicationSessions } from "./sessions";
import { PublicationSources } from "./sources";

const VISITOR_RESULT_BYTES = 2 * 1024 * 1024;

const unavailable = (code: PublicationUnavailableCode) =>
	new PublicationUnavailable({ reason: { code } });

type Link = NonNullable<Effect.Success<ReturnType<PublicationsRepository["Service"]["findLink"]>>>;

export class PublicationVisitsService extends Context.Service<PublicationVisitsService>()(
	"@ryot-app/kernel-backend/modules/publications/visits/PublicationVisitsService",
	{
		make: Effect.gen(function* () {
			const pages = yield* PagesService;
			const config = yield* AppConfig;
			const ryotql = yield* RyotQLService;
			const limits = yield* PublicationVisitLimits;
			const assets = yield* ManagedAssetsService;
			const sessions = yield* PublicationSessions;
			const sources = yield* PublicationSources;
			const repository = yield* PublicationsRepository;
			const references = yield* ManagedAssetReferencesRepository;

			const requireEnabled = config.server.disablePublications
				? Effect.fail(unavailable("disabled"))
				: Effect.void;

			const requireVisible = Effect.fn("PublicationVisits.requireVisible")(function* (
				publicationId: PublicationId,
				link: null | Link,
			) {
				yield* requireEnabled;
				const found = yield* repository.findForVisit(publicationId);
				if (!found || (link !== null && link.publicationId !== publicationId)) {
					return yield* unavailable("not-found");
				}
				if (found.publication.revokedAt !== null || link?.revokedAt) {
					return yield* unavailable("revoked");
				}
				const now = yield* Clock.currentTimeMillis;
				if (link?.expiresAt && link.expiresAt.getTime() <= now) {
					return yield* unavailable("expired");
				}
				if (found.owner.disabledAt !== null) {
					return yield* unavailable("unavailable");
				}
				return found;
			});

			const sourceOf = Effect.fn("PublicationVisits.sourceOf")(function* (
				found: Effect.Success<ReturnType<typeof requireVisible>>,
			) {
				const scope = yield* sources.resolveScope(
					UserId.make(found.publication.userId),
					found.publication.source,
				);
				if (scope === null) {
					return yield* unavailable("unavailable");
				}
				return {
					scope,
					ownerUserId: found.publication.userId,
					subjectLimit: PUBLICATION_SUBJECT_LIMIT,
					language: found.owner.preferences.language,
				};
			});

			const exchange = Effect.fn("PublicationVisits.exchange")(function* ({
				secret,
				publicationId,
				visitorAddress,
			}: {
				readonly secret: string;
				readonly publicationId: PublicationId;
				readonly visitorAddress: null | string;
			}) {
				yield* requireEnabled;
				yield* limits.admitExchange(visitorAddress);
				const link = isOpaqueTicket(secret)
					? yield* repository.findLinkByHash(sha256Hex(secret))
					: null;
				if (link === null) {
					return yield* unavailable("not-found");
				}
				yield* requireVisible(publicationId, link);
				yield* repository.markLinkExchanged(link.id);
				return yield* sessions.start({
					publicationId,
					linkId: link.id,
					linkExpiresAt: link.expiresAt,
				});
			});

			const authenticate = Effect.fn("PublicationVisits.authenticate")(function* (token: string) {
				yield* requireEnabled;
				const session = yield* sessions.find(token);
				const link = session.linkId === null ? null : yield* repository.findLink(session.linkId);
				if (session.linkId !== null && link === null) {
					return yield* unavailable("revoked");
				}
				yield* requireVisible(session.publicationId, link);
				return {
					sessionKey: session.sessionKey,
					publicationId: session.publicationId,
				} satisfies PublicationPrincipalValue;
			});

			const page = Effect.fn("PublicationVisits.page")(function* (
				principal: PublicationPrincipalValue,
			) {
				const found = yield* requireVisible(principal.publicationId, null);
				const subjects = yield* ryotql
					.resolvePublicationSubjects(yield* sourceOf(found))
					.pipe(
						Effect.catchTags({
							RyotQLInternalError: () => unavailable("unavailable"),
							RyotQLBadRequest: (error) =>
								unavailable(
									error.reason.code === "subject-limit-exceeded" ? "too-large" : "unavailable",
								),
						}),
					);
				const ownerUserId = UserId.make(found.publication.userId);
				const prepared = yield* pages
					.preparePublication(ownerUserId)
					.pipe(Effect.catchTag("ClientPagePreparationError", () => unavailable("unavailable")));
				const { publication } = found;
				const ownerName = publication.showOwnerName ? found.owner.name : null;
				return {
					composition: prepared.composition,
					publication: {
						ownerName,
						icon: publication.icon,
						title: publication.title,
						itemCount: subjects.length,
						publicationId: publication.id,
						revision: publication.revision,
						description: publication.description,
					},
					context: {
						dataSources: null,
						route: { params: {} },
						contributors: prepared.contributors,
						view: { icon: publication.icon, name: publication.title },
						renderer: { kind: "kernel", name: prepared.rendererName },
						target: { kind: "publication", publicationId: publication.id },
						settings: {
							ownerName,
							itemCount: subjects.length,
							description: publication.description,
						},
					},
				} satisfies PublicationVisitorPage;
			});

			const document = Effect.fn("PublicationVisits.document")(function* (
				principal: PublicationPrincipalValue,
				compositionHash: string,
			) {
				const found = yield* requireVisible(principal.publicationId, null);
				const generated = yield* pages
					.publicationDocument(UserId.make(found.publication.userId), compositionHash)
					.pipe(Effect.catchTag("ClientPagePreparationError", () => Effect.succeed(null)));
				if (generated === null) {
					return yield* new PublicationDocumentStale({
						reason: { code: "publication-document-stale" },
					});
				}
				return generated;
			});

			const query = Effect.fn("PublicationVisits.query")(function* (
				principal: PublicationPrincipalValue,
				ryotqlDocument: RyotQLDocument,
			) {
				const found = yield* requireVisible(principal.publicationId, null);
				const source = yield* sourceOf(found);
				return yield* limits.withSessionPermit(
					principal.sessionKey,
					ryotql.executeForPublication(source, ryotqlDocument, VISITOR_RESULT_BYTES),
				);
			});

			const resolveAssets = Effect.fn("PublicationVisits.resolveAssets")(function* (
				principal: PublicationPrincipalValue,
				locators: ReadonlyArray<ManagedAssetLocator>,
			) {
				const found = yield* requireVisible(principal.publicationId, null);
				const source = yield* sourceOf(found);
				return yield* limits.withSessionPermit(
					principal.sessionKey,
					Effect.gen(function* () {
						const subjects = yield* ryotql.resolvePublicationSubjects(source);
						const referenced = yield* references.referencedByEntities(
							subjects.map(({ entityId }) => entityId),
							locators,
						);
						if (referenced.length === 0) {
							return [];
						}
						return yield* assets.resolveDownloads(
							{ id: UserId.make(found.publication.userId) },
							referenced,
						);
					}).pipe(
						Effect.catchTags({
							BadRequest: () => Effect.succeed([]),
							UploadBadRequest: () => Effect.succeed([]),
							RyotQLBadRequest: () => Effect.succeed([]),
							RyotQLInternalError: () => Effect.succeed([]),
						}),
					),
				);
			});

			return { page, query, document, exchange, authenticate, resolveAssets };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
