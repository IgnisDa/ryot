import { describe, expect, it } from "~/support/effect-test";

import { retentionClassification, retentionSlopes } from "./retention";

const MiB = 1_048_576;

describe("retentionSlopes", () => {
	it("fits growth per hundred operations across every recovery checkpoint", () => {
		const slopes = retentionSlopes([
			{ operations: 20, values: { "post.bunRssBytes": 400 * MiB, "post.bunHeapUsedBytes": null } },
			{ operations: 40, values: { "post.bunRssBytes": 410 * MiB } },
			{ operations: 60, values: { "post.bunRssBytes": 420 * MiB } },
		]);

		expect(slopes["slopePer100Operations.post.bunRssBytes"]).toBeCloseTo(50 * MiB, 0);
		expect(slopes["slopePer100Operations.post.bunHeapUsedBytes"]).toBeNull();
	});
});

describe("retentionClassification", () => {
	const base = {
		toleranceRatio: 0.1,
		postGcRssBytes: 410 * MiB,
		freshIdleRssBytes: 400 * MiB,
		postGcHeapUsedBytes: 82 * MiB,
		postGcExternalBytes: 10 * MiB,
		postRecoveryRssBytes: 410 * MiB,
		postGcAnonymousBytes: 305 * MiB,
		freshIdleHeapUsedBytes: 80 * MiB,
		freshIdleExternalBytes: 10 * MiB,
		rssSlopePer100Operations: 1 * MiB,
		freshIdleAnonymousBytes: 300 * MiB,
		slopeCeilingBytesPer1000Operations: 100 * MiB,
	};

	it("reports no material retention inside the declared tolerance", () => {
		expect(retentionClassification(base)).toMatchObject({
			material: false,
			classification: "no-material-retention",
		});
	});

	it("attributes growth that survives a forced collection to the live heap", () => {
		expect(
			retentionClassification({
				...base,
				postGcRssBytes: 600 * MiB,
				postGcHeapUsedBytes: 200 * MiB,
			}),
		).toMatchObject({ material: true, classification: "heap-retention" });
	});

	it("separates native growth from allocator high-water behaviour", () => {
		expect(
			retentionClassification({
				...base,
				postGcRssBytes: 600 * MiB,
				postGcExternalBytes: 80 * MiB,
			}),
		).toMatchObject({ classification: "native-external-retention" });
		expect(retentionClassification({ ...base, postGcRssBytes: 600 * MiB })).toMatchObject({
			classification: "allocator-high-water",
		});
	});

	it("treats a projected slope above the ceiling as material", () => {
		expect(retentionClassification({ ...base, rssSlopePer100Operations: 20 * MiB })).toMatchObject({
			material: true,
			projectedBytesPer1000Operations: 200 * MiB,
		});
	});
});
