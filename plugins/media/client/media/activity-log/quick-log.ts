import { useBackgroundSubmission, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { useEffect, useState } from "react";

import { activityLogContextQuery, logActivitySubmission } from "./queries";

export function useQuickLog(entityId: string) {
	const context = useRyotQuery(activityLogContextQuery, { entityId });
	const log = useBackgroundSubmission(logActivitySubmission);
	const saved = log.last?.status === "succeeded";
	const [refresh, setRefresh] = useState<"idle" | "requested" | "fetching" | "settled">("idle");
	const { refetch, isFetching } = context;
	let next = refresh;
	if (!saved) {
		next = "idle";
	} else if (refresh === "idle") {
		next = "requested";
	} else if (refresh === "requested" && isFetching) {
		next = "fetching";
	} else if (refresh === "fetching" && !isFetching) {
		next = "settled";
	}
	if (next !== refresh) {
		setRefresh(next);
	}
	useEffect(() => {
		if (saved) {
			refetch();
		}
	}, [saved, refetch]);
	return {
		log,
		context: context.data,
		locked:
			log.state.status === "sending" ||
			log.state.status === "accepted" ||
			(saved && refresh !== "settled"),
	};
}
