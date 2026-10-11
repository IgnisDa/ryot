import { useRyotQuery, useRyotSubmission } from "@ryot-app/plugin-client-sdk/react";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useState } from "react";

import { activityLogContextQuery, logActivityMutation } from "./queries";

export function useQuickLog(entityId: string) {
	const context = useRyotQuery(activityLogContextQuery, { entityId });
	const log = useRyotSubmission(logActivityMutation, {
		isComplete: (result) => result.status === "saved",
	});
	const saved = log.status === "idle" && log.data?.status === "saved";
	const [refresh, setRefresh] = useState<"idle" | "awaiting" | "fetching" | "settled">("idle");
	const { isFetching } = context;
	let next = refresh;
	if (!saved) {
		next = "idle";
	} else if (refresh === "idle") {
		next = isFetching ? "fetching" : "awaiting";
	} else if (refresh === "awaiting" && isFetching) {
		next = "fetching";
	} else if (refresh === "fetching" && !isFetching) {
		next = "settled";
	}
	if (next !== refresh) {
		setRefresh(next);
	}
	return {
		log,
		saved,
		context: context.data,
		locked: log.status !== "idle" || (saved && refresh !== "settled"),
	};
}

export function MediaSubmissionFeedback(props: {
	readonly doneText: string;
	readonly log: ReturnType<typeof useQuickLog>["log"];
}) {
	const { log } = props;
	if (log.status === "retained") {
		return (
			<StatusMessage tone="error" action={{ label: "Retry", onClick: log.retry }}>
				Couldn't save. Try again.
			</StatusMessage>
		);
	}
	return log.status === "idle" && log.data?.status === "saved" ? (
		<StatusMessage tone="success">{props.doneText}</StatusMessage>
	) : null;
}
