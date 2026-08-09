import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import {
	ClientPageArtifactGrantNotFound,
	PreparedClientPage,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Effect, Schema } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ClientPageArtifactGrantService } from "./grant-service";
import { ClientPagesService } from "./service";

const isCanonicalArtifactFileName = (fileName: string): boolean => {
	if (canonicalRelativePosixPathIssue(fileName) !== null) {
		return false;
	}

	const decoded = fileName.replace(/%([0-9a-f]{2})/gi, (_escape, byte: string) =>
		String.fromCharCode(Number.parseInt(byte, 16)),
	);
	return decoded === fileName || isCanonicalArtifactFileName(decoded);
};

export const ClientPageArtifactsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"clientPageArtifacts",
	(handlers) =>
		handlers.handleRaw("file", ({ params }) =>
			Effect.gen(function* () {
				if (!isCanonicalArtifactFileName(params["*"])) {
					return yield* new ClientPageArtifactGrantNotFound({
						reason: { code: "artifact-grant-not-found" },
					});
				}
				const grants = yield* ClientPageArtifactGrantService;
				const file = yield* grants.findFile(params.token, params["*"]).pipe(dieOnDbError);
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
