import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { ObjectStorageService } from "#modules/assets/storage/object-storage";
import { AppConfig } from "#platform/config/service";
import { LocalStorageService } from "#platform/storage/local-storage";
import { S3Service } from "#platform/storage/s3";
import { makeRequiredConfigLayer } from "#testing/effect";

import { publicSystemConfig } from "./routes";

for (const oidc of [false, true]) {
	for (const smtp of [false, true]) {
		for (const s3 of ["absent", "partial", "complete"] as const) {
			const configLayer = AppConfig.layer.pipe(
				Layer.provide(
					makeRequiredConfigLayer({
						USERS_DISABLE_LOCAL_AUTH: oidc,
						...(oidc
							? {
									SERVER_OIDC_CLIENT_ID: "client",
									SERVER_OIDC_CLIENT_SECRET: "oidc-secret",
									SERVER_OIDC_ISSUER_URL: "https://issuer.example",
								}
							: {}),
						...(smtp
							? {
									SERVER_SMTP_USER: "user",
									SERVER_SMTP_SERVER: "smtp.example",
									SERVER_SMTP_PASSWORD: "smtp-secret",
								}
							: {}),
						...(s3 !== "absent" ? { FILE_STORAGE_S3_URL: "https://s3.example" } : {}),
						...(s3 === "complete"
							? {
									FILE_STORAGE_S3_REGION: "us-east-1",
									FILE_STORAGE_S3_BUCKET_NAME: "bucket",
									FILE_STORAGE_S3_ACCESS_KEY_ID: "access",
									FILE_STORAGE_S3_SECRET_ACCESS_KEY: "s3-secret",
								}
							: {}),
					}),
				),
			);
			layer(
				ObjectStorageService.layer.pipe(
					Layer.provideMerge(Layer.mock(LocalStorageService)({})),
					Layer.provideMerge(S3Service.layer),
					Layer.provideMerge(configLayer),
				),
			)((test) => {
				test.effect(
					`public flags agree with normalized config: OIDC ${oidc}, SMTP ${smtp}, S3 ${s3}`,
					() =>
						Effect.gen(function* () {
							const config = yield* AppConfig;
							const storage = yield* S3Service;
							const objectStorage = yield* ObjectStorageService;
							const publicConfig = publicSystemConfig(
								config,
								false,
								yield* objectStorage.permanentStorageProvider,
							);
							expect(publicConfig.auth).toMatchObject({
								oidcEnabled: oidc,
								signupAllowed: !oidc,
								localAuthDisabled: oidc,
							});
							expect(publicConfig.auth.oidcEnabled).toBe(Option.isSome(config.server.oidc));
							expect(publicConfig.notifications.smtpEnabled).toBe(smtp);
							expect(publicConfig.notifications.smtpEnabled).toBe(
								Option.isSome(config.server.smtp),
							);
							expect(storage.isConfigured).toBe(s3 === "complete");
							expect(storage.isConfigured).toBe(Option.isSome(config.fileStorage.s3));
							expect(publicConfig.fileStorage.preferredPermanentUploadProvider).toBe(
								s3 === "complete" ? "s3" : "local",
							);
						}),
				);
			});
		}
	}
}
