import { z } from "@hono/zod-openapi";

import { integrationProvider } from "~/modules/integrations/schemas";
import { listIntegrations as readIntegrationsForUser } from "~/modules/integrations/service";

import { apiFailure, type HostFunction } from "../types";
import {
	formatIssues,
	mapServiceResult,
	requireUserId,
	type UserHostFunctionContext,
} from "./shared";

const listIntegrationsInputSchema = z
	.object({
		provider: integrationProvider.optional(),
		isDisabled: z.boolean().optional(),
	})
	.strict();

export const createListIntegrationsHostFunction = (
	readIntegrations: typeof readIntegrationsForUser = readIntegrationsForUser,
): HostFunction<UserHostFunctionContext> => {
	return async (context, options) => {
		const userId = requireUserId(context, "listIntegrations");
		if (typeof userId !== "string") {
			return userId;
		}

		const parsed = listIntegrationsInputSchema.safeParse(options ?? {});
		if (!parsed.success) {
			return apiFailure(formatIssues(parsed.error.issues));
		}

		return mapServiceResult(await readIntegrations({ ...parsed.data, userId }));
	};
};

export const listIntegrations = createListIntegrationsHostFunction();
