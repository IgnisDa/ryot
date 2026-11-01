import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
	DownloadResolutionInput,
	DownloadResolutionResponse,
	MANAGED_ASSET_RESOLUTION_MAX_ASSETS,
} from "./schemas";

describe("upload response schemas", () => {
	it.effect("requires an expiry on every download resolution", () =>
		Effect.gen(function* () {
			const item = {
				expiresAt: "2026-01-01T00:15:00.000Z",
				asset: { type: "local" as const, key: "permanent/image.png" },
				downloadUrl: "uploads/local/download?key=permanent%2Fimage.png",
			};
			const response = [item];

			expect(yield* Schema.decodeEffect(DownloadResolutionResponse)(response)).toEqual(response);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(DownloadResolutionResponse)([
					{ asset: item.asset, downloadUrl: item.downloadUrl },
				]),
			);
		}),
	);

	it.effect("bounds one managed asset resolution batch", () =>
		Effect.gen(function* () {
			const assets = Array.from({ length: MANAGED_ASSET_RESOLUTION_MAX_ASSETS }, (_, index) => ({
				type: "local" as const,
				key: `permanent/${index}.png`,
			}));
			expect(yield* Schema.decodeEffect(DownloadResolutionInput)({ assets })).toEqual({ assets });
			yield* Effect.flip(
				Schema.decodeEffect(DownloadResolutionInput)({
					assets: [...assets, { type: "local", key: "permanent/overflow.png" }],
				}),
			);
		}),
	);
});
