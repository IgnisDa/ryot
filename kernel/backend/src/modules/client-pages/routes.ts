import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { Effect, Schema } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ClientPageArtifactGrantService } from "./grant-service";
import { ClientPagesService } from "./service";

export const ClientPageArtifactsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"clientPageArtifacts",
	(handlers) =>
		handlers.handleRaw("file", ({ params }) =>
			Effect.gen(function* () {
				const grants = yield* ClientPageArtifactGrantService;
				const file = yield* grants.findFile(params.token, params.fileName).pipe(dieOnDbError);
				return HttpServerResponse.uint8Array(file.contents, {
					contentType: file.contentType,
					headers: {
						"referrer-policy": "no-referrer",
						"access-control-allow-origin": "*",
						"x-content-type-options": "nosniff",
						"cache-control": "private, max-age=31536000, immutable",
						...(file.contentType.startsWith("text/html")
							? { "content-security-policy": "sandbox allow-scripts" }
							: {}),
					},
				});
			}),
		),
);

export const ClientPagesRoutesLive = HttpApiBuilder.group(AppContract, "clientPages", (handlers) =>
	handlers
		.handle("createRenderer", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* (yield* ClientPagesService).createRenderer(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("replaceRendererDraft", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* (yield* ClientPagesService)
					.replaceDraft(user, params.rendererId, payload)
					.pipe(dieOnDbError);
			}),
		)
		.handle("publishRenderer", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* (yield* ClientPagesService)
					.publish(user, params.rendererId, payload.expectedDraftRevision)
					.pipe(dieOnDbError);
			}),
		)
		.handle("deleteRenderer", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* (yield* ClientPagesService)
					.deleteRenderer(user, params.rendererId)
					.pipe(dieOnDbError);
			}),
		)
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
							Effect.catchTags({
								ClientRendererBadRequest: () => Effect.succeed(false),
								ClientPagePreparationError: () => Effect.succeed(false),
							}),
							dieOnDbError,
						),
				};
			}),
		),
);
