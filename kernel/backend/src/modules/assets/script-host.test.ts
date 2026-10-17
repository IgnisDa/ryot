import { expect, it } from "@effect/vitest";
import { UploadBadRequest } from "@ryot-app/contract/modules/assets/schemas";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { automationRunSubject } from "@ryot-app/sandbox/host/run-input.test-support";
import { Effect, Ref } from "effect";

import { makeSubjectRunInput } from "#modules/scripts/authorization/principal.test-support";

import { makeAssetsScriptHost } from "./script-host";
import { ManagedAssetsService } from "./storage/managed-assets";

type AssetVerificationCall = {
	readonly locators: ReadonlyArray<ManagedAssetLocator>;
	readonly ownerUserId: UserId;
};

const makeManagedAssetsService = (calls: Ref.Ref<ReadonlyArray<AssetVerificationCall>>) =>
	ManagedAssetsService.of({
		resolveDownloads: () => Effect.die("Unexpected download resolution"),
		registerManagedAsset: () => Effect.die("Unexpected asset registration"),
		listManagedAssetsForOwner: () => Effect.die("Unexpected asset listing"),
		cleanupStagedPermanentAsset: () => Effect.die("Unexpected asset cleanup"),
		stageContentAddressedPermanentAsset: () => Effect.die("Unexpected asset staging"),
		registerManagedAssetInLockedTransaction: () => Effect.die("Unexpected asset registration"),
		verifyManagedAssetOwnership: (ownerUserId, locators) =>
			Ref.update(calls, (previous) => [...previous, { locators, ownerUserId }]).pipe(
				Effect.andThen(
					locators.some(({ key }) => key === "foreign")
						? Effect.fail(new UploadBadRequest({ reason: { code: "asset-forbidden" } }))
						: Effect.succeed([]),
				),
			),
	});

it.effect("uses the trusted execution owner and returns no managed asset metadata", () =>
	Effect.gen(function* () {
		const calls = yield* Ref.make<ReadonlyArray<AssetVerificationCall>>([]);
		const host = yield* makeAssetsScriptHost.pipe(
			Effect.provideService(ManagedAssetsService, makeManagedAssetsService(calls)),
		);
		const userId = UserId.make("execution-owner");
		const locators = [{ type: "s3", key: "permanent/asset.webp" }] as const;
		const input = makeSubjectRunInput({
			userId,
			type: "user",
			accountGeneration: { userId, token: "test-account-generation" },
		});

		expect(yield* host.verifyManagedAssets(input, locators)).toBeNull();
		expect(
			yield* host.verifyManagedAssets(
				makeSubjectRunInput(automationRunSubject("after", userId)),
				locators,
			),
		).toBeNull();
		expect(yield* Ref.get(calls)).toEqual([
			{ locators, ownerUserId: userId },
			{ locators, ownerUserId: userId },
		]);
	}),
);

it.effect("fails closed when any locator is not owned by the trusted execution owner", () =>
	Effect.gen(function* () {
		const calls = yield* Ref.make<ReadonlyArray<AssetVerificationCall>>([]);
		const host = yield* makeAssetsScriptHost.pipe(
			Effect.provideService(ManagedAssetsService, makeManagedAssetsService(calls)),
		);
		const userId = UserId.make("execution-owner");
		const input = makeSubjectRunInput({
			userId,
			type: "user",
			accountGeneration: { userId, token: "test-account-generation" },
		});
		const failure = yield* host
			.verifyManagedAssets(input, [{ type: "local", key: "foreign" }])
			.pipe(Effect.flip);

		expect(failure.data).toEqual({ code: "asset-forbidden" });
		expect(yield* Ref.get(calls)).toEqual([
			{ ownerUserId: userId, locators: [{ type: "local", key: "foreign" }] },
		]);
	}),
);
