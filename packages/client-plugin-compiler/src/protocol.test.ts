import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
} from "@ryot-app/contract/modules/plugins/client";
import { Effect } from "effect";

import {
	clientCompilerWorkerSuccess,
	decodeClientCompilerWorkerRequest,
	decodeClientCompilerWorkerResponse,
	encodeClientCompilerWorkerRequest,
	encodeClientCompilerWorkerResponse,
} from "./protocol";

it.effect("round trips request and response bytes through canonical Base64", () =>
	Effect.gen(function* () {
		const request = {
			entry: "client/index.tsx",
			apiVersion: CLIENT_API_VERSION,
			files: { "client/index.tsx": new Uint8Array([0x00, 0xff, 0x7f]) },
		};
		const decodedRequest = yield* decodeClientCompilerWorkerRequest(
			encodeClientCompilerWorkerRequest(request),
		);
		expect(decodedRequest).toEqual(request);

		const artifact = {
			format: 1,
			hash: "hash",
			apiVersion: 1,
			compilerVersion: 1,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
			files: [
				{ name: "asset.png", contents: new Uint8Array([0xff, 0x00]), contentType: "image/png" },
			],
		} as const;
		const decodedResponse = yield* decodeClientCompilerWorkerResponse(
			encodeClientCompilerWorkerResponse(clientCompilerWorkerSuccess({ artifact })),
		);
		expect(decodedResponse.success).toBe(true);
		if (decodedResponse.success) {
			expect(decodedResponse.value.artifact).toEqual(artifact);
		}
	}),
);

it.effect("rejects non-canonical and invalid Base64", () =>
	Effect.gen(function* () {
		for (const contents of ["AA", "AA=", "AA===", "A===", "__8=", "Zh==", "////\n"]) {
			const failure = yield* decodeClientCompilerWorkerRequest(
				JSON.stringify({
					contents,
					entry: "client/index.tsx",
					apiVersion: CLIENT_API_VERSION,
					files: { "client/index.tsx": contents },
				}),
			).pipe(Effect.flip);
			expect(String(failure)).toContain("Base64");
		}
	}),
);
