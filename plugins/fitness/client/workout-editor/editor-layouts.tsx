import {
	ActionDock,
	Badge,
	Button,
	MenuButton,
	RowGroup,
	ScreenBarButton,
	type MenuItem,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ComponentProps, ReactNode, RefObject } from "react";

import type { WorkoutEditorContextOutputSchema } from "../../shared/workout-editor-context-operations";
import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type { useMeasurementLogger } from "../measurements/measurement-logger";
import { clockTime } from "./clock";
import type { EditorOverlay } from "./editor-overlays";
import { DockTimers, RailTimers } from "./session-timers";
import { EditorStats } from "./summary";

type TimerProps = Omit<
	ComponentProps<typeof DockTimers>,
	"draft" | "onAddExercises" | "onJumpToSet"
>;

type EditorLayoutProps = {
	readonly now: number;
	readonly title: string;
	readonly live: boolean;
	readonly template: boolean;
	readonly historical: boolean;
	readonly cards: ReactNode;
	readonly notices: ReactNode;
	readonly onOverlay: (overlay: EditorOverlay) => void;
	readonly draft: WorkoutEditorDraft;
	readonly editorRoot: RefObject<HTMLDivElement | null>;
	readonly context: typeof WorkoutEditorContextOutputSchema.Type;
	readonly locked: boolean;
};

const barButtonClass = "text-text hover:bg-surface-2";

function RailButton(
	props: Omit<ComponentProps<"button">, "children"> & {
		readonly label: string;
		readonly trailing: ReactNode;
		readonly icon: ComponentProps<typeof AppIcon>["name"];
	},
) {
	const { icon, label, trailing, ...button } = props;
	return (
		<button
			type="button"
			{...button}
			className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-hover disabled:opacity-50"
		>
			<AppIcon size={17} name={icon} className="shrink-0 text-text-muted" />
			<span className="flex-1 text-sm font-medium">{label}</span>
			{trailing}
		</button>
	);
}

export function CompactDock(props: {
	readonly live: boolean;
	readonly locked: boolean;
	readonly template: boolean;
	readonly saveBlocked: boolean;
	readonly safeAreaBottom: number;
	readonly draft: WorkoutEditorDraft;
	readonly timerProps: TimerProps;
	readonly onJumpToSet: (setId: string) => void;
	readonly onOverlay: (overlay: EditorOverlay) => void;
}) {
	return (
		<ActionDock
			safeAreaBottom={props.safeAreaBottom}
			label={props.live ? "Timers" : "Editor actions"}
		>
			{props.live ? (
				<DockTimers
					{...props.timerProps}
					draft={props.draft}
					onJumpToSet={props.onJumpToSet}
					onAddExercises={() => props.onOverlay("picker")}
				/>
			) : (
				<div className="flex items-center gap-2">
					<Button
						variant="secondary"
						disabled={props.locked}
						onClick={() => props.onOverlay("picker")}
					>
						<AppIcon size={16} name="plus" />
						Exercise
					</Button>
					<span className="flex-1" />
					<Button disabled={props.saveBlocked} onClick={() => props.onOverlay("finish")}>
						{props.template ? "Save template" : "Save changes"}
					</Button>
				</div>
			)}
		</ActionDock>
	);
}

export function CompactBarActions(props: {
	readonly live: boolean;
	readonly paused: boolean;
	readonly locked: boolean;
	readonly menu: MenuItem[];
	readonly saveBlocked: boolean;
	readonly finishLabel: string;
	readonly onTogglePause: () => void;
	readonly onOverlay: (overlay: EditorOverlay) => void;
}) {
	return (
		<>
			{props.live ? (
				<ScreenBarButton
					disabled={props.locked}
					className={barButtonClass}
					onClick={props.onTogglePause}
					label={props.paused ? "Resume workout" : "Pause workout"}
				>
					<AppIcon size={20} name={props.paused ? "play" : "pause"} />
				</ScreenBarButton>
			) : null}
			<MenuButton
				items={props.menu}
				label="Workout actions"
				renderTrigger={(trigger) => (
					<ScreenBarButton {...trigger} label="Workout actions" className={barButtonClass}>
						<AppIcon size={20} name="more-horizontal" />
					</ScreenBarButton>
				)}
			/>
			<Button
				size="sm"
				className="ml-1"
				disabled={props.saveBlocked}
				onClick={() => props.onOverlay("finish")}
			>
				{props.finishLabel}
			</Button>
		</>
	);
}

export function CompactEditor({ editorRoot, ...props }: EditorLayoutProps) {
	const { draft, onOverlay } = props;
	return (
		<div ref={editorRoot} className="grid gap-4 pb-44 font-ui">
			<header className="grid gap-3">
				<h1 className="text-xl leading-[26px] font-semibold text-balance">
					<button
						type="button"
						onClick={() => onOverlay("details")}
						className="text-left [overflow-wrap:anywhere]"
						aria-label={`Edit ${props.template ? "template" : "workout"} details, ${props.title}`}
					>
						{props.title}
					</button>
				</h1>
				{props.live ? (
					<p className="-mt-2.5 text-xs text-text-muted">
						Started {clockTime(draft.startedAt) ?? "now"}
					</p>
				) : null}
				<EditorStats
					compact
					draft={draft}
					now={props.now}
					imperial={props.context.settings.unitSystem === "imperial"}
				/>
			</header>
			{props.notices}
			{props.cards}
			<Button
				className="w-full"
				variant="secondary"
				disabled={props.locked}
				onClick={() => onOverlay("picker")}
			>
				<AppIcon size={16} name="plus" />
				Add exercises
			</Button>
			<p className="text-center text-xs text-text-subtle">
				{props.live ? "Only completed sets are saved." : null}
				{props.historical ? "Unchecked sets are removed when you save." : null}
				{props.template ? "Empty set rows are dropped when you save." : null}
			</p>
		</div>
	);
}

