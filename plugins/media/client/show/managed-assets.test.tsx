// @vitest-environment jsdom

import type { ManagedAssetLocator, RyotClientAdapter } from "@ryot-app/client-sdk";
import { waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import { ManagedAssetImage, ManagedAssetProvider, managedAssetBatches } from "./managed-assets";
import { flushRyotClient, mountRyotClient } from "./test-support";

const makeLocators = (count: number): readonly ManagedAssetLocator[] =>
	Array.from({ length: count }, (_, index) => ({ type: "s3", key: `asset-${index}` }));

const recordingAdapter = (calls: (readonly ManagedAssetLocator[])[]): RyotClientAdapter => ({
	query: () => Promise.resolve({}),
	resolveAssets: (assets) => {
		calls.push(assets);
		return Promise.resolve(
			assets.map((asset) => ({
				asset,
				url: `https://cdn.test/${asset.type}-${asset.key}`,
				expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
			})),
		);
	},
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("managedAssetBatches", () => {
	it("chunks a locator list into batches of at most 64", () => {
		const batches = managedAssetBatches(makeLocators(65));

		expect(batches.map((batch) => batch.locators.length)).toEqual([64, 1]);
	});

	it("canonicalizes duplicate and reordered locators to the same batch key", () => {
		const first = managedAssetBatches([
			{ type: "s3", key: "b" },
			{ type: "local", key: "a" },
			{ type: "s3", key: "b" },
		]);
		const second = managedAssetBatches([
			{ type: "local", key: "a" },
			{ type: "s3", key: "b" },
		]);

		expect(first.map((batch) => batch.key)).toEqual(second.map((batch) => batch.key));
		expect(first[0]?.locators).toHaveLength(2);
	});

	it("produces no batches for an empty locator list", () => {
		expect(managedAssetBatches([])).toEqual([]);
	});
});

describe("ManagedAssetProvider", () => {
	it("issues one resolve call per batch of at most 64 locators", async () => {
		const calls: (readonly ManagedAssetLocator[])[] = [];
		const { unmount } = mountRyotClient(
			recordingAdapter(calls),
			<ManagedAssetProvider assets={makeLocators(65)}>
				<p>content</p>
			</ManagedAssetProvider>,
		);

		await waitFor(() => expect(calls.map((batch) => batch.length)).toEqual([64, 1]));
		unmount();
	});

	it("never issues a resolve call for an empty locator list", async () => {
		const calls: (readonly ManagedAssetLocator[])[] = [];
		const { unmount } = mountRyotClient(
			recordingAdapter(calls),
			<ManagedAssetProvider assets={[]}>
				<p>content</p>
			</ManagedAssetProvider>,
		);

		await flushRyotClient();
		expect(calls).toHaveLength(0);
		unmount();
	});

	it("does not issue a new resolve call when re-rendered with an equivalent, reordered locator list", async () => {
		const calls: (readonly ManagedAssetLocator[])[] = [];
		const locators = makeLocators(3);
		const { rerender, unmount } = mountRyotClient(
			recordingAdapter(calls),
			<ManagedAssetProvider assets={locators}>
				<p>content</p>
			</ManagedAssetProvider>,
		);
		await waitFor(() => expect(calls).toHaveLength(1));

		rerender(
			<ManagedAssetProvider assets={[...locators].toReversed()}>
				<p>content</p>
			</ManagedAssetProvider>,
		);
		await flushRyotClient();

		expect(calls).toHaveLength(1);
		unmount();
	});
});

describe("ManagedAssetImage", () => {
	it("shows a placeholder until the managed asset resolves, then renders the resolved image", async () => {
		const asset = { type: "s3", key: "cover" } as const;
		const { container, unmount } = mountRyotClient(
			recordingAdapter([]),
			<ManagedAssetProvider assets={[asset]}>
				<ManagedAssetImage asset={asset} className="w-10" />
			</ManagedAssetProvider>,
		);

		expect(container.querySelector("img")).toBeNull();
		await waitFor(() =>
			expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/s3-cover"),
		);
		unmount();
	});

	it("keeps showing a placeholder instead of throwing when resolution fails", async () => {
		const adapter: RyotClientAdapter = {
			query: () => Promise.resolve({}),
			resolveAssets: () => Promise.reject(new Error("offline")),
		};
		const asset = { type: "s3", key: "cover" } as const;
		const { container, unmount } = mountRyotClient(
			adapter,
			<ManagedAssetProvider assets={[asset]}>
				<ManagedAssetImage asset={asset} className="w-10" />
			</ManagedAssetProvider>,
		);

		await flushRyotClient();
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
		unmount();
	});
});
