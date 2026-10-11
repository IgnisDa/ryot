import { useRyotQuery, useRyotSubmission } from "@ryot-app/plugin-client-sdk/react";
import { Button, IconButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type RefObject, useRef, useState } from "react";

import { MediaLinkButton } from "../primitives";
import { MediaReviewForm } from "../review";
import { activityLogContextQuery, logActivityMutation } from "./queries";
import { MediaActivityLogSheet } from "./sheet";
import { activityQuickAction, type MediaActivityLogger } from "./state";

function PlainLogButton({
	ref,
	onOpen,
}: {
	readonly onOpen: () => void;
	readonly ref: RefObject<HTMLButtonElement | null>;
}) {
	return (
		<Button ref={ref} onClick={onOpen}>
			<AppIcon size={15} name="plus" />
			Log activity
		</Button>
	);
}

function SplitLogButton({
	ref,
	logger,
	onOpen,
	entityId,
}: {
	readonly entityId: string;
	readonly onOpen: () => void;
	readonly logger: MediaActivityLogger;
	readonly ref: RefObject<HTMLButtonElement | null>;
}) {
	const context = useRyotQuery(activityLogContextQuery, { entityId }).data;
	const log = useRyotSubmission(logActivityMutation, {
		isComplete: (result) => result.status === "saved",
	});
	const [doneText, setDoneText] = useState<string | undefined>(undefined);
	const quick =
		context === undefined || context === null ? null : activityQuickAction(logger, context);
	if (quick === null) {
		return <PlainLogButton ref={ref} onOpen={onOpen} />;
	}
	return (
		<div className="flex flex-col items-start gap-1.5">
			<div className="flex items-center">
				<Button
					className="rounded-r-none"
					disabled={log.status !== "idle"}
					onClick={() => {
						setDoneText(quick.text);
						log.submit(quick.entry);
					}}
				>
					<AppIcon size={15} name="check" />
					{log.isPending ? "Saving…" : quick.label}
				</Button>
				<IconButton
					ref={ref}
					tone="filled"
					onClick={onOpen}
					label="More logging options"
					className="rounded-l-none border-l border-border"
				>
					<AppIcon size={15} name="chevron-down" />
				</IconButton>
			</div>
			{log.status === "retained" ? (
				<div className="flex items-center gap-3">
					<StatusMessage tone="error">Couldn't save. Try again.</StatusMessage>
					<MediaLinkButton label="Retry" onClick={log.retry} />
				</div>
			) : null}
			{log.status === "idle" && log.data?.status === "saved" ? (
				<StatusMessage tone="success">{doneText}</StatusMessage>
			) : null}
		</div>
	);
}

export function MediaLogActivityButton(props: {
	readonly link?: boolean;
	readonly compact: boolean;
	readonly entityId: string;
	readonly logger: MediaActivityLogger;
}) {
	const [open, setOpen] = useState<"log" | "review" | undefined>(undefined);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const openLog = () => setOpen("log");
	let trigger = <PlainLogButton onOpen={openLog} ref={triggerRef} />;
	if (props.link) {
		trigger = <MediaLinkButton ref={triggerRef} onClick={openLog} label="Log activity" />;
	} else if (props.logger.family !== "flat") {
		trigger = (
			<SplitLogButton
				onOpen={openLog}
				ref={triggerRef}
				logger={props.logger}
				entityId={props.entityId}
			/>
		);
	}
	return (
		<>
			{trigger}
			{open === "log" ? (
				<MediaActivityLogSheet
					logger={props.logger}
					compact={props.compact}
					triggerRef={triggerRef}
					entityId={props.entityId}
					onClose={() => setOpen(undefined)}
					onReview={() => setOpen("review")}
				/>
			) : null}
			{open === "review" ? (
				<MediaReviewForm
					triggerRef={triggerRef}
					entityId={props.entityId}
					onClose={() => setOpen(undefined)}
				/>
			) : null}
		</>
	);
}
