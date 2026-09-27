import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { HttpServerRequest } from "effect/http";

import { RequestLogUrl } from "./request-log-url";

const resolve = (url: string, method = "GET") =>
	Effect.gen(function* () {
		const service = yield* RequestLogUrl;
		return yield* service.resolve(HttpServerRequest.fromWeb(new Request(url, { method })));
	});

layer(RequestLogUrl.layer)((test) => {
	test.effect("uses route templates for every request method on protected paths", () =>
		Effect.gen(function* () {
			for (const fileName of ["module.js", "chunks/shared.js"]) {
				const url = `http://server.test/api/client-assets/artifact-hash/private-token/${fileName}`;
				expect(yield* resolve(url)).toBe("/api/client-assets/:artifactHash/:accessKey/*");
				expect(yield* resolve(url, "OPTIONS")).toBe(
					"/api/client-assets/:artifactHash/:accessKey/*",
				);
			}
		}),
	);

	test.effect("preserves URLs without route-template logging metadata", () =>
		Effect.gen(function* () {
			expect(yield* resolve("http://server.test/api/system/health?verbose=true")).toBe(
				"/api/system/health?verbose=true",
			);
		}),
	);
});
