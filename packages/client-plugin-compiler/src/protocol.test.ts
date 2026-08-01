import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
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
			name: "Fixture plugin",
			entry: "client/index.tsx",
			pluginDependencies: ["media"],
			apiVersion: CLIENT_API_VERSION,
			files: { "client/index.tsx": new Uint8Array([0x00, 0xff, 0x7f]) },
			publicExports: { summary: { entry: "client/summary.tsx", kind: "component" as const } },
		};
		const decodedRequest = yield* decodeClientCompilerWorkerRequest(
			encodeClientCompilerWorkerRequest(request),
		);
		expect(decodedRequest).toEqual(request);

		const artifact = {
			format: 1,
			hash: "hash",
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
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
					name: "Fixture plugin",
					entry: "client/index.tsx",
					apiVersion: CLIENT_API_VERSION,
					files: { "client/index.tsx": contents },
				}),
			).pipe(Effect.flip);
			expect(String(failure)).toContain("Base64");
		}
	}),
);

it.effect("round trips namespaced contributor graphs and authorized exports", () =>
	Effect.gen(function* () {
		const request = {
			name: "Composed page",
			automaticRegistry: [],
			application: "page" as const,
			apiVersion: CLIENT_API_VERSION,
			contributorOrder: ["user-id", "plugin-id"],
			entry: { contributor: "user-id", path: "client/page.tsx" },
			contributors: {
				"user-id": { files: { "client/page.tsx": new Uint8Array([0xff, 0x00]) } },
				"plugin-id": { files: { "client/card.tsx": new Uint8Array([0x01, 0x02]) } },
			},
			publicExports: {
				"@ryot-app/plugins/media/card": {
					entry: "client/card.tsx",
					contributor: "plugin-id",
					kind: "component" as const,
				},
			},
		};
		const decoded = yield* decodeClientCompilerWorkerRequest(
			encodeClientCompilerWorkerRequest(request),
		);
		expect(decoded).toEqual(request);
	}),
);

it.effect("round trips a generated plugin route registry", () =>
	Effect.gen(function* () {
		const request = {
			publicExports: {},
			name: "Fixture routes",
			contributorOrder: ["fixture"],
			apiVersion: CLIENT_API_VERSION,
			application: "plugin-route" as const,
			entry: { contributor: "fixture", path: "client/home.tsx" },
			contributors: { fixture: { files: { "client/home.tsx": new Uint8Array([0x01]) } } },
			routeRegistry: {
				home: "@ryot-app/plugins/fixture/home",
				notFound: "@ryot-app/plugins/fixture/not-found",
				routes: [
					{ path: "/details/$itemId", exportSpecifier: "@ryot-app/plugins/fixture/details" },
				],
			},
		};
		const decoded = yield* decodeClientCompilerWorkerRequest(
			encodeClientCompilerWorkerRequest(request),
		);
		expect(decoded).toEqual(request);
	}),
);
