import { describe, expect, it } from "bun:test";

import { parseCsvText } from "./csv";

describe("parseCsvText", () => {
	it("parses a simple CSV with headers and rows", () => {
		const csv = "Date,Weight,Comment\n2026-01-01,75.0,First\n2026-01-02,75.5,";
		const { headers, rows } = parseCsvText(csv);

		expect(headers).toEqual(["Date", "Weight", "Comment"]);
		expect(rows.length).toBe(2);
		expect(rows[0]).toEqual({ Date: "2026-01-01", Weight: "75.0", Comment: "First" });
		expect(rows[1]).toEqual({ Date: "2026-01-02", Weight: "75.5", Comment: "" });
	});

	it("handles quoted fields containing commas", () => {
		const csv = `Name,Value\n"Smith, John",42\n`;
		const { headers, rows } = parseCsvText(csv);

		expect(headers).toEqual(["Name", "Value"]);
		expect(rows[0]).toEqual({ Name: "Smith, John", Value: "42" });
	});

	it("detects semicolon-delimited CSV", () => {
		const csv = "Name;Value\nBench Press;42\n";
		const { headers, rows } = parseCsvText(csv);

		expect(headers).toEqual(["Name", "Value"]);
		expect(rows[0]).toEqual({ Name: "Bench Press", Value: "42" });
	});

	it("handles CRLF line endings", () => {
		const csv = "A,B\r\n1,2\r\n3,4\r\n";
		const { headers, rows } = parseCsvText(csv);

		expect(headers).toEqual(["A", "B"]);
		expect(rows.length).toBe(2);
	});

	it("returns empty headers and rows for empty input", () => {
		const { headers, rows } = parseCsvText("");
		expect(headers).toEqual([]);
		expect(rows).toEqual([]);
	});

	it("preserves a quoted field containing an embedded newline as a single value", () => {
		const csv = `Date,Notes,Weight\n2026-01-01,"Felt great\npushed hard",75.0\n2026-01-02,,74.5\n`;
		const { headers, rows } = parseCsvText(csv);

		expect(headers).toEqual(["Date", "Notes", "Weight"]);
		expect(rows.length).toBe(2);
		expect(rows[0]).toEqual({
			Date: "2026-01-01",
			Notes: "Felt great\npushed hard",
			Weight: "75.0",
		});
		expect(rows[1]).toEqual({ Date: "2026-01-02", Notes: "", Weight: "74.5" });
	});

	it("preserves a quoted field containing an embedded CRLF as a single value", () => {
		const csv = 'Date,Notes\r\n2026-01-01,"Line one\r\nLine two"\r\n2026-01-02,plain\r\n';
		const { headers, rows } = parseCsvText(csv);

		expect(headers).toEqual(["Date", "Notes"]);
		expect(rows.length).toBe(2);
		expect(rows[0]).toEqual({ Date: "2026-01-01", Notes: "Line one\nLine two" });
		expect(rows[1]).toEqual({ Date: "2026-01-02", Notes: "plain" });
	});

	it("does not confuse a semicolon inside a quoted header with the delimiter", () => {
		const csv = `"Name;Full",Value\n"Alice;Bob",42\n`;
		const { headers, rows } = parseCsvText(csv);

		expect(headers).toEqual(["Name;Full", "Value"]);
		expect(rows[0]).toEqual({ "Name;Full": "Alice;Bob", Value: "42" });
	});
});
