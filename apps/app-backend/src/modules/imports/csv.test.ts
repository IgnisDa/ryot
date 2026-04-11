import { describe, expect, it } from "bun:test";

import { parseCsvText } from "./csv";

describe("parseCsvText", () => {
	it("returns empty headers and rows for empty input", () => {
		const { headers, rows } = parseCsvText("");
		expect(headers).toEqual([]);
		expect(rows).toEqual([]);
	});

	it("normalizes CRLF line endings before parsing", () => {
		const csv = "A,B\r\n1,2\r\n3,4\r\n";
		const { headers, rows } = parseCsvText(csv);

		expect(headers).toEqual(["A", "B"]);
		expect(rows.length).toBe(2);
	});

	it("normalizes CRLF inside a quoted field to LF", () => {
		const csv = 'Date,Notes\r\n2026-01-01,"Line one\r\nLine two"\r\n2026-01-02,plain\r\n';
		const { headers, rows } = parseCsvText(csv);

		expect(headers).toEqual(["Date", "Notes"]);
		expect(rows.length).toBe(2);
		expect(rows[0]).toEqual({ Date: "2026-01-01", Notes: "Line one\nLine two" });
		expect(rows[1]).toEqual({ Date: "2026-01-02", Notes: "plain" });
	});
});
