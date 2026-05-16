import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { publicSystemConfig } from "./routes";

it.effect("reports local temporary and fallback permanent upload storage", () =>
	Effect.gen(function* () {
		const config = yield* AppConfig;
		expect(publicSystemConfig(config).fileStorage).toEqual({
			temporaryUploadProvider: "local",
			preferredPermanentUploadProvider: "local",
		});
	}).pipe(
		Effect.provide(
			makeAppConfigLayer({
				fileStorage: { url: Option.some("https://incomplete-s3.example.com") },
			}),
		),
	),
);

it.effect("reports fully configured S3 as the preferred permanent upload storage", () =>
	Effect.gen(function* () {
		const config = yield* AppConfig;
		expect(publicSystemConfig(config).fileStorage).toEqual({
			temporaryUploadProvider: "local",
			preferredPermanentUploadProvider: "s3",
		});
	}).pipe(
		Effect.provide(
			makeAppConfigLayer({
				fileStorage: {
					bucketName: Option.some("bucket"),
					url: Option.some("https://s3.example.com"),
					accessKeyId: Option.some(Redacted.make("access-key")),
					secretAccessKey: Option.some(Redacted.make("secret-key")),
				},
			}),
		),
	),
);
