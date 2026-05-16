import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import Redis from "ioredis";

import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";
import { makeRedisService } from "#lib/test-utils/effect";

import { ManagedAssetsService } from "../managed-assets/service";
import { ObjectStorageService } from "../object-storage/service";
import { UploadIntentsService } from "./service";

const mockLocalStorage = Layer.mock(LocalStorageService);
const mockManagedAssets = Layer.mock(ManagedAssetsService);
const mockObjectStorage = Layer.mock(ObjectStorageService);
const mockS3 = Layer.mock(S3Service);

const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
};

const makeRedisClient = (): RedisService["Service"]["client"] =>
	Object.assign(Object.create(Redis.prototype), { duplicate: makeRedisClient });

it.effect(
	"selects, creates, and indexes a permanent upload intent without client provider input",
	() => {
		const stored = new Map<string, string>();
		const indexed: Array<{ key: string; score: number; member: string }> = [];
		const selectedKinds: string[] = [];
		const redis = Layer.succeed(
			RedisService,
			makeRedisService({
				client: makeRedisClient(),
				setAndIndex: (key, value, indexKey, score, member) => {
					stored.set(key, value);
					indexed.push({ key: indexKey, score, member });
					return Effect.void;
				},
			}),
		);
		const layer = UploadIntentsService.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					redis,
					mockManagedAssets({}),
					mockObjectStorage({
						selectStorageProvider: (kind) => {
							selectedKinds.push(kind);
							return Effect.succeed("local" as const);
						},
					}),
					mockS3({ isConfigured: true }),
					mockLocalStorage({
						isConfiguredForKind: () => true,
						createUploadTarget: (intentId) =>
							Effect.succeed({
								method: "PUT" as const,
								expiresAt: 1_700_000_900,
								uploadUrl: `/uploads/local/${intentId}?expires=1700000900&signature=signature`,
							}),
					}),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* UploadIntentsService;
			const result = yield* service.createUploadIntent(user, {
				kind: "permanent",
				fileName: "photo.png",
				contentType: "image/png",
			});
			expect(result.uploadUrl).toMatch(new RegExp(`^/uploads/local/${result.intentId}`));
			expect(selectedKinds).toEqual(["permanent"]);
			expect(indexed).toHaveLength(1);
			expect(stored.get(redisKeys.uploadIntent(result.intentId))).toContain('"provider":"local"');
			expect(stored.get(redisKeys.uploadIntent(result.intentId))).toContain(
				'"fileName":"photo.png"',
			);
		}).pipe(Effect.provide(layer));
	},
);
