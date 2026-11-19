import { PublicationId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect, Layer, Schema } from "effect";

import { ClientArtifactGrantAuthority } from "#modules/pages/bundles/grant-authority";
import { AppConfig } from "#platform/config/service";

import { PublicationsRepository } from "./repository";
import { PublicationSessions } from "./sessions";

const Scope = Schema.Struct({
	revision: Schema.Int,
	sessionKey: Schema.String,
	publicationId: PublicationId,
});

export const PublicationArtifactAuthorityLive = Layer.effect(
	ClientArtifactGrantAuthority,
	Effect.gen(function* () {
		const repository = yield* PublicationsRepository;
		const sessions = yield* PublicationSessions;
		const config = yield* AppConfig;
		return {
			validate: Effect.fn("PublicationArtifactAuthority.validate")(function* (scope) {
				if (config.server.disablePublications) {
					return false;
				}
				const decoded = yield* Schema.decodeUnknownEffect(Scope)(scope).pipe(
					Effect.orElseSucceed(() => null),
				);
				if (!decoded) {
					return false;
				}
				const session = yield* sessions.findKey(decoded.sessionKey);
				if (!session || session.publicationId !== decoded.publicationId) {
					return false;
				}
				const found = yield* repository.findForVisit(decoded.publicationId);
				if (
					!found ||
					found.publication.revision !== decoded.revision ||
					found.publication.revokedAt !== null ||
					found.owner.disabledAt !== null
				) {
					return false;
				}
				if (session.linkId === null) {
					return true;
				}
				const link = yield* repository.findLink(session.linkId);
				const now = yield* Clock.currentTimeMillis;
				return (
					link !== null &&
					link.publicationId === decoded.publicationId &&
					link.revokedAt === null &&
					(link.expiresAt === null || link.expiresAt.getTime() > now)
				);
			}),
		} satisfies ClientArtifactGrantAuthority["Service"];
	}),
);
