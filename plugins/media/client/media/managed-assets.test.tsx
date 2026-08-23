import { afterEach, describe, expect, it } from "@effect/vitest";
import {
	RyotClientError,
	type ManagedAssetLocator,
	type RyotClientAdapter,
} from "@ryot-app/client-sdk";
import { Effect } from "@ryot-app/client-sdk/effect";
import { ManagedAssetProvider } from "@ryot-app/client-sdk/react";
import { waitFor } from "@testing-library/dom";
import { act } from "react";

import { flushRyotClient, mountRyotClient } from "../../tests/client/test-support";
import { ManagedAssetImage } from "./managed-assets";

const recordingAdapter = (
	calls: (readonly ManagedAssetLocator[])[],
	pending: Array<() => void>,
	expiresAt = new Date(Date.now() + 3_600_000).toISOString(),
): Partial<RyotClientAdapter> => ({
	query: () => Effect.succeed({}),
	resolveAssets: (assets) =>
		Effect.callback((resume) => {
			calls.push(assets);
			pending.push(() =>
				resume(
					Effect.succeed(
						assets.map((asset) => ({
							asset,
							expiresAt,
							url: `https://cdn.test/${asset.type}-${asset.key}`,
						})),
					),
				),
			);
		}),
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("ManagedAssetImage", () => {
	it.live(
		"shows a placeholder until the managed asset resolves, then renders the resolved image",
		() =>
			Effect.gen(function* () {
				const asset = { type: "s3", key: "cover" } as const;
				const pending: Array<() => void> = [];
				const { unmount, container } = mountRyotClient(
					recordingAdapter([], pending),
					<ManagedAssetProvider assets={[asset]}>
						<ManagedAssetImage asset={asset} state="absent" className="w-10" monogram="Cover" />
					</ManagedAssetProvider>,
				);

				expect(container.querySelector("img")).toBeNull();
				act(() => pending[0]?.());
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(container.querySelector("img")?.getAttribute("src")).toBe(
							"https://cdn.test/s3-cover",
						),
					),
				);
				unmount();
			}),
	);

	it.live("keeps showing a placeholder instead of throwing when resolution fails", () =>
		Effect.gen(function* () {
			const adapter: Partial<RyotClientAdapter> = {
				query: () => Effect.succeed({}),
				resolveAssets: () => Effect.fail(new RyotClientError("transport")),
			};
			const asset = { type: "s3", key: "cover" } as const;
			const { unmount, container } = mountRyotClient(
				adapter,
				<ManagedAssetProvider assets={[asset]}>
					<ManagedAssetImage asset={asset} state="absent" className="w-10" monogram="Cover" />
				</ManagedAssetProvider>,
			);

			yield* Effect.promise(() => flushRyotClient());
			expect(container.querySelector("img")).toBeNull();
			expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
			unmount();
		}),
	);
});
