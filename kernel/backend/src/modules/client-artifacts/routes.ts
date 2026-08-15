import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { ClientAssetNotFound } from "@ryot-app/contract/modules/client-pages/schemas";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ClientArtifactGrantService } from "./grant-service";
import { ClientArtifactStore } from "./store";
import { canonicalClientArtifactFileName, CLIENT_ARTIFACT_HASH_PATTERN } from "./url";

const missing = () => new ClientAssetNotFound({ reason: { code: "client-asset-not-found" } });
export const serveClientAsset = Effect.fn("serveClientAsset")(function* (input: {
	readonly artifactHash: string;
	readonly accessKey: string;
	readonly fileName: string;
}) {
	const fileName = canonicalClientArtifactFileName(input.fileName);
	if (!CLIENT_ARTIFACT_HASH_PATTERN.test(input.artifactHash) || fileName === null) {
		return yield* missing();
	}
	const store = yield* ClientArtifactStore;
	if (input.accessKey === "public") {
		if (!store.isPublic(input.artifactHash)) {
			return yield* missing();
		}
	} else {
		const grant = yield* (yield* ClientArtifactGrantService).resolve(input.accessKey);
		if (!grant || grant.artifactHash !== input.artifactHash) {
			return yield* missing();
		}
	}
	const file = yield* store.findFile(input.artifactHash, fileName);
	if (!file) {
		return yield* missing();
	}
	return HttpServerResponse.uint8Array(file.contents, {
		contentType: file.contentType,
		headers: {
			"referrer-policy": "no-referrer",
			"access-control-allow-origin": "*",
			"x-content-type-options": "nosniff",
			"cross-origin-resource-policy": "cross-origin",
			"cache-control": `${input.accessKey === "public" ? "public" : "private"}, max-age=31536000, immutable`,
		},
	});
});

export const ClientAssetsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"clientAssets",
	(handlers) =>
		handlers.handleRaw("file", ({ params }) =>
			serveClientAsset({
				fileName: params["*"],
				accessKey: params.accessKey,
				artifactHash: params.artifactHash,
			}).pipe(dieOnDbError),
		),
);
