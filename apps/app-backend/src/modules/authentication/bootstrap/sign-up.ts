import { eq } from "drizzle-orm";

import { db } from "~/lib/db";
import { tracker } from "~/lib/db/schema";
import { createLibraryEntityForUser } from "~/modules/collections";
import { createTrackerEntitySchemas, listBuiltinEntitySchemas } from "~/modules/entity-schemas";
import { createSavedViewsForUser } from "~/modules/saved-views";
import { createBuiltinTrackersForUser } from "~/modules/trackers";

import {
	buildAuthenticationSavedViewInputs,
	buildAuthenticationTrackerEntitySchemaLinks,
	buildLibraryEntityInput,
} from "../service";
import {
	authenticationBuiltinEntitySchemas,
	authenticationBuiltinSavedViews,
	authenticationBuiltinTrackers,
} from "./manifests";

export const bootstrapNewUser = async (userId: string) => {
	const [existingTracker] = await db
		.select({ id: tracker.id })
		.from(tracker)
		.where(eq(tracker.userId, userId))
		.limit(1);

	if (existingTracker) {
		return;
	}

	await db.transaction(async (tx) => {
		const createdTrackers = await createBuiltinTrackersForUser({
			userId,
			database: tx,
			trackers: authenticationBuiltinTrackers(),
		});

		const builtinEntitySchemaRows = await listBuiltinEntitySchemas({
			database: tx,
		});

		await createTrackerEntitySchemas({
			database: tx,
			links: buildAuthenticationTrackerEntitySchemaLinks({
				trackers: createdTrackers,
				entitySchemas: builtinEntitySchemaRows,
				schemaLinks: authenticationBuiltinEntitySchemas()
					.filter((schema) => typeof schema.trackerSlug === "string")
					.map((schema) => ({
						slug: schema.slug,
						trackerSlug: schema.trackerSlug,
					})),
			}),
		});

		await createSavedViewsForUser({
			userId,
			database: tx,
			views: buildAuthenticationSavedViewInputs({
				trackers: createdTrackers,
				entitySchemas: builtinEntitySchemaRows,
				savedViews: authenticationBuiltinSavedViews(),
			}),
		});

		const libraryEntityInput = buildLibraryEntityInput({
			entitySchemas: builtinEntitySchemaRows,
		});
		await createLibraryEntityForUser({ userId, ...libraryEntityInput }, tx);
	});
};
