import { buildNotificationChannelsDocument } from "@ryot/ryotql-recipes/notification-channels";

import { appQueryClient } from "@/api/query-client";

export const notificationChannelsAtom = appQueryClient.query("ryotql", "execute", {
	payload: buildNotificationChannelsDocument({ limit: 100, page: 1 }),
});
