import { describe, expect, it } from "~/support/effect-test";

import { boundJournal, JOURNAL_MAX_LINES } from "./journal";
import { decodeHostLines } from "./samples";

describe("decodeHostLines", () => {
	it("decodes known records and counts malformed or truncated lines", () => {
		const heartbeat = JSON.stringify({
			timestampMs: 1,
			evaluations: 60,
			ryotContainerId: null,
			kind: "watchdog-heartbeat",
			conditionStates: {
				hostOomKill: false,
				ryotOomKill: false,
				healthFailing: true,
				memAvailableLow: false,
				memoryPsiFullHigh: false,
				ryotMemoryCurrentHigh: false,
			},
		});
		const result = decodeHostLines(
			`${heartbeat}\n{"kind":"sample","timestampMs":2}\n\n{"kind":"watchdog-heart`,
		);

		expect(result.lines.map(({ kind }) => kind)).toEqual(["watchdog-heartbeat"]);
		expect(result.undecodable).toBe(2);
	});
});

describe("boundJournal", () => {
	it("drops journalctl banners and keeps the earliest lines up to the line cap", () => {
		const output = [
			"-- No entries --",
			...Array.from(
				{ length: JOURNAL_MAX_LINES + 5 },
				(_unused, index) => `2026-09-19T05:00:${index}+0000 vm kernel: warning ${index}`,
			),
		].join("\n");
		const bounded = boundJournal(output);

		expect(bounded.lineCount).toBe(JOURNAL_MAX_LINES + 5);
		expect(bounded.lines).toHaveLength(JOURNAL_MAX_LINES);
		expect(bounded.lines[0]).toContain("warning 0");
		expect(bounded.truncated).toBe(true);
	});

	it("stops before exceeding the byte cap", () => {
		const bounded = boundJournal(Array.from({ length: 3 }, () => "x".repeat(30_000)).join("\n"));
		expect(bounded.lines).toHaveLength(2);
		expect(bounded.truncated).toBe(true);
	});
});
