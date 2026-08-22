import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { decodeServerOrigin, resolveApiUrl } from "#/api/origin";
import { makeUploadsApi } from "#/api/ports.test-layer";
import {
	collectManagedAssets,
	ManagedAssetsService,
	managedAssetKey,
	resolveManagedAssetOutcome,
	resolveAssetUrl,
} from "#/modules/assets/managed-assets";

describe("managed assets", () => {
	const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
	const assets = [
		{ type: "local", key: "permanent/local.png" },
		{ type: "s3", key: "permanent/remote.png" },
	] as const;
	const expiresAt = "2026-09-04T12:15:00.000Z";

	it("deduplicates and orders only managed locators", () => {
		expect(
			collectManagedAssets([
				{ type: "s3", key: "z" },
				{ type: "remote", url: "https://images.example/cover.jpg" },
				undefined,
				{ type: "local", key: "a" },
				{ type: "s3", key: "z" },
			]),
		).toEqual([
			{ type: "local", key: "a" },
			{ type: "s3", key: "z" },
		]);
	});

	it("uses remote URLs directly and managed URLs by stable locator key", () => {
		const asset = { type: "local", key: "cover" } as const;
		const urls = new Map([[managedAssetKey(asset), "https://ryot.example/api/uploads/cover"]]);
		expect(resolveAssetUrl(asset, urls)).toBe("https://ryot.example/api/uploads/cover");
		expect(resolveAssetUrl({ type: "remote", url: "https://images.example/cover" }, urls)).toBe(
			"https://images.example/cover",
		);
	});

	it("resolves API-relative managed download paths", () => {
		const origin = decodeServerOrigin("https://ryot.example");
		expect(resolveApiUrl(origin, "/uploads/local/download?key=cover")).toBe(
			"https://ryot.example/api/uploads/local/download?key=cover",
		);
		expect(resolveApiUrl(origin, "https://assets.example/cover.jpg")).toBe(
			"https://assets.example/cover.jpg",
		);
	});

	it("reads absolute local and S3 URLs with their expiry", async () => {
		const runtime = ManagedRuntime.make(
			ManagedAssetsService.layer.pipe(
				Layer.provide(
					makeUploadsApi({
						resolveDownloads: (_scope, request) =>
							Effect.succeed(
								request.payload.assets.map((asset, index) => ({
									asset,
									expiresAt,
									downloadUrl:
										index === 0
											? "/uploads/local/download?key=permanent/local.png"
											: "https://s3.example/permanent/remote.png",
								})),
							),
					}),
				),
			),
		);
		try {
			await expect(
				runtime.runPromise(
					Effect.flatMap(ManagedAssetsService, (service) => service.read(scope, assets)),
				),
			).resolves.toEqual([
				{
					expiresAt,
					asset: assets[0],
					url: "https://ryot.example/api/uploads/local/download?key=permanent/local.png",
				},
				{ asset: assets[1], expiresAt, url: "https://s3.example/permanent/remote.png" },
			]);
		} finally {
			await runtime.dispose();
		}
	});

	it("returns the plugin asset outcome without server identity", async () => {
		const runtime = ManagedRuntime.make(
			ManagedAssetsService.layer.pipe(
				Layer.provide(
					makeUploadsApi({
						resolveDownloads: (_scope, request) =>
							Effect.succeed(
								request.payload.assets.map((asset) => ({
									asset,
									expiresAt,
									downloadUrl: "https://s3.example/permanent/remote.png",
								})),
							),
					}),
				),
			),
		);
		try {
			await expect(runtime.runPromise(resolveManagedAssetOutcome(scope, assets))).resolves.toEqual({
				outcome: "success",
				resolutions: assets.map((asset) => ({
					asset,
					expiresAt,
					url: "https://s3.example/permanent/remote.png",
				})),
			});
		} finally {
			await runtime.dispose();
		}
	});
});
