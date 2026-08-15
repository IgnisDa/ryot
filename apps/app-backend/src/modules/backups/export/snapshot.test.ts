import { expect, it } from "@effect/vitest";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { collectManagedAssetLocators, requireV1NotificationMetadataSchema } from "./snapshot";

it("does not archive managed assets stored in schema-declared secret fields", () => {
	const propertiesSchema: AppSchema = {
		fields: {
			publicAsset: {
				type: "object",
				properties: {},
				label: "Public asset",
				description: "Public asset",
				validation: { asset: true },
			},
			secretAsset: {
				secret: true,
				type: "object",
				properties: {},
				label: "Secret asset",
				validation: { asset: true },
				description: "Secret asset",
			},
		},
	};
	expect(
		collectManagedAssetLocators([
			{
				propertiesSchema,
				properties: {
					publicAsset: { type: "local", key: "permanent/public.bin" },
					secretAsset: { type: "local", key: "permanent/secret.bin" },
				},
			},
		]),
	).toEqual([{ type: "local", key: "permanent/public.bin" }]);
});

it.effect("rejects non-null notification metadata without its signal schema", () =>
	Effect.gen(function* () {
		const error = yield* requireV1NotificationMetadataSchema(
			{ isActive: false, metadata: { token: "secret" }, signalSchemaSlug: "missing.signal" },
			undefined,
		).pipe(Effect.flip);
		expect(error.message).toContain("unavailable signal schema 'missing.signal'");
		expect(
			yield* requireV1NotificationMetadataSchema(
				{ isActive: false, metadata: null, signalSchemaSlug: "missing.signal" },
				undefined,
			),
		).toBeUndefined();
	}),
);
