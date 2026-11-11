import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import {
	PublicationMiddleware,
	PublicationPrincipal,
} from "@ryot-app/contract/modules/publications/contract";
import { Effect, Layer, Redacted } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { requestClientAddress } from "#modules/accounts/auth/client-address";

import { PublicationsService } from "./service";
import { PublicationVisitsService } from "./visits";

export const PublicationsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"publications",
	(handlers) =>
		handlers
			.handle("create", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* PublicationsService;
					return yield* service.create(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("republish", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* PublicationsService;
					return yield* service.republish(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("revoke", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* PublicationsService;
					return yield* service.revoke(user, payload.publicationId).pipe(dieOnDbError);
				}),
			)
			.handle("delete", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* PublicationsService;
					return yield* service.remove(user, payload.publicationId).pipe(dieOnDbError);
				}),
			)
			.handle("createLink", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* PublicationsService;
					return yield* service.createLink(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("revokeLink", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* PublicationsService;
					return yield* service.revokeLink(user, payload.linkId).pipe(dieOnDbError);
				}),
			)
			.handle("status", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* PublicationsService;
					return yield* service.status(user, payload.publicationId).pipe(dieOnDbError);
				}),
			)
			.handle("preview", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* PublicationsService;
					return yield* service.preview(user, payload.publicationId).pipe(dieOnDbError);
				}),
			),
);

export const PublicationVisitsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"publicationVisits",
	(handlers) =>
		handlers
			.handle("exchange", ({ payload }) =>
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest;
					const visits = yield* PublicationVisitsService;
					return yield* visits
						.exchange({
							secret: payload.secret,
							publicationId: payload.publicationId,
							visitorAddress: requestClientAddress(new Headers(request.headers)),
						})
						.pipe(dieOnDbError);
				}),
			)
			.handle("page", () =>
				Effect.gen(function* () {
					const principal = yield* PublicationPrincipal;
					const visits = yield* PublicationVisitsService;
					return yield* visits.page(principal).pipe(dieOnDbError);
				}),
			)
			.handle("document", ({ payload }) =>
				Effect.gen(function* () {
					const principal = yield* PublicationPrincipal;
					const visits = yield* PublicationVisitsService;
					return yield* visits.document(principal, payload.compositionHash).pipe(dieOnDbError);
				}),
			)
			.handle("describe", ({ payload }) =>
				Effect.gen(function* () {
					const principal = yield* PublicationPrincipal;
					const visits = yield* PublicationVisitsService;
					return yield* visits
						.describe(principal, payload.source, payload.arguments)
						.pipe(dieOnDbError);
				}),
			)
			.handle("ryotql", ({ payload }) =>
				Effect.gen(function* () {
					const principal = yield* PublicationPrincipal;
					const visits = yield* PublicationVisitsService;
					return yield* visits.query(principal, payload).pipe(dieOnDbError);
				}),
			)
			.handle("assets", ({ payload }) =>
				Effect.gen(function* () {
					const principal = yield* PublicationPrincipal;
					const visits = yield* PublicationVisitsService;
					return yield* visits.resolveAssets(principal, payload.assets).pipe(dieOnDbError);
				}),
			),
);

export const PublicationMiddlewareLive = Layer.effect(
	PublicationMiddleware,
	Effect.gen(function* () {
		const visits = yield* PublicationVisitsService;
		return {
			session: (httpEffect, { credential }) =>
				visits.authenticate(Redacted.value(credential)).pipe(
					dieOnDbError,
					Effect.flatMap((principal) =>
						Effect.provideService(httpEffect, PublicationPrincipal, principal),
					),
				),
		} satisfies PublicationMiddleware["Service"];
	}),
);
