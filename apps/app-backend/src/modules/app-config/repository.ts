import { db } from "~/db";
import { appConfig } from "~/db/schema";
import type { AppConfigKey } from "~/lib/app-config";

export const setAppConfigValue = async (input: {
	key: AppConfigKey;
	value: string | null;
	updatedByUserId: string;
}) => {
	const updatedAt = new Date();

	const [savedConfig] = await db
		.insert(appConfig)
		.values({
			updatedAt,
			key: input.key,
			value: input.value,
			updatedByUserId: input.updatedByUserId,
		})
		.onConflictDoUpdate({
			target: appConfig.key,
			set: {
				updatedAt,
				value: input.value,
				updatedByUserId: input.updatedByUserId,
			},
		})
		.returning({
			key: appConfig.key,
			value: appConfig.value,
			updatedAt: appConfig.updatedAt,
			updatedByUserId: appConfig.updatedByUserId,
		});

	if (!savedConfig) throw new Error("Could not persist app config value");

	return savedConfig;
};
