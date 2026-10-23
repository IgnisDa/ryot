import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, ManagedRuntime } from "effect";

import { decodeServerOrigin, resolveApiUrl } from "#/api/origin";
import { makeUploadsApi } from "#/api/ports.test-layer";
import { ManagedAssetsService } from "#/modules/assets/managed-assets";

describe("managed assets", () => {
	const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
	const assets = [
		{ type: "local", key: "permanent/local.png" },
		{ type: "s3", key: "permanent/remote.png" },
	] as const;
	const expiresAt = "2026-09-04T12:15:00.000Z";

	it("resolves API-relative managed download paths", () => {
		const origin = decodeServerOrigin("https://ryot.example");
		expect(resolveApiUrl(origin, "/uploads/local/download?key=cover")).toBe(
			"https://ryot.example/api/uploads/local/download?key=cover",
		);
		expect(resolveApiUrl(origin, "https://assets.example/cover.jpg")).toBe(
			"https://assets.example/cover.jpg",
		);
	});

	it.live("reads absolute local and S3 URLs with their expiry", () => {
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
		return Effect.gen(function* () {
			expect(
				yield* Effect.promise(() =>
					runtime.runPromise(
						Effect.flatMap(ManagedAssetsService, (service) => service.read(scope, assets)),
					),
				),
			).toEqual([
				{
					expiresAt,
					asset: assets[0],
					url: "https://ryot.example/api/uploads/local/download?key=permanent/local.png",
				},
				{ expiresAt, asset: assets[1], url: "https://s3.example/permanent/remote.png" },
			]);
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("returns the plugin asset outcome without server identity", () => {
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
		return Effect.gen(function* () {
			expect(
				yield* Effect.promise(() =>
					runtime.runPromise(
						Effect.flatMap(ManagedAssetsService, (service) => service.outcome(scope, assets)),
					),
				),
			).toEqual({
				outcome: "success",
				resolutions: assets.map((asset) => ({
					asset,
					expiresAt,
					url: "https://s3.example/permanent/remote.png",
				})),
			});
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});
});
