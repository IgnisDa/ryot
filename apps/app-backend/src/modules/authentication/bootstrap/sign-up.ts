import { isAPIError } from "better-auth/api";

import { auth } from "~/lib/auth";
import { db } from "~/lib/db";
import { type ServiceResult, serviceData, serviceError } from "~/lib/result";
import { createLibraryEntityForUser } from "~/modules/collections";
import { createTrackerEntitySchemas, listBuiltinEntitySchemas } from "~/modules/entity-schemas";
import { createSavedViewsForUser } from "~/modules/saved-views";
import { createBuiltinTrackersForUser } from "~/modules/trackers";

import type { UserPreferences } from "../schemas";
import {
	buildAuthenticationSavedViewInputs,
	buildAuthenticationTrackerEntitySchemaLinks,
	buildAuthenticationTrackerInputs,
	buildLibraryEntityInput,
} from "../service";
import {
	authenticationBuiltinEntitySchemas,
	authenticationBuiltinSavedViews,
	authenticationBuiltinTrackers,
} from "./manifests";

export const signUpAndInitializeUser = async (input: {
	name: string;
	email: string;
	password: string;
	preferences: UserPreferences;
}): Promise<ServiceResult<{ created: true }, "validation">> => {
	try {
		const signUpResult = await auth.api.signUpEmail({
			body: {
				name: input.name,
				email: input.email,
				password: input.password,
				preferences: input.preferences,
			},
		});

		await db.transaction(async (tx) => {
			const createdTrackers = await createBuiltinTrackersForUser({
				database: tx,
				userId: signUpResult.user.id,
				trackers: buildAuthenticationTrackerInputs({
					trackers: authenticationBuiltinTrackers(),
				}),
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
						.filter(
							(schema): schema is typeof schema & { trackerSlug: string } =>
								typeof (schema as { trackerSlug?: string }).trackerSlug === "string",
						)
						.map((schema) => ({
							slug: schema.slug,
							trackerSlug: schema.trackerSlug,
						})),
				}),
			});

			await createSavedViewsForUser({
				database: tx,
				userId: signUpResult.user.id,
				views: buildAuthenticationSavedViewInputs({
					trackers: createdTrackers,
					entitySchemas: builtinEntitySchemaRows,
					savedViews: authenticationBuiltinSavedViews(),
				}),
			});

			const libraryEntityInput = buildLibraryEntityInput({
				entitySchemas: builtinEntitySchemaRows,
			});
			await createLibraryEntityForUser({ userId: signUpResult.user.id, ...libraryEntityInput }, tx);
		});

		return serviceData({ created: true as const });
	} catch (error) {
		if (isAPIError(error)) {
			return serviceError("validation", error.message || "Could not create account");
		}

		throw error;
	}
};
