import { eq } from "drizzle-orm";

import { db } from "~/lib/db";
import { tracker } from "~/lib/db/schema";
import { createLibraryEntityForUser } from "~/modules/collections";
import { createTrackerEntitySchemas, listBuiltinEntitySchemas } from "~/modules/entity-schemas";
import { createSavedViewsForUser } from "~/modules/saved-views";
import { createBuiltinTrackersForUser } from "~/modules/trackers";

import {
	buildBuiltinSavedViewInputs,
	buildBuiltinTrackerEntitySchemaLinks,
	buildLibraryEntityInput,
} from "./builders";
import { builtinEntitySchemas } from "./entity-schemas";
import { builtinSavedViews } from "./saved-views";
import { builtinTrackers } from "./trackers";

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
			trackers: builtinTrackers(),
		});

		const builtinEntitySchemaRows = await listBuiltinEntitySchemas({
			database: tx,
		});

		await createTrackerEntitySchemas({
			database: tx,
			links: buildBuiltinTrackerEntitySchemaLinks({
				trackers: createdTrackers,
				entitySchemas: builtinEntitySchemaRows,
				schemaLinks: builtinEntitySchemas()
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
			views: buildBuiltinSavedViewInputs({
				trackers: createdTrackers,
				savedViews: builtinSavedViews(),
				entitySchemas: builtinEntitySchemaRows,
			}),
		});

		const libraryEntityInput = buildLibraryEntityInput({
			entitySchemas: builtinEntitySchemaRows,
		});
		await createLibraryEntityForUser({ userId, ...libraryEntityInput }, tx);
	});
};
