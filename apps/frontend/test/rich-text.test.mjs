import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeRichText } from "../app/lib/shared/sanitize-rich-text.ts";

describe("Rich text sanitization", () => {
	it("preserves formatting and safe links and images", () => {
		const html =
			'<p><strong>Overview</strong> <a href="/media">Media</a><img src="https://example.com/image.png" alt="Cover" /></p>';
		assert.equal(sanitizeRichText(html), html);
	});

	it("drops disallowed elements, attributes, and URL schemes", () => {
		const html =
			'<p id="overview" onclick="">Overview</p><script></script><svg></svg><a href="ftp://example.com/">Link</a>';
		assert.equal(sanitizeRichText(html), "<p>Overview</p><a>Link</a>");
	});
});
