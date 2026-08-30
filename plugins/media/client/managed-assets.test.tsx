import type { ManagedAssetLocator, RyotClientAdapter } from "@ryot-app/client-sdk";
import { ManagedAssetProvider } from "@ryot-app/client-sdk/react";
import { waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import { flushRyotClient, mountRyotClient } from "../tests/client/test-support";
import { ManagedAssetImage } from "./managed-assets";

const recordingAdapter = (
	calls: (readonly ManagedAssetLocator[])[],
	expiresAt = new Date(Date.now() + 3_600_000).toISOString(),
): Partial<RyotClientAdapter> => ({
	query: () => Promise.resolve({}),
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

afterEach(() => {
	document.body.innerHTML = "";
});

describe("ManagedAssetImage", () => {
	it("shows a placeholder until the managed asset resolves, then renders the resolved image", async () => {
		const asset = { type: "s3", key: "cover" } as const;
		const { unmount, container } = mountRyotClient(
			recordingAdapter([]),
			<ManagedAssetProvider assets={[asset]}>
				<ManagedAssetImage asset={asset} state="absent" className="w-10" monogram="Cover" />
			</ManagedAssetProvider>,
		);

		expect(container.querySelector("img")).toBeNull();
		await waitFor(() =>
			expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/s3-cover"),
		);
		unmount();
	});

	it("keeps showing a placeholder instead of throwing when resolution fails", async () => {
		const adapter: Partial<RyotClientAdapter> = {
			query: () => Promise.resolve({}),
			resolveAssets: () => Promise.reject(new Error("offline")),
		};
		const asset = { type: "s3", key: "cover" } as const;
		const { unmount, container } = mountRyotClient(
			adapter,
			<ManagedAssetProvider assets={[asset]}>
				<ManagedAssetImage asset={asset} state="absent" className="w-10" monogram="Cover" />
			</ManagedAssetProvider>,
		);

		await flushRyotClient();
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
		unmount();
	});
});
