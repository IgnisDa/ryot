import { expect, it } from "vitest";

import { csvRecordEnds } from "./shared";

it("frames quoted newlines, escaped quotes, CRLF and partial UTF-8 without decoding a partial record", () => {
	const encoder = new TextEncoder();
	const text = 'date,comment\r\n2026-01-01,"a\n""quoted"" 🏋️"\r\n';
	const bytes = encoder.encode(text);
	const first = encoder.encode("date,comment\r\n").length;
	for (let end = first; end < bytes.length - 1; end++) {
		expect(csvRecordEnds(bytes.slice(0, end), false)).toEqual([first]);
	}
	expect(csvRecordEnds(bytes, true)).toEqual([first, bytes.length]);
	expect(() => csvRecordEnds(encoder.encode('date\n"broken'), true)).toThrow("quoted field");
});
