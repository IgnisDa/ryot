import { describe, expect, it } from "vitest";
import { sanitizeRichText } from "../../../apps/frontend/app/lib/shared/sanitize-rich-text";

describe("Rich text sanitization", () => {
	it("preserves formatting and safe links and images", () => {
		const html =
			'<p><strong>Overview</strong> <a href="/media">Media</a><img src="https://example.com/image.png" alt="Cover" /></p>';
		expect(sanitizeRichText(html)).toBe(html);
	});

	it("drops disallowed elements, attributes, and URL schemes", () => {
		const html =
			'<p id="overview" onclick="">Overview</p><script></script><svg></svg><a href="ftp://example.com/">Link</a>';
		expect(sanitizeRichText(html)).toBe("<p>Overview</p><a>Link</a>");
	});
});
