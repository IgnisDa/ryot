import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";

import { pluginArtifactResponse } from "./routes";

it.effect("serves exact artifact bytes with immutable security headers", () =>
	Effect.gen(function* () {
		const response = HttpServerResponse.toWeb(
			pluginArtifactResponse({
				contents: new Uint8Array([0, 255, 1]),
				contentType: "application/octet-stream",
			}),
		);

		expect(new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()))).toEqual(
			new Uint8Array([0, 255, 1]),
		);
		expect(response.headers.get("content-type")).toBe("application/octet-stream");
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
	}),
);

it("sandboxes HTML artifacts and returns 404 for missing files", () => {
	const html = HttpServerResponse.toWeb(
		pluginArtifactResponse({
			contents: new Uint8Array(),
			contentType: "text/html; charset=utf-8",
		}),
	);
	const missing = HttpServerResponse.toWeb(pluginArtifactResponse(null));

	expect(html.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
	expect(missing.status).toBe(404);
});