export function WideEditor({
	editorRoot,
	...props
}: EditorLayoutProps & {
	readonly finishLabel: string;
	readonly discardLabel: string;
	readonly saveBlocked: boolean;
	readonly discardBlocked: boolean;
	readonly workoutAttachments: number;
	readonly timerProps: TimerProps;
	readonly measurement: ReturnType<typeof useMeasurementLogger>;
	readonly onOpenWorkoutMedia: () => void;
}) {
	const { draft, locked, onOverlay } = props;
	const { setTrigger, trigger: _trigger, ...measurement } = props.measurement;
	let eyebrow = "Workout in progress";
	if (props.template) {
		eyebrow = "Template";
	} else if (props.historical) {
		eyebrow = "Editing saved workout";
	}
	const toolbarButton = (
		overlay: EditorOverlay,
		icon: ComponentProps<typeof AppIcon>["name"],
		label: string,
		extra: { readonly primary?: boolean; readonly ariaLabel?: string } = {},
	) => (
		<Button
			size="sm"
			disabled={locked}
			aria-label={extra.ariaLabel}
			onClick={() => onOverlay(overlay)}
			variant={extra.primary === true ? "primary" : "ghost"}
		>
			<AppIcon size={15} name={icon} />
			{label}
		</Button>
	);
	return (
		<div
			ref={editorRoot}
			className="mx-auto grid w-full max-w-[72rem] grid-cols-[minmax(0,1fr)_20rem] items-start gap-7 pb-16 font-ui"
		>
			<div className="grid min-w-0 gap-4">
				<header className="grid gap-3.5">
					<div className="flex items-start gap-3">
						<div className="min-w-0 flex-1">
							<p className="text-[11px] font-semibold tracking-wider text-accent-text uppercase">
								{eyebrow}
							</p>
							<h1 className="mt-1 font-display text-title font-semibold text-balance [overflow-wrap:anywhere]">
								{props.title}
							</h1>
						</div>
						<Button
							size="sm"
							variant="ghost"
							disabled={locked}
							onClick={() => onOverlay("details")}
						>
							<AppIcon size={14} name="pencil" />
							Details
						</Button>
					</div>
					<EditorStats
						draft={draft}
						now={props.now}
						compact={false}
						imperial={props.context.settings.unitSystem === "imperial"}
					/>
				</header>
				{props.notices}
				<div className="flex flex-wrap gap-1">
					{toolbarButton("picker", "plus", "Add exercises", { primary: true })}
					{toolbarButton("reorder", "arrow-up-down", "Reorder")}
					{toolbarButton("supersets", "link", "Supersets")}
					{toolbarButton("bulk-delete", "trash-2", "Delete…", {
						ariaLabel: "Delete exercises or sets",
					})}
				</div>
				{props.cards}
			</div>
			<aside aria-label="Session" className="sticky top-5 grid gap-3">
				{props.live ? (
					<RailTimers {...props.timerProps} draft={draft} startedAt={clockTime(draft.startedAt)} />
				) : null}
				<RowGroup>
					{props.live ? (
						<RailButton
							icon="ruler"
							ref={setTrigger}
							label="Log measurement"
							onClick={measurement.log}
							aria-label="Log measurement"
							disabled={locked || measurement.unavailable}
							trailing={
								<span className="text-xs text-text-muted">
									{measurement.error ? "Couldn't load" : "Saves separately"}
								</span>
							}
						/>
					) : null}
					<RailButton
						icon="image"
						label="Attachments"
						onClick={props.onOpenWorkoutMedia}
						aria-label={`Attachments (${props.workoutAttachments})`}
						trailing={<Badge variant="neutral">{props.workoutAttachments}</Badge>}
					/>
					{props.live ? (
						<RailButton
							icon="sliders-horizontal"
							label="Workout preferences"
							onClick={() => onOverlay("preferences")}
							trailing={<AppIcon size={15} name="chevron-right" className="text-text-subtle" />}
						/>
					) : null}
				</RowGroup>
				{props.live && measurement.error ? (
					<Button size="sm" variant="secondary" onClick={measurement.retry}>
						Retry measurements
					</Button>
				) : null}
				<Button
					size="lg"
					className="w-full"
					disabled={props.saveBlocked}
					onClick={() => onOverlay("finish")}
				>
					{props.finishLabel}
				</Button>
				<Button
					size="sm"
					variant="dangerGhost"
					disabled={props.discardBlocked}
					onClick={() => onOverlay("discard")}
				>
					{props.discardLabel}
				</Button>
			</aside>
		</div>
	);
}
