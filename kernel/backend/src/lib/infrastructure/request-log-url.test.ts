import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

import { RequestLogUrl } from "./request-log-url";

const resolve = (url: string, method = "GET") =>
	Effect.gen(function* () {
		const service = yield* RequestLogUrl;
		return yield* service.resolve(HttpServerRequest.fromWeb(new Request(url, { method })));
	}).pipe(Effect.provide(RequestLogUrl.layer));

it.effect("uses route templates for every request method on protected paths", () =>
	Effect.gen(function* () {
		const url = "http://server.test/api/client-pages/artifacts/private-token/index.html";
		expect(yield* resolve(url)).toBe("/api/client-pages/artifacts/:token/:fileName");
		expect(yield* resolve(url, "OPTIONS")).toBe("/api/client-pages/artifacts/:token/:fileName");
	}),
);

it.effect("preserves URLs without route-template logging metadata", () =>
	Effect.gen(function* () {
		expect(yield* resolve("http://server.test/api/system/health?verbose=true")).toBe(
			"/api/system/health?verbose=true",
		);
	}),
);
