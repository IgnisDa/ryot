import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { PublicationPrincipalValue } from "@ryot-app/contract/modules/publications/contract";
import {
	PublicationDocumentStale,
	PublicationUnavailable,
	type PublicationUnavailableCode,
	type PublicationVisitorPage,
} from "@ryot-app/contract/modules/publications/schemas";
import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import type { VisitorRequest } from "@ryot-app/contract/modules/ryotql/request";
import { type PublicationId, UserId } from "@ryot-app/contract/schema/brands";
import { decodeSavedViewCount } from "@ryot-app/ryotql-recipes/saved-views";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Clock, Context, Duration, Effect, Layer, Result } from "effect";

import { managedAssetLocators } from "#modules/assets/storage/locators";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { ClientArtifactGrantService } from "#modules/pages/bundles/grant-service";
import { PagesService } from "#modules/pages/preparation/service";
import { RyotQLService } from "#modules/ryotql/service";
import { AppConfig } from "#platform/config/service";
import { isOpaqueTicket } from "#platform/http/opaque-tickets";
import { TransientValues } from "#platform/transient-values";

import { PublicationVisitLimits } from "./limits";
import { PUBLICATION_RESULT_BYTES } from "./model";
import { PublicationsRepository } from "./repository";
import { PublicationRuntime } from "./runtime";
import { PublicationSessions } from "./sessions";

const invalidQuery = () => new RyotQLBadRequest({ reason: { code: "invalid-query" } });

const unavailable = (code: PublicationUnavailableCode) =>
	new PublicationUnavailable({ reason: { code } });

type Link = NonNullable<Effect.Success<ReturnType<PublicationsRepository["Service"]["findLink"]>>>;

