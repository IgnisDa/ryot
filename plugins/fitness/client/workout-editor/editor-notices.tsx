import type { Text } from "@ryot-app/plugin-client-sdk/react";
import { useFormatters } from "@ryot-app/plugin-client-sdk/react";
import { Button, MotionList, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { useFitnessMessages } from "../messages";
import { clockTime } from "./clock";
import { isWorkoutEditorSaving, type WorkoutEditorControllerSnapshot } from "./controller-types";
import type { SavedEntityId } from "./use-editor-actions";

const alert = <AppIcon size={16} name="circle-alert" />;

const timerIcon = <AppIcon size={16} name="timer" />;

export function EditorNotices(props: {
	readonly live: boolean;
	readonly paused: boolean;
	readonly locked: boolean;
	readonly compact: boolean;
	readonly disabled: boolean;
	readonly template: boolean;
	readonly conflict: boolean;
	readonly onSave: () => void;
	readonly historical: boolean;
	readonly hasContext: boolean;
	readonly onFlush: () => void;
	readonly onReload: () => void;
	readonly onResume: () => void;
	readonly onDiscard: () => void;
	readonly onRetryLoad: () => void;
	readonly retryableRequest: boolean;
	readonly measurementError: boolean;
	readonly message: Text | undefined;
	readonly onRetryRequest: () => void;
	readonly onRetrySettings: () => void;
	readonly onRetryMeasurements: () => void;
	readonly saved: undefined | SavedEntityId;
	readonly draft: undefined | WorkoutEditorDraft;
	readonly snapshot: WorkoutEditorControllerSnapshot;
	readonly exercises: { readonly isError: boolean; readonly refetch: () => void };
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { draft, saved, snapshot, exercises } = props;
	const ready = snapshot.status === "ready" && draft !== undefined && props.hasContext;
	return (
		<MotionList className="grid gap-3 empty:hidden">
			{props.conflict && draft !== undefined ? (
				<Notice
					icon={alert}
					tone="danger"
					title={text("client.notices.conflict-title")}
					action={
						props.disabled ? undefined : (
							<Button size="sm" variant="secondary" onClick={props.onReload}>
								{text("client.notices.reload")}
							</Button>
						)
					}
				>
					{text("client.notices.conflict-body")}
				</Notice>
			) : null}
			{props.message === undefined ? null : (
				<Notice
					icon={alert}
					tone="danger"
					action={
						snapshot.status === "empty" && props.retryableRequest ? (
							<Button size="sm" variant="secondary" onClick={props.onRetryRequest}>
								{text("client.notices.retry-requested")}
							</Button>
						) : undefined
					}
				>
					{props.message}
				</Notice>
			)}
			{snapshot.contextError === undefined ? null : (
				<Notice
					tone="warning"
					title={text("client.notices.settings-title")}
					icon={<AppIcon size={16} name="refresh-cw" />}
					action={
						<Button size="sm" variant="secondary" onClick={props.onRetrySettings}>
							{text("client.notices.retry-settings")}
						</Button>
					}
				>
					{text("client.notices.settings-body")}
				</Notice>
			)}
			{snapshot.status === "recovery-error" ? (
				<Notice
					icon={alert}
					tone="danger"
					title={text("client.notices.recovery-title")}
					action={
						<div className="flex flex-wrap gap-1.5">
							<Button size="sm" onClick={props.onRetryLoad}>
								{text("client.notices.retry-recovery")}
							</Button>
							<Button size="sm" variant="dangerGhost" onClick={props.onDiscard}>
								{text("client.notices.discard-unreadable")}
							</Button>
						</div>
					}
				>
					{text("client.notices.recovery-body")}
				</Notice>
			) : null}
			{snapshot.status === "empty" && saved !== undefined ? (
				<Notice tone="success" icon={<AppIcon size={16} name="circle-check" />}>
					{text("client.notices.saved")}
				</Notice>
			) : null}
			{ready && props.template ? (
				<Notice
					tone="info"
					icon={<AppIcon size={16} name="layers-3" />}
					title={text("client.notices.template-title")}
				>
					{text("client.notices.template-body")}
				</Notice>
			) : null}
			{ready && props.historical ? (
				<Notice
					tone="info"
					icon={<AppIcon size={16} name="calendar" />}
					title={text("client.notices.historical-title")}
				>
					{draft.startedAt === undefined
						? null
						: `${
								draft.endedAt === undefined
									? text("client.notices.historical-when", {
											start: clockTime(formatters, draft.startedAt) ?? "",
											date: formatters
												.dateTime({ dateStyle: "short" })
												.format(new Date(draft.startedAt)),
										})
									: text("client.notices.historical-when-range", {
											end: clockTime(formatters, draft.endedAt) ?? "",
											start: clockTime(formatters, draft.startedAt) ?? "",
											date: formatters
												.dateTime({ dateStyle: "short" })
												.format(new Date(draft.startedAt)),
										})
							} `}
					{text("client.notices.historical-body")}
				</Notice>
			) : null}
			{ready && props.paused ? (
				<Notice
					tone="warning"
					icon={<AppIcon size={16} name="pause" />}
					title={text("client.notices.paused-title")}
					action={
						<Button size="sm" disabled={props.locked} onClick={props.onResume}>
							{text("client.home.draft-live-resume")}
						</Button>
					}
				>
					{text("client.notices.paused-body")}
				</Notice>
			) : null}
			{ready && snapshot.uploading ? (
				<Notice
					tone="info"
					title={text("client.notices.uploading-title")}
					icon={<AppIcon size={16} name="refresh-cw" />}
				>
					{text("client.notices.uploading-body")}
				</Notice>
			) : null}
			{ready && snapshot.uploadError !== undefined ? (
				<Notice icon={alert} tone="danger" title={text("client.notices.upload-failed-title")}>
					{text("client.notices.upload-failed-body")}
				</Notice>
			) : null}
			{ready && snapshot.persistenceError !== undefined ? (
				<Notice
					icon={alert}
					tone="danger"
					title={text("client.notices.storage-title")}
					action={
						<Button size="sm" onClick={props.onFlush}>
							{text("client.notices.retry-storage")}
						</Button>
					}
				>
					{text("client.notices.storage-body")}
				</Notice>
			) : null}
			{ready && (snapshot.deviceError !== undefined || snapshot.timerError !== undefined) ? (
				<Notice tone="warning" icon={timerIcon}>
					{text("client.notices.alerts-unavailable")}
				</Notice>
			) : null}
			{ready && Object.values(snapshot.alertStatus).includes("inexact") ? (
				<Notice tone="warning" icon={timerIcon}>
					{text("client.notices.alerts-inexact")}
				</Notice>
			) : null}
			{ready && draft.submission !== undefined ? (
				<Notice
					tone={saved === undefined ? "info" : "success"}
					icon={<AppIcon size={16} name={saved === undefined ? "refresh-cw" : "circle-check"} />}
					title={
						saved === undefined
							? text("client.notices.save-unfinished")
							: text("client.notices.workout-saved")
					}
					action={
						<Button size="sm" onClick={props.onSave} disabled={isWorkoutEditorSaving(snapshot)}>
							{saved === undefined
								? text("client.notices.retry-save")
								: text("client.notices.finish-cleanup")}
						</Button>
					}
				>
					{saved === undefined
						? text("client.notices.submission-fixed")
						: text("client.notices.cleanup-unfinished")}
				</Notice>
			) : null}
			{ready && exercises.isError ? (
				<Notice
					icon={alert}
					tone="danger"
					title={text("client.notices.exercises-title")}
					action={
						<Button size="sm" variant="secondary" onClick={exercises.refetch}>
							{text("client.notices.retry-exercises")}
						</Button>
					}
				>
					{text("client.notices.exercises-body")}
				</Notice>
			) : null}
			{ready && props.live && props.compact && props.measurementError ? (
				<Notice
					icon={alert}
					tone="warning"
					action={
						<Button size="sm" variant="secondary" onClick={props.onRetryMeasurements}>
							{text("common.action.try-again")}
						</Button>
					}
				>
					{text("client.measurements.load-failed")}
				</Notice>
			) : null}
		</MotionList>
	);
}
