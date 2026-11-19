import { describe, expect, it } from "bun:test";

import { referenceDiagnostics, scanMessageReferences } from "./references";

describe("message reference scan", () => {
	it("counts literal keys as used and reports builder calls with unknown keys", () => {
		const scan = scanMessageReferences({
			builders: ["kernelMessage"],
			keys: new Set(["item.used", "item.mapped", "item.unused"]),
			files: [
				{ path: "a.ts", content: 'kernelMessage("item.used");\nconst x = `item.mapped`;' },
				{ path: "b.ts", content: "\n\nkernelMessage('item.missing', { n: 1 });" },
				{ path: "c.json", content: '{ "label": "item.used" }' },
			],
		});
		expect([...scan.referenced].sort()).toEqual(["item.mapped", "item.used"]);
		expect(scan.unknown).toEqual([{ line: 3, file: "b.ts", key: "item.missing" }]);
		expect(
			referenceDiagnostics({
				scan,
				catalogPath: "en.json",
				keys: ["item.used", "item.mapped", "item.unused"],
			}).map(({ key, code, file }) => [code, file, key]),
		).toEqual([
			["unknown-key", "b.ts:3", "item.missing"],
			["unused-key", "en.json", "item.unused"],
		]);
	});
});
