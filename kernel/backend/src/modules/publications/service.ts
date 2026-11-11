import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	type CreatePublicationBody,
	type CreatePublicationLinkBody,
	PUBLICATION_SUBJECT_LIMIT,
	PublicationBadRequest,
	PublicationNotFound,
	PublicationsDisabled,
	type PublicationSource,
	type PublicationStatusResponse,
	type RepublishPublicationBody,
} from "@ryot-app/contract/modules/publications/schemas";
import type { PublicationId, PublicationLinkId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Clock, Context, DateTime, Effect, Layer } from "effect";

import { RyotQLService } from "#modules/ryotql/service";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";
import { generateOpaqueTicket } from "#platform/http/opaque-tickets";
import { trimToNull } from "#platform/validation";

import { PublicationsRepository } from "./repository";
import { PublicationSessions } from "./sessions";

type OwnerUser = Pick<CurrentUserValue, "id" | "preferences">;

const notFound = (publicationId: PublicationId) =>
	new PublicationNotFound({ reason: { publicationId, code: "publication-not-found" } });

export class PublicationsService extends Context.Service<PublicationsService>()(
	"@ryot-app/kernel-backend/modules/publications/service/PublicationsService",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const ryotql = yield* RyotQLService;
			const session = yield* DatabaseSession;
			const sessions = yield* PublicationSessions;
			const repository = yield* PublicationsRepository;

			const requireEnabled = config.server.disablePublications
				? Effect.fail(new PublicationsDisabled({ reason: { code: "publications-disabled" } }))
				: Effect.void;

			const write = <A, E, R>(user: OwnerUser, work: Effect.Effect<A, E, R>) =>
				session
					.transaction(Effect.andThen(session.acquireUserWriteLock(user.id), work))
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));

			const evaluate = Effect.fn("Publications.evaluate")(function* (
				user: OwnerUser,
				source: PublicationSource,
			) {
				return yield* ryotql
					.resolvePublicationSubjects({
						source,
						ownerUserId: user.id,
						language: user.preferences.language,
						subjectLimit: PUBLICATION_SUBJECT_LIMIT,
					})
					.pipe(
						Effect.map((subjects): PublicationStatusResponse => ({
							status: "ready",
							itemCount: subjects.length,
						})),
						Effect.catchTags({
							RyotQLInternalError: () =>
								Effect.succeed<PublicationStatusResponse>({ status: "source-unavailable" }),
							RyotQLBadRequest: (error) =>
								Effect.succeed<PublicationStatusResponse>(
									error.reason.code === "subject-limit-exceeded"
										? { status: "too-large", limit: error.reason.limit }
										: { status: "source-unavailable" },
								),
						}),
					);
			});

			const prepareDetails = Effect.fn("Publications.prepareDetails")(function* (
				user: OwnerUser,
				body: CreatePublicationBody,
			) {
				const title = trimToNull(body.title);
				if (!title) {
					return yield* new PublicationBadRequest({
						reason: { field: "title", code: "required-field" },
					});
				}
				const icon = trimToNull(body.icon);
				if (!icon) {
					return yield* new PublicationBadRequest({
						reason: { field: "icon", code: "required-field" },
					});
				}
				const status = yield* evaluate(user, body.source);
				if (status.status === "source-unavailable") {
					return yield* new PublicationBadRequest({ reason: { code: "source-unavailable" } });
				}
				if (status.status === "too-large") {
					return yield* new PublicationBadRequest({
						reason: { limit: status.limit, code: "scope-too-large" },
					});
				}
				return {
					icon,
					title,
					source: body.source,
					showOwnerName: body.showOwnerName,
					description: trimToNull(body.description ?? ""),
				};
			});

			const requireOwned = Effect.fn("Publications.requireOwned")(function* (
				user: OwnerUser,
				publicationId: PublicationId,
			) {
				return (
					(yield* repository.findOwned(user.id, publicationId)) ?? (yield* notFound(publicationId))
				);
			});

			const requireActive = Effect.fn("Publications.requireActive")(function* (
				user: OwnerUser,
				publicationId: PublicationId,
			) {
				const owned = yield* requireOwned(user, publicationId);
				if (owned.revokedAt !== null) {
					return yield* new PublicationBadRequest({ reason: { code: "publication-revoked" } });
				}
				return owned;
			});

			const create = Effect.fn("Publications.create")(function* (
				user: OwnerUser,
				body: CreatePublicationBody,
			) {
				yield* requireEnabled;
				const details = yield* prepareDetails(user, body);
				const created = yield* write(user, repository.insert(user.id, details));
				return { publicationId: created.id, revision: created.revision };
			});

			const republish = Effect.fn("Publications.republish")(function* (
				user: OwnerUser,
				body: RepublishPublicationBody,
			) {
				yield* requireEnabled;
				yield* requireActive(user, body.publicationId);
				const details = yield* prepareDetails(user, body);
				const updated = yield* write(
					user,
					repository.republish(user.id, body.publicationId, details),
				);
				if (!updated) {
					return yield* new PublicationBadRequest({ reason: { code: "publication-revoked" } });
				}
				return { publicationId: updated.id, revision: updated.revision };
			});

			const revoke = Effect.fn("Publications.revoke")(function* (
				user: OwnerUser,
				publicationId: PublicationId,
			) {
				yield* write(user, repository.revoke(user.id, publicationId)).pipe(
					Effect.filterOrFail(Boolean, () => notFound(publicationId)),
				);
			});

			const remove = Effect.fn("Publications.remove")(function* (
				user: OwnerUser,
				publicationId: PublicationId,
			) {
				yield* write(user, repository.remove(user.id, publicationId)).pipe(
					Effect.filterOrFail(Boolean, () => notFound(publicationId)),
				);
			});

			const createLink = Effect.fn("Publications.createLink")(function* (
				user: OwnerUser,
				body: CreatePublicationLinkBody,
			) {
				yield* requireEnabled;
				yield* requireActive(user, body.publicationId);
				const label = trimToNull(body.label);
				if (!label) {
					return yield* new PublicationBadRequest({
						reason: { field: "label", code: "required-field" },
					});
				}
				const now = yield* Clock.currentTimeMillis;
				const expiresAt =
					body.expiresAt === null ? null : DateTime.toDate(DateTime.makeUnsafe(body.expiresAt));
				if (expiresAt !== null && expiresAt.getTime() <= now) {
					return yield* new PublicationBadRequest({ reason: { code: "expiry-in-past" } });
				}
				const secret = generateOpaqueTicket();
				const linkId = yield* write(
					user,
					repository.insertLink({
						label,
						expiresAt,
						tokenHash: sha256Hex(secret),
						publicationId: body.publicationId,
					}),
				);
				return { linkId, secret };
			});

			const revokeLink = Effect.fn("Publications.revokeLink")(function* (
				user: OwnerUser,
				linkId: PublicationLinkId,
			) {
				yield* write(user, repository.revokeLink(user.id, linkId)).pipe(
					Effect.filterOrFail(
						Boolean,
						() => new PublicationNotFound({ reason: { linkId, code: "link-not-found" } }),
					),
				);
			});

			const status = Effect.fn("Publications.status")(function* (
				user: OwnerUser,
				publicationId: PublicationId,
			) {
				const owned = yield* requireOwned(user, publicationId);
				return yield* evaluate(user, owned.source);
			});

			const preview = Effect.fn("Publications.preview")(function* (
				user: OwnerUser,
				publicationId: PublicationId,
			) {
				yield* requireEnabled;
				yield* requireActive(user, publicationId);
				return yield* sessions.start({ linkId: null, publicationId, linkExpiresAt: null });
			});

			return { create, revoke, remove, status, preview, republish, createLink, revokeLink };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
