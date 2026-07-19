import { describe, expect, it } from "~/support/effect-test";

import { parseCommand } from "./cli";

describe("parseCommand", () => {
	it("makes a drill a dry run", () => {
		expect(
			parseCommand(["watchdog", "--project", "p", "--trigger-file", "t.jsonl", "--drill"]),
		).toMatchObject({ drill: true, dryRun: true, kind: "watchdog", healthPort: 8_000 });
	});

	it("applies service overrides per role and rejects unknown roles", () => {
		expect(parseCommand(["metadata", "--project", "p", "--service", "postgres=db"])).toMatchObject({
			services: { ryot: "ryot", postgres: "db", redis: "ryot-redis", otel: "otel-collector" },
		});
		expect(() => parseCommand(["metadata", "--project", "p", "--service", "web=ryot"])).toThrow(
			"invalid --service 'web=ryot'",
		);
	});

	it("requires the sample output file", () => {
		expect(() => parseCommand(["sample", "--project", "p"])).toThrow("sample requires --output");
	});
});
