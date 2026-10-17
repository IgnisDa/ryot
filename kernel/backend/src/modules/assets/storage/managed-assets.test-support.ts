import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import type { AppPropertyDefinition } from "@ryot-app/contract/schema/property-schema";
import { Effect } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

export const managedAssetProperty = {
	type: "object",
	properties: {},
	label: "Image",
	description: "Image",
	validation: { asset: true },
} as const satisfies AppPropertyDefinition;

export const insertManagedAsset = Effect.fn(function* (ownerUserId: UserId) {
	const session = yield* DatabaseSession;
	const locator: ManagedAssetLocator = {
		type: "s3",
		key: `permanent/${ownerUserId}_${crypto.randomUUID()}.png`,
	};
	yield* session.run((db) =>
		db
			.insert(tables.user)
			.values({ id: ownerUserId, name: ownerUserId, email: `${ownerUserId}@example.test` })
			.onConflictDoNothing(),
	);
	yield* session.run((db) =>
		db
			.insert(tables.managedAsset)
			.values({
				size: 1,
				ownerUserId,
				key: locator.key,
				provider: locator.type,
				sha256: "a".repeat(64),
				contentType: "image/png",
			}),
	);
	return locator;
});
