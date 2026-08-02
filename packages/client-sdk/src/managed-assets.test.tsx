import { waitFor } from "@testing-library/dom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { ManagedAssetLocator, RyotClientAdapter } from "./index";
import {
	ManagedAssetProvider,
	managedAssetBatches,
	RyotProvider,
	useManagedAssetUrl,
} from "./react";
import { createTestRyotClock } from "./testing";

type TestClock = ReturnType<typeof createTestRyotClock>;

const roots: Root[] = [];
const clocks: TestClock[] = [];

const makeLocators = (count: number): readonly ManagedAssetLocator[] =>
	Array.from({ length: count }, (_, index) => ({ type: "s3", key: `asset-${index}` }));

const render = (adapter: Partial<RyotClientAdapter>, children: ReactNode) => {
	const clock = createTestRyotClock(adapter);
	clocks.push(clock);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => root.render(<RyotProvider runtime={clock.runtime}>{children}</RyotProvider>));
	return {
		clock,
		container,
		rerender: (next: ReactNode) =>
			act(() => root.render(<RyotProvider runtime={clock.runtime}>{next}</RyotProvider>)),
	};
};

const successfulAdapter = (
	calls: (readonly ManagedAssetLocator[])[],
	expiresAt = "2026-09-04T13:00:00.000Z",
): Partial<RyotClientAdapter> => ({
	resolveAssets: (assets) => {
		calls.push(assets);
		return Promise.resolve(
			assets.map((asset) => ({
				asset,
				expiresAt,
				url: `https://cdn.test/${asset.type}-${asset.key}`,
			})),
		);
	},
});

afterEach(async () => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	await Promise.all(clocks.splice(0).map((clock) => clock.dispose()));
	document.body.innerHTML = "";
});

describe("managedAssetBatches", () => {
	it("deduplicates, sorts, and chunks locators into batches of at most 64", () => {
		const batches = managedAssetBatches([...makeLocators(65), { type: "s3", key: "asset-0" }]);

		expect(batches.map((batch) => batch.locators.length)).toEqual([64, 1]);
		expect(batches.flatMap((batch) => batch.locators)).toEqual(
			[...makeLocators(65)].sort((left, right) =>
				`${left.type}:${left.key}`.localeCompare(`${right.type}:${right.key}`),
			),
		);
	});

	it("canonicalizes duplicate and reordered locators to the same batch key", () => {
		const first = managedAssetBatches([
			{ key: "b", type: "s3" },
			{ key: "a", type: "local" },
			{ key: "b", type: "s3" },
		]);
		const second = managedAssetBatches([
			{ key: "a", type: "local" },
			{ key: "b", type: "s3" },
		]);

		expect(first.map((batch) => batch.key)).toEqual(second.map((batch) => batch.key));
	});

	it("produces no batches for an empty locator list", () => {
		expect(managedAssetBatches([])).toEqual([]);
	});
});

describe("ManagedAssetProvider", () => {
	it("issues one resolve query per batch and none for an empty provider", async () => {
		const calls: (readonly ManagedAssetLocator[])[] = [];
		render(
			successfulAdapter(calls),
			<>
				<ManagedAssetProvider assets={makeLocators(65)}>content</ManagedAssetProvider>
				<ManagedAssetProvider assets={[]}>empty</ManagedAssetProvider>
			</>,
		);

		await waitFor(() => expect(calls.map((batch) => batch.length)).toEqual([64, 1]));
	});

	it("does not query again for an equivalent reordered locator list", async () => {
		const calls: (readonly ManagedAssetLocator[])[] = [];
		const locators = makeLocators(3);
		const mounted = render(
			successfulAdapter(calls),
			<ManagedAssetProvider assets={locators}>content</ManagedAssetProvider>,
		);
		await waitFor(() => expect(calls).toHaveLength(1));

		mounted.rerender(
			<ManagedAssetProvider assets={[...locators].toReversed()}>content</ManagedAssetProvider>,
		);
		await mounted.clock.advance(0);

		expect(calls).toHaveLength(1);
	});

	it("refreshes one minute before the earliest expiry", async () => {
		const calls: (readonly ManagedAssetLocator[])[] = [];
		const clock = createTestRyotClock(successfulAdapter(calls, "2026-09-04T12:05:00.000Z"));
		clocks.push(clock);
		await clock.setTime(Date.parse("2026-09-04T12:00:00.000Z"));
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<RyotProvider runtime={clock.runtime}>
					<ManagedAssetProvider assets={makeLocators(1)}>content</ManagedAssetProvider>
				</RyotProvider>,
			),
		);
		await waitFor(() => expect(calls).toHaveLength(1));

		await clock.advance(4 * 60_000 - 1);
		expect(calls).toHaveLength(1);
		await clock.advance(1);
		await waitFor(() => expect(calls).toHaveLength(2));
	});

	it("retains the cached URL when an expiry refresh fails", async () => {
		const asset = { type: "s3", key: "cover" } as const;
		let calls = 0;
		const clock = createTestRyotClock({
			resolveAssets: (assets) => {
				calls++;
				if (calls > 1) {
					return Promise.reject(new Error("offline"));
				}
				return Promise.resolve(
					assets.map((requested) => ({
						asset: requested,
						url: "https://cdn.test/stable-cover",
						expiresAt: "2026-09-04T12:05:00.000Z",
					})),
				);
			},
		});
		clocks.push(clock);
		await clock.setTime(Date.parse("2026-09-04T12:00:00.000Z"));
		const Probe = () => <p>{useManagedAssetUrl(asset) ?? "placeholder"}</p>;
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<RyotProvider runtime={clock.runtime}>
					<ManagedAssetProvider assets={[asset]}>
						<Probe />
					</ManagedAssetProvider>
				</RyotProvider>,
			),
		);
		await waitFor(() => expect(container.textContent).toBe("https://cdn.test/stable-cover"));

		await clock.advance(4 * 60_000);
		await waitFor(() => expect(calls).toBe(2));
		expect(container.textContent).toBe("https://cdn.test/stable-cover");
	});
});
