import { Effect } from "@ryot/sandbox-sdk/effect";
import { expect, it } from "vitest";

import { normalizeSourceApiUrl, sourceApiUrl, withSourceRequestOptions } from "./source-api";
import { stubHttpHost } from "./source-test-utils";

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

it("adds insecure connection opt-in only to requests from the configured source", async () => {
	const options: unknown[] = [];
	const host = stubHttpHost((request) => {
		options.push(request.options);
		return {};
	});

	await Effect.runPromise(host.httpCall("GET", "https://secure.example"));
	await Effect.runPromise(
		withSourceRequestOptions(host, true).httpCall("GET", "https://insecure.example"),
	);

	expect(options).toEqual([undefined, { allowInsecureConnections: true }]);
});
