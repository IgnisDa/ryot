import { eq } from "drizzle-orm";

import { db } from "~/lib/db";
import { user } from "~/lib/db/schema/auth";
import {
	apiFailure,
	apiSuccess,
	type ConfigValueResult,
	type HostFunction,
} from "~/lib/sandbox/types";
import { userPreferencesSchema } from "~/modules/authentication";

type GetUserPreferencesContext = {
	userId: string;
};

type GetUserDep = (userId: string) => Promise<{ preferences: unknown } | undefined>;

const defaultGetUser: GetUserDep = async (userId) => {
	const [row] = await db
		.select({ preferences: user.preferences })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return row;
};

export const createGetUserPreferencesHostFunction = (
	getUser: GetUserDep = defaultGetUser,
): HostFunction<GetUserPreferencesContext> => {
	return async (context): Promise<ConfigValueResult> => {
		if (typeof context.userId !== "string" || !context.userId.trim()) {
			return apiFailure("getUserPreferences requires a non-empty userId in context");
		}

		const row = await getUser(context.userId);
		if (!row) {
			return apiFailure("User not found");
		}

		const parsed = userPreferencesSchema.safeParse(row.preferences);
		if (!parsed.success) {
			const errors = parsed.error.issues.map((i) => i.message).join("; ");
			return apiFailure(`Invalid user preferences: ${errors}`);
		}

		return apiSuccess(parsed.data);
	};
};

export const getUserPreferences = createGetUserPreferencesHostFunction();
