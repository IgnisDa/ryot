import { Button, MotionList, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { clockTime } from "./clock";
import type { WorkoutEditorControllerSnapshot } from "./controller-types";
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
	readonly historical: boolean;
	readonly hasContext: boolean;
	readonly retryableRequest: boolean;
	readonly message: string | undefined;
	readonly saved: SavedEntityId | undefined;
	readonly draft: WorkoutEditorDraft | undefined;
	readonly measurementError: boolean;
	readonly snapshot: WorkoutEditorControllerSnapshot;
	readonly conflict: { readonly reloadable: boolean } | undefined;
	readonly exercises: { readonly isError: boolean; readonly refetch: () => void };
	readonly onSave: () => void;
	readonly onFlush: () => void;
	readonly onReload: () => void;
	readonly onResume: () => void;
	readonly onDiscard: () => void;
	readonly onRetryLoad: () => void;
	readonly onRetryRequest: () => void;
	readonly onRetrySettings: () => void;
	readonly onRetryMeasurements: () => void;
}) {
	const { draft, saved, snapshot, exercises } = props;
	const ready = snapshot.status === "ready" && draft !== undefined && props.hasContext;
	return (
		<MotionList className="grid gap-3 empty:hidden">
			{props.conflict !== undefined && draft !== undefined ? (
				<Notice
					icon={alert}
					tone="danger"
					title="This workout changed elsewhere"
					action={
						props.disabled || !props.conflict.reloadable ? undefined : (
							<Button size="sm" variant="secondary" onClick={props.onReload}>
								Reload saved version
							</Button>
						)
					}
				>
					Your draft is kept. Saving won't overwrite the newer version.
				</Notice>
			) : null}
			{props.message === undefined ? null : (
				<Notice
					icon={alert}
					tone="danger"
					action={
						snapshot.status === "empty" && props.retryableRequest ? (
							<Button size="sm" variant="secondary" onClick={props.onRetryRequest}>
								Retry requested draft
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
					title="Fitness settings couldn't refresh"
					icon={<AppIcon size={16} name="refresh-cw" />}
					action={
						<Button size="sm" variant="secondary" onClick={props.onRetrySettings}>
							Retry settings
						</Button>
					}
				>
					Your entries are unchanged.
				</Notice>
			)}
			{snapshot.status === "recovery-error" ? (
				<Notice
					icon={alert}
					tone="danger"
					title="Your saved draft couldn't be read"
					action={
						<div className="flex flex-wrap gap-1.5">
							<Button size="sm" onClick={props.onRetryLoad}>
								Retry recovery
							</Button>
							<Button size="sm" variant="dangerGhost" onClick={props.onDiscard}>
								Discard unreadable draft
							</Button>
						</div>
					}
				>
					Nothing has been deleted. Try again, or discard it to start fresh.
				</Notice>
			) : null}
			{snapshot.status === "empty" && saved !== undefined ? (
				<Notice tone="success" icon={<AppIcon size={16} name="circle-check" />}>
					Saved. Personal-best processing may still be pending.
				</Notice>
			) : null}
			{ready && props.template ? (
				<Notice
					tone="info"
					title="Planning a template"
					icon={<AppIcon size={16} name="layers-3" />}
				>
					Values are optional. Clocks and completion are off until you start a workout from it.
				</Notice>
			) : null}
			{ready && props.historical ? (
				<Notice
					tone="info"
					title="Editing a saved workout"
					icon={<AppIcon size={16} name="calendar" />}
				>
					{draft.startedAt === undefined
						? ""
						: `${new Date(draft.startedAt).toLocaleDateString()}, ${clockTime(draft.startedAt)}${draft.endedAt === undefined ? "" : `–${clockTime(draft.endedAt)}`}. `}
					Times and active duration stay as recorded. Use Adjust time on the workout page to change
					them.
				</Notice>
			) : null}
			{ready && props.paused ? (
				<Notice
					tone="warning"
					title="Workout paused"
					icon={<AppIcon size={16} name="pause" />}
					action={
						<Button size="sm" disabled={props.locked} onClick={props.onResume}>
							Resume workout
						</Button>
					}
				>
					Active time is stopped. Timers keep their remaining time.
				</Notice>
			) : null}
			{ready && snapshot.uploading ? (
				<Notice
					tone="info"
					title="Uploading attachment…"
					icon={<AppIcon size={16} name="refresh-cw" />}
				>
					Saving and leaving wait until the upload finishes.
				</Notice>
			) : null}
			{ready && snapshot.uploadError !== undefined ? (
				<Notice icon={alert} tone="danger" title="An attachment couldn't upload">
					Completed uploads stay in your draft. Reopen attachments to retry, or retry draft storage
					if needed.
				</Notice>
			) : null}
			{ready && snapshot.persistenceError !== undefined ? (
				<Notice
					icon={alert}
					tone="danger"
					title="Changes aren't being saved on this device"
					action={
						<Button size="sm" onClick={props.onFlush}>
							Retry draft storage
						</Button>
					}
				>
					Keep this page open and retry before leaving.
				</Notice>
			) : null}
			{ready && (snapshot.deviceError !== undefined || snapshot.timerError !== undefined) ? (
				<Notice tone="warning" icon={timerIcon}>
					Some device alerts are unavailable. The workout deadline is still retained.
				</Notice>
			) : null}
			{ready && Object.values(snapshot.alertStatus).includes("inexact") ? (
				<Notice tone="warning" icon={timerIcon}>
					Timer alerts may arrive late on this device. Rest still ends on time here.
				</Notice>
			) : null}
			{ready && draft.submission !== undefined ? (
				<Notice
					tone={saved === undefined ? "info" : "success"}
					title={saved === undefined ? "Saving didn't finish" : "Workout saved"}
					icon={<AppIcon size={16} name={saved === undefined ? "refresh-cw" : "circle-check"} />}
					action={
						<Button size="sm" onClick={props.onSave} disabled={snapshot.saving}>
							{saved === undefined ? "Retry save" : "Finish local cleanup"}
						</Button>
					}
				>
					{saved === undefined
						? "This submission is fixed until saving completes. Retrying won't create a duplicate."
						: "Clearing the draft on this device didn't finish."}
				</Notice>
			) : null}
			{ready && exercises.isError ? (
				<Notice
					icon={alert}
					tone="danger"
					title="Exercise details couldn't load"
					action={
						<Button size="sm" variant="secondary" onClick={exercises.refetch}>
							Retry exercises
						</Button>
					}
				>
					Saving is paused until they load.
				</Notice>
			) : null}
			{ready && props.live && props.compact && props.measurementError ? (
				<Notice
					icon={alert}
					tone="warning"
					action={
						<Button size="sm" variant="secondary" onClick={props.onRetryMeasurements}>
							Try again
						</Button>
					}
				>
					Your measurements couldn't be loaded.
				</Notice>
			) : null}
		</MotionList>
	);
}
