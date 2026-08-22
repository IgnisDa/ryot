import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ClientPagesService } from "./service";
import { ClientPageSessionService } from "./session-service";

export const ClientPageArtifactsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"clientPageArtifacts",
	(handlers) =>
		handlers.handleRaw("file", ({ params }) =>
			Effect.gen(function* () {
				const sessions = yield* ClientPageSessionService;
				const file = yield* sessions.findFile(params.token, params.fileName).pipe(dieOnDbError);
				return HttpServerResponse.uint8Array(file.contents, {
					contentType: file.contentType,
					headers: {
						"cache-control": "no-store",
						"referrer-policy": "no-referrer",
						"access-control-allow-origin": "*",
						"x-content-type-options": "nosniff",
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
		.handle("listRenderers", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return (yield* (yield* ClientPagesService).listRenderers(user.id).pipe(dieOnDbError)).map(
					({ draftDefinition: _, publishedDefinition: __, ...metadata }) => metadata,
				);
			}),
		)
		.handle("getRenderer", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* (yield* ClientPagesService)
					.getRenderer(user.id, params.rendererId)
					.pipe(dieOnDbError);
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
				return yield* (yield* ClientPagesService)
					.prepare(user, payload.target.savedViewId)
					.pipe(dieOnDbError);
			}),
		)
		.handle("createSession", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* (yield* ClientPageSessionService)
					.create(user.id, payload.identity)
					.pipe(dieOnDbError);
			}),
		)
		.handle("renewSession", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* (yield* ClientPageSessionService)
					.renew(user.id, params.sessionId)
					.pipe(dieOnDbError);
			}),
		)
		.handle("revokeSession", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				yield* (yield* ClientPageSessionService)
					.revoke(user.id, params.sessionId)
					.pipe(dieOnDbError);
			}),
		),
);
