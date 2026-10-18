import { usePluginIdentity, usePluginUserSettings } from "@ryot-app/plugin-client-sdk/react";
import { Button, IconButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type RefObject, useRef, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../../shared/plugin-identity";
import { MediaReviewForm } from "../review";
import { useQuickLog } from "./quick-log";
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
	const { log, locked, context } = useQuickLog(entityId);
	const quick =
		context === undefined || context === null ? null : activityQuickAction(logger, context);
	if (quick === null) {
		return <PlainLogButton ref={ref} onOpen={onOpen} />;
	}
	return (
		<div className="flex flex-col items-start gap-1.5">
			<div className="flex items-center">
				<Button
					disabled={locked}
					className="rounded-r-none"
					onClick={() => log.submit({ label: quick.text, entry: quick.entry })}
				>
					<AppIcon size={15} name="check" />
					{log.isSending ? "Saving…" : quick.label}
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
			{log.error === null ? null : (
				<StatusMessage tone="error">Couldn't start saving. Try again.</StatusMessage>
			)}
		</div>
	);
}

export function MediaLogActivityButton(props: {
	readonly link?: boolean;
	readonly compact: boolean;
	readonly entityId: string;
	readonly logger: MediaActivityLogger;
	readonly onOpenChange?: (open: boolean) => void;
}) {
	usePluginUserSettings(usePluginIdentity(PLUGIN_PACKAGE_ID).pluginId);
	const [open, setOpenState] = useState<"log" | "review" | undefined>(undefined);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const setOpen = (next: "log" | "review" | undefined) => {
		setOpenState(next);
		props.onOpenChange?.(next !== undefined);
	};
	const openLog = () => setOpen("log");
	let trigger = <PlainLogButton onOpen={openLog} ref={triggerRef} />;
	if (props.link) {
		trigger = (
			<Button variant="link" ref={triggerRef} onClick={openLog}>
				Log activity
			</Button>
		);
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
