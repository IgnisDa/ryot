import {
	createRyotBackgroundSubmission,
	createRyotQuery,
	type RyotSubmission,
	useBackgroundSubmission,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useRef } from "react";

import {
	MediaHistoryCorrectionRetryInput,
	type MediaHistoryCorrectionStatus as MediaHistoryCorrectionStatusData,
	mediaHistoryCorrectionStatusRecipe,
} from "../../shared/history-correction-status";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

const historyCorrectionStatusQuery = createRyotQuery<
	{ readonly entityId: string },
	MediaHistoryCorrectionStatusData
>(
	({ input, client }) =>
		client.data.query(
			mediaHistoryCorrectionStatusRecipe({
				entityId: input.entityId,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
	{ refreshWhile: ({ data }) => data.status === "pending" },
);

const retryHistoryCorrection = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	label: () => "Retry history update",
	slug: "media-history-correction-retry",
	inputSchema: MediaHistoryCorrectionRetryInput,
	input: ({ input, submissionId }: RyotSubmission<{ readonly entityId: string }>) => ({
		...input,
		submissionId,
	}),
});

export function MediaHistoryCorrectionStatus(props: {
	readonly entityId: string;
	readonly refreshActivity: () => void;
}) {
	const { refreshActivity } = props;
	const status = useRyotQuery(historyCorrectionStatusQuery, { entityId: props.entityId });
	const retry = useBackgroundSubmission(retryHistoryCorrection);
	const previous = useRef(status.data?.status);

	useEffect(() => {
		if (status.isError) {
			return;
		}
		const current = status.data?.status;
		if (previous.current === "pending" && current === "settled") {
			refreshActivity();
		}
		previous.current = current;
	}, [refreshActivity, status.data?.status, status.isError]);

	const retryFailed = retry.error !== null || retry.last?.status === "failed";
	if (status.isError) {
		return (
			<StatusMessage tone="error" action={{ label: "Try again", onClick: status.refetch }}>
				Could not check history status.
			</StatusMessage>
		);
	}
	if (status.data?.status === "pending") {
		return (
			<div className="flex flex-col gap-2">
				<StatusMessage tone="pending">
					<p>Updating history…</p>
					<p>Large corrections can appear in stages.</p>
				</StatusMessage>
				{retryFailed ? (
					<p role="alert" className="text-xs text-danger">
						Could not start the retry. Try again.
					</p>
				) : null}
			</div>
		);
	}
	if (status.data?.status !== "failed") {
		return null;
	}
	return (
		<div className="flex flex-col gap-2">
			<StatusMessage tone="error">
				<p>Could not finish updating history.</p>
				<Button
					variant="secondary"
					disabled={retry.isSending || retry.state.status === "accepted"}
					onClick={() => retry.submit({ entityId: props.entityId }, { onAccepted: status.refetch })}
				>
					Try again
				</Button>
			</StatusMessage>
			{retryFailed ? (
				<p role="alert" className="text-xs text-danger">
					Could not start the retry. Try again.
				</p>
			) : null}
		</div>
	);
}
