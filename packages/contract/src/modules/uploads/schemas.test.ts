import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	DownloadResolutionInput,
	DownloadResolutionResponse,
	MANAGED_ASSET_RESOLUTION_MAX_ASSETS,
} from "./schemas";

describe("upload response schemas", () => {
	it("requires an expiry on every download resolution", () => {
		const item = {
			expiresAt: "2026-01-01T00:15:00.000Z",
			asset: { type: "local" as const, key: "permanent/image.png" },
			downloadUrl: "uploads/local/download?key=permanent%2Fimage.png",
		};
		const response = [item];

		expect(Schema.decodeUnknownSync(DownloadResolutionResponse)(response)).toEqual(response);
		expect(() =>
			Schema.decodeUnknownSync(DownloadResolutionResponse)([
				{ asset: item.asset, downloadUrl: item.downloadUrl },
			]),
		).toThrow();
	});

	it("bounds one managed asset resolution batch", () => {
		const assets = Array.from({ length: MANAGED_ASSET_RESOLUTION_MAX_ASSETS }, (_, index) => ({
			type: "local" as const,
			key: `permanent/${index}.png`,
		}));
		expect(Schema.decodeUnknownSync(DownloadResolutionInput)({ assets })).toEqual({ assets });
		expect(() =>
			Schema.decodeUnknownSync(DownloadResolutionInput)({
				assets: [...assets, { type: "local", key: "permanent/overflow.png" }],
			}),
		).toThrow();
	});
});
