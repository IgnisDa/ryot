import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { describe, expect, it } from "vitest";

import { normalizeRichDescription } from "./rich-description";

describe("rich descriptions", () => {
	it("normalizes provider HTML and resolves relative links", () => {
		expect(
			Effect.runSync(
				normalizeRichDescription(
					'<p>A <strong>story</strong> with <a href="/work">details</a>.</p>',
					"https://example.org/catalog/",
				),
			),
		).toBe("A **story** with [details](https://example.org/work).");
	});

	it("keeps labels when unsafe links are removed", () => {
		expect(
			Effect.runSync(normalizeRichDescription('<a href="javascript:alert(1)">Read this</a>')),
		).toBe("Read this");
	});

	it.each([undefined, null, 42, {}, "", " \n\t ", "<p></p>", "<script>hidden</script>"])(
		"returns null for absent or empty normalized prose: %j",
		(input) => {
			expect(Effect.runSync(normalizeRichDescription(input))).toBeNull();
		},
	);
});
