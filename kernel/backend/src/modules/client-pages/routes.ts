import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import {
	ClientDocumentGrantNotFound,
	PreparedClientPage,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { Effect, Schema } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { generateClientDocument } from "./document";
import { ClientDocumentGrantService } from "./grant-service";
import { ClientPagesRepository } from "./repository";
import { ClientPagesService } from "./service";

export const ClientDocumentsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"clientDocuments",
	(handlers) =>
		handlers.handleRaw("document", ({ params }) =>
			Effect.gen(function* () {
				const { userId, compositionHash } = yield* (yield* ClientDocumentGrantService).resolve(
					params.token,
				);
				const composition = yield* (yield* ClientPagesRepository)
					.findCompositionByHash(compositionHash)
					.pipe(dieOnDbError);
				if (!composition) {
					return yield* new ClientDocumentGrantNotFound({
						reason: { code: "document-grant-not-found" },
					});
				}
				const html = yield* generateClientDocument(
					userId,
					composition.compositionHash,
					composition.manifest,
				).pipe(dieOnDbError);
				return HttpServerResponse.text(html, {
					contentType: "text/html; charset=utf-8",
					headers: {
						"referrer-policy": "no-referrer",
						"x-content-type-options": "nosniff",
						"cache-control": "private, no-store",
						"content-security-policy": "sandbox allow-scripts",
					},
				});
			}),
		),
);

export const ClientPagesRoutesLive = HttpApiBuilder.group(AppContract, "clientPages", (handlers) =>
	handlers
		.handle("prepare", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const prepared = yield* (yield* ClientPagesService)
					.prepare(user, payload.target)
					.pipe(dieOnDbError);
				return yield* Schema.decodeUnknownEffect(PreparedClientPage)(prepared).pipe(Effect.orDie);
			}),
		)
		.handle("checkFreshness", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return {
					current: yield* (yield* ClientPagesService)
						.isIdentityCurrent(user.id, payload.identity)
						.pipe(
							Effect.catchTags({ ClientPagePreparationError: () => Effect.succeed(false) }),
							dieOnDbError,
						),
				};
			}),
		),
);