const assetKey = (
	principal: PublicationPrincipalValue,
	revision: number,
	locator: ManagedAssetLocator,
) =>
	`publication-assets:${principal.sessionKey}:${revision}:${sha256Hex(`${locator.type}:${locator.key}`)}`;

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
			const repository = yield* PublicationsRepository;
			const runtime = yield* PublicationRuntime;
			const values = yield* TransientValues;
			const grants = yield* ClientArtifactGrantService;

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
					return yield* unavailable("page-unavailable");
				}
				return found;
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

			const resolve = Effect.fn("PublicationVisits.resolve")(function* (
				principal: PublicationPrincipalValue,
			) {
				const found = yield* requireVisible(principal.publicationId, null);
				const resolved = yield* runtime
					.resolve(
						UserId.make(found.publication.userId),
						found.publication.definition,
						found.publication.snapshot,
					)
					.pipe(
						Effect.catchTag("PublicationBadRequest", (error) => {
							const code = error.reason.code;
							return unavailable(
								code === "dependency-unavailable" ||
									code === "source-unavailable" ||
									code === "bindings-invalid" ||
									code === "snapshot-too-large"
									? code
									: "page-unavailable",
							);
						}),
					);
				return { ...found, ...resolved };
			});
			const page = Effect.fn("PublicationVisits.page")(function* (
				principal: PublicationPrincipalValue,
			) {
				const found = yield* resolve(principal);
				const { prepared, publication } = found;
				const ownerName = publication.showOwnerName ? found.owner.name : null;
				const mode = publication.definition.mode;
				let itemCount =
					typeof found.settings["itemCount"] === "number" ? found.settings["itemCount"] : undefined;
				if (mode === "live" && publication.definition.page.kind === "kernel") {
					const result = yield* limits.withSessionPermit(
						principal.sessionKey,
						ryotql
							.executeDeclared(
								{ userId: publication.userId, language: found.owner.preferences.language },
								found.document,
								{ query: "count", arguments: publication.definition.arguments },
								PUBLICATION_RESULT_BYTES,
							)
							.pipe(
								Effect.catchTags({
									RyotQLBadRequest: () => unavailable("source-unavailable"),
									RyotQLInternalError: () => unavailable("source-unavailable"),
								}),
							),
					);
					const count = decodeSavedViewCount(result);
					if (Result.isFailure(count)) {
						return yield* unavailable("source-unavailable");
					}
					itemCount = count.success;
				}
				const renderer = prepared.page
					? {
							kind: "page" as const,
							stage: "published" as const,
							writeAccess: false as const,
							pageId: prepared.page.pageId,
							revision: prepared.page.revision,
							definitionHash: prepared.page.definitionHash,
							authorityRevision: prepared.page.authorityRevision,
						}
					: { kind: "kernel" as const, name: "publication" as const };
				return {
					composition: prepared.composition,
					publication: {
						mode,
						ownerName,
						icon: publication.icon,
						title: publication.title,
						publicationId: publication.id,
						revision: publication.revision,
						...(itemCount === undefined ? {} : { itemCount }),
						description: publication.description,
					},
					context: {
						renderer,
						dataSources: null,
						route: { params: {} },
						contributors: prepared.contributors,
						view: { icon: publication.icon, name: publication.title },
						target: { kind: "publication", publicationId: publication.id },
						settings: {
							...found.settings,
							...(itemCount === undefined ? {} : { itemCount }),
							mode,
							ownerName,
							description: publication.description,
						},
					},
				} satisfies PublicationVisitorPage;
			});
			const document = Effect.fn("PublicationVisits.document")(function* (
				principal: PublicationPrincipalValue,
				compositionHash: string,
			) {
				const found = yield* resolve(principal);
				const generated = yield* pages
					.publicationDocument(
						UserId.make(found.publication.userId),
						compositionHash,
						found.publication.definition.page,
						(hash) =>
							Effect.map(
								grants.issue(UserId.make(found.publication.userId), hash, {
									sessionKey: principal.sessionKey,
									revision: found.publication.revision,
									publicationId: principal.publicationId,
								}),
								({ token }) => token,
							),
						found.publication.snapshot?.page,
					)
					.pipe(Effect.catchTag("ClientPagePreparationError", () => Effect.succeed(null)));
				if (!generated) {
					return yield* new PublicationDocumentStale({
						reason: { code: "publication-document-stale" },
					});
				}
				return generated;
			});

			const query = Effect.fn("PublicationVisits.query")(function* (
				principal: PublicationPrincipalValue,
				request: VisitorRequest,
			) {
				const found = yield* resolve(principal);
				const { publication } = found;
				if (!Object.hasOwn(found.document.queries, request.query)) {
					return yield* invalidQuery();
				}
				if (publication.definition.mode === "snapshot") {
					const snapshot = publication.snapshot;
					if (!snapshot) {
						return yield* unavailable("page-unavailable");
					}
					if (
						(request.arguments &&
							Object.entries(request.arguments).some(
								([key, value]) =>
									!Object.hasOwn(snapshot.arguments, key) ||
									stableStringify(value) !== stableStringify(snapshot.arguments[key]),
							)) ||
						request.filter !== undefined ||
						request.sort !== undefined ||
						(request.pages && Object.keys(request.pages).length > 0)
					) {
						return yield* invalidQuery();
					}
					const result = snapshot.result.data[request.query];
					if (!result) {
						return yield* invalidQuery();
					}
					return {
						data: { [request.query]: result },
						...(snapshot.result.execution === undefined
							? {}
							: { execution: snapshot.result.execution }),
					};
				}
				const result = yield* limits.withSessionPermit(
					principal.sessionKey,
					ryotql.executeDeclared(
						{ userId: publication.userId, language: found.owner.preferences.language },
						found.document,
						runtime.request(publication.definition, request),
						PUBLICATION_RESULT_BYTES,
					),
				);
				for (const locator of managedAssetLocators(result)) {
					yield* values.set(
						assetKey(principal, publication.revision, locator),
						"granted",
						Duration.hours(1),
					);
				}
				return result;
			});
			const describe = Effect.fn("PublicationVisits.describe")(function* (
				principal: PublicationPrincipalValue,
				queryName: string,
				argumentsValue?: VisitorRequest["arguments"],
			) {
				const found = yield* resolve(principal);
				if (!Object.hasOwn(found.document.queries, queryName)) {
					return yield* invalidQuery();
				}
				if (found.publication.definition.mode === "snapshot") {
					const snapshot = found.publication.snapshot;
					if (
						!snapshot ||
						(argumentsValue &&
							Object.entries(argumentsValue).some(
								([key, value]) =>
									!Object.hasOwn(snapshot.arguments, key) ||
									stableStringify(value) !== stableStringify(snapshot.arguments[key]),
							))
					) {
						return yield* invalidQuery();
					}
					return { sort: [], filter: [], parameters: found.document.parameters ?? { fields: {} } };
				}
				return yield* limits.withSessionPermit(
					principal.sessionKey,
					ryotql.describeDeclared(
						{ userId: found.publication.userId, language: found.owner.preferences.language },
						found.document,
						queryName,
						{ ...argumentsValue, ...found.publication.definition.arguments },
					),
				);
			});
			const resolveAssets = Effect.fn("PublicationVisits.resolveAssets")(function* (
				principal: PublicationPrincipalValue,
				locators: readonly ManagedAssetLocator[],
			) {
				const found = yield* requireVisible(principal.publicationId, null);
				const stored = new Set(
					managedAssetLocators(found.publication.snapshot?.result).map(
						(locator) => `${locator.type}:${locator.key}`,
					),
				);
				const permitted: ManagedAssetLocator[] = [];
				for (const locator of locators) {
					const allowed =
						found.publication.definition.mode === "snapshot"
							? stored.has(`${locator.type}:${locator.key}`)
							: (yield* values.get(assetKey(principal, found.publication.revision, locator))) ===
								"granted";
					if (allowed) {
						permitted.push(locator);
					}
				}
				return yield* limits
					.withSessionPermit(
						principal.sessionKey,
						assets.resolveDownloads({ id: UserId.make(found.publication.userId) }, permitted),
					)
					.pipe(
						Effect.catchTags({
							BadRequest: () => Effect.succeed([]),
							UploadBadRequest: () => Effect.succeed([]),
						}),
					);
			});

			return { page, query, describe, document, exchange, authenticate, resolveAssets };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
