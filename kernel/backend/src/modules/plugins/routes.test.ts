import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";

import { pluginArtifactSessionResponse } from "./routes";

it.effect("serves exact session artifact bytes with private security headers", () =>
	Effect.gen(function* () {
		const response = HttpServerResponse.toWeb(
			pluginArtifactSessionResponse({
				contentType: "application/octet-stream",
				contents: new Uint8Array([0, 255, 1]),
			}),
		);

		expect(new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()))).toEqual(
			new Uint8Array([0, 255, 1]),
		);
		expect(response.headers.get("content-type")).toBe("application/octet-stream");
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	}),
);

it("sandboxes HTML artifacts", () => {
	const html = HttpServerResponse.toWeb(
		pluginArtifactSessionResponse({
			contents: new Uint8Array(),
			contentType: "text/html; charset=utf-8",
		}),
	);

	expect(html.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
});
