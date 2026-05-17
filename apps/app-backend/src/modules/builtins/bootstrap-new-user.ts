import { db } from "~/lib/db";
import { ensureLibraryEntityForUser } from "~/modules/collections";
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
	await db.transaction(async (tx) => {
		const trackers = await createBuiltinTrackersForUser({
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
				trackers,
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
				trackers,
				savedViews: builtinSavedViews(),
				entitySchemas: builtinEntitySchemaRows,
			}),
		});

		const libraryEntityInput = buildLibraryEntityInput({
			entitySchemas: builtinEntitySchemaRows,
		});
		await ensureLibraryEntityForUser({ userId, database: tx, ...libraryEntityInput });
	});
};
