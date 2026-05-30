import type { DbClient } from "~/lib/db";

import { deleteEventsForEntityForUser } from "./repository";

export type DeleteUserEventsForEntityDeps = {
	deleteEventsForEntityForUser: typeof deleteEventsForEntityForUser;
};

const deleteUserEventsForEntityDeps: DeleteUserEventsForEntityDeps = {
	deleteEventsForEntityForUser,
};

export const deleteUserEventsForEntity = async (
	input: { userId: string; entityId: string; database?: DbClient },
	deps: DeleteUserEventsForEntityDeps = deleteUserEventsForEntityDeps,
) =>
	deps.deleteEventsForEntityForUser(
		{ userId: input.userId, entityId: input.entityId },
		input.database,
	);
