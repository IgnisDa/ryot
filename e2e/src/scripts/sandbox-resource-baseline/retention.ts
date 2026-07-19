import type { MetricValues } from "./artifacts";

export type RetentionPoint = { readonly operations: number; readonly values: MetricValues };

const slope = (points: ReadonlyArray<{ x: number; y: number }>) => {
	if (points.length < 2) {
		return null;
	}
	const meanX = points.reduce((total, point) => total + point.x, 0) / points.length;
	const meanY = points.reduce((total, point) => total + point.y, 0) / points.length;
	const variance = points.reduce((total, point) => total + (point.x - meanX) ** 2, 0);
	if (variance === 0) {
		return null;
	}
	return (
		points.reduce((total, point) => total + (point.x - meanX) * (point.y - meanY), 0) / variance
	);
};

/**
 * Least-squares growth per 100 operations for every metric present in each recovery checkpoint,
 * so a soak's trend does not depend on the first and last wave alone.
 */
export const retentionSlopes = (points: ReadonlyArray<RetentionPoint>): MetricValues => {
	const names = [...new Set(points.flatMap(({ values }) => Object.keys(values)))].sort();
	return Object.fromEntries(
		names.map((name) => {
			const usable = points.flatMap(({ values, operations }) => {
				const value = values[name];
				return typeof value === "number" ? [{ y: value, x: operations }] : [];
			});
			const perOperation = slope(usable);
			return [`slopePer100Operations.${name}`, perOperation === null ? null : perOperation * 100];
		}),
	);
};

const growth = (after: number | null, before: number | null) =>
	after === null || before === null || before === 0 ? null : (after - before) / before;

export const retentionClassification = (input: {
	readonly freshIdleRssBytes: number | null;
	readonly postRecoveryRssBytes: number | null;
	readonly postGcRssBytes: number | null;
	readonly freshIdleHeapUsedBytes: number | null;
	readonly postGcHeapUsedBytes: number | null;
	readonly postGcExternalBytes: number | null;
	readonly freshIdleExternalBytes: number | null;
	readonly postGcAnonymousBytes: number | null;
	readonly freshIdleAnonymousBytes: number | null;
	readonly rssSlopePer100Operations: number | null;
	readonly toleranceRatio: number;
	readonly slopeCeilingBytesPer1000Operations: number;
}) => {
	const rssGrowth = growth(input.postGcRssBytes, input.freshIdleRssBytes);
	const heapGrowth = growth(input.postGcHeapUsedBytes, input.freshIdleHeapUsedBytes);
	const externalGrowth = growth(input.postGcExternalBytes, input.freshIdleExternalBytes);
	const anonymousGrowth = growth(input.postGcAnonymousBytes, input.freshIdleAnonymousBytes);
	const projected =
		input.rssSlopePer100Operations === null ? null : input.rssSlopePer100Operations * 10;
	const material =
		(rssGrowth !== null && rssGrowth > input.toleranceRatio) ||
		(heapGrowth !== null && heapGrowth > input.toleranceRatio) ||
		(projected !== null && projected > input.slopeCeilingBytesPer1000Operations);
	const classification = ((): string => {
		if (!material) {
			return "no-material-retention";
		}
		if (heapGrowth !== null && heapGrowth > input.toleranceRatio) {
			return "heap-retention";
		}
		const native =
			(externalGrowth !== null && externalGrowth > input.toleranceRatio) ||
			(anonymousGrowth !== null && anonymousGrowth > input.toleranceRatio);
		return native ? "native-external-retention" : "allocator-high-water";
	})();
	return {
		material,
		rssGrowth,
		heapGrowth,
		classification,
		externalGrowth,
		anonymousGrowth,
		projectedBytesPer1000Operations: projected,
	};
};
