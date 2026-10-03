import { expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { stubHttpHost } from "../../tests/backend/imports/source-test-utils";
import { normalizeSourceApiUrl, sourceApiUrl, withSourceRequestOptions } from "./source-api";

it("normalizes source URLs before building API requests", () => {
	expect(normalizeSourceApiUrl(" https://user:secret@example.com/root/?stale=1#hash ")).toBe(
		"https://example.com/root",
	);
	expect(sourceApiUrl("https://example.com/root/", "/items", { page: 2, enabled: true })).toBe(
		"https://example.com/root/items?page=2&enabled=true",
	);
});

it("rejects non-HTTP source URLs", () => {
	expect(() => normalizeSourceApiUrl("file:///tmp/export.json")).toThrow(
		"Import source URL must use http or https",
	);
});

it.live("adds insecure connection opt-in only to requests from the configured source", () =>
	Effect.gen(function* () {
		const options: unknown[] = [];
		const host = stubHttpHost((request) => {
			options.push(request.options);
			return {};
		});

		yield* host.httpCall("GET", "https://secure.example");
		yield* withSourceRequestOptions(host, true).httpCall("GET", "https://insecure.example");

		expect(options).toEqual([undefined, { allowInsecureConnections: true }]);
	}),
);
