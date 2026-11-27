import type { Text } from "@ryot-app/plugin-client-sdk/react";
import { useFormatters } from "@ryot-app/plugin-client-sdk/react";
import {
	ActionDock,
	Badge,
	Button,
	MenuButton,
	type MenuItem,
	RowGroup,
	ScreenBarButton,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type ComponentProps, type ReactNode, type RefObject, useRef } from "react";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type { useMeasurementLogger } from "../measurements/measurement-logger";
import { useFitnessMessages } from "../messages";
import { clockTime } from "./clock";
import type { WorkoutEditorContext } from "./controller-types";
import type { EditorOverlay } from "./editor-overlays";
import { DockTimers, RailTimers } from "./session-timers";
import { EditorStats } from "./summary";

type TimerProps = Omit<
	ComponentProps<typeof DockTimers>,
	"draft" | "onJumpToSet" | "onAddExercises"
>;

type EditorLayoutProps = {
	readonly now: number;
	readonly title: Text;
	readonly live: boolean;
	readonly locked: boolean;
	readonly cards: ReactNode;
	readonly template: boolean;
	readonly notices: ReactNode;
	readonly historical: boolean;
	readonly draft: WorkoutEditorDraft;
	readonly context: WorkoutEditorContext;
	readonly onOverlay: (overlay: EditorOverlay) => void;
	readonly editorRoot: RefObject<null | HTMLDivElement>;
	readonly onOpenDetails: (trigger: HTMLButtonElement) => void;
};

export function CompactDock(props: {
	readonly live: boolean;
	readonly locked: boolean;
	readonly template: boolean;
	readonly saveBlocked: boolean;
	readonly safeAreaBottom: number;
	readonly timerProps: TimerProps;
	readonly draft: WorkoutEditorDraft;
	readonly onJumpToSet: (setId: string) => void;
	readonly onOverlay: (overlay: EditorOverlay) => void;
}) {
	const text = useFitnessMessages();
	return (
		<ActionDock
			safeAreaBottom={props.safeAreaBottom}
			label={props.live ? text("client.editor.timers") : text("client.editor.editor-actions")}
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
						{text("client.editor.exercise")}
					</Button>
					<span className="flex-1" />
					<Button disabled={props.saveBlocked} onClick={() => props.onOverlay("finish")}>
						{props.template
							? text("client.editor.save-template")
							: text("client.editor.save-changes")}
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
	readonly template: boolean;
	readonly finishLabel: string;
	readonly saveBlocked: boolean;
	readonly onTogglePause: () => void;
	readonly onOverlay: (overlay: EditorOverlay) => void;
	readonly onOpenDetails: (trigger: null | HTMLButtonElement) => void;
}) {
	const text = useFitnessMessages();
	const actionsTrigger = useRef<HTMLButtonElement>(null);
	return (
		<>
			{props.live ? (
				<ScreenBarButton
					disabled={props.locked}
					onClick={props.onTogglePause}
					label={props.paused ? text("client.home.draft-live-resume") : text("client.editor.pause")}
				>
					<AppIcon size={20} name={props.paused ? "play" : "pause"} />
				</ScreenBarButton>
			) : null}
			<MenuButton
				trigger="bar"
				triggerRef={actionsTrigger}
				label={text("client.editor.actions")}
				items={[
					{
						key: "details",
						onSelect: () => props.onOpenDetails(actionsTrigger.current),
						label: props.template
							? text("client.wsheets.template-details")
							: text("client.wsheets.workout-details"),
					},
					...props.menu,
				]}
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
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { draft, onOverlay } = props;
	return (
		<div ref={editorRoot} className="grid gap-4 pb-44 font-ui">
			<header className="grid gap-3">
				<h1 className="text-xl leading-[26px] font-semibold text-balance">
					<button
						type="button"
						className="text-left [overflow-wrap:anywhere]"
						onClick={(event) => props.onOpenDetails(event.currentTarget)}
						aria-label={text("client.editor.edit-details", {
							title: props.title,
							kind: props.template ? "template" : "workout",
						})}
					>
						{props.title}
					</button>
				</h1>
				{props.live ? (
					<p className="-mt-2.5 text-xs text-text-muted">
						{clockTime(formatters, draft.startedAt) === undefined
							? text("client.editor.started-now")
							: text("client.home.draft-started", {
									time: clockTime(formatters, draft.startedAt) ?? "",
								})}
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
				{text("client.editor.add-exercises")}
			</Button>
			<p className="text-center text-xs text-text-subtle">
				{props.live ? text("client.editor.footnote-live") : null}
				{props.historical ? text("client.editor.footnote-historical") : null}
				{props.template ? text("client.editor.footnote-template") : null}
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
	readonly timerProps: TimerProps;
	readonly discardBlocked: boolean;
	readonly workoutAttachments: number;
	readonly onOpenWorkoutMedia: () => void;
	readonly measurement: ReturnType<typeof useMeasurementLogger>;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { draft, locked, onOverlay } = props;
	const { setTrigger, trigger: _trigger, ...measurement } = props.measurement;
	let eyebrow = text("client.home.draft-live-title");
	if (props.template) {
		eyebrow = text("browse.field.template");
	} else if (props.historical) {
		eyebrow = text("client.editor.eyebrow-historical");
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
							onClick={(event) => props.onOpenDetails(event.currentTarget)}
						>
							<AppIcon size={14} name="pencil" />
							{text("client.editor.details")}
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
					{toolbarButton("picker", "plus", text("client.editor.add-exercises"), { primary: true })}
					{toolbarButton("reorder", "arrow-up-down", text("client.editor.reorder"))}
					{toolbarButton("supersets", "link", text("property.supersets"))}
					{toolbarButton("bulk-delete", "trash-2", text("client.editor.delete-ellipsis"), {
						ariaLabel: text("client.editor.delete-sets"),
					})}
				</div>
				{props.cards}
			</div>
			<aside className="sticky top-5 grid gap-3" aria-label={text("client.workout.session")}>
				{props.live ? (
					<RailTimers
						{...props.timerProps}
						draft={draft}
						startedAt={clockTime(formatters, draft.startedAt)}
					/>
				) : null}
				<RowGroup>
					{props.live ? (
						<RailButton
							icon="ruler"
							ref={setTrigger}
							onClick={measurement.log}
							label={text("client.measurements.log")}
							aria-label={text("client.measurements.log")}
							disabled={locked || measurement.unavailable}
							trailing={
								<span className="text-xs text-text-muted">
									{measurement.error
										? text("client.editor.measurement-load-failed")
										: text("client.editor.saves-separately")}
								</span>
							}
						/>
					) : null}
					<RailButton
						icon="image"
						onClick={props.onOpenWorkoutMedia}
						label={text("client.media.attachments")}
						trailing={<Badge variant="neutral">{props.workoutAttachments}</Badge>}
						aria-label={text("client.editor.attachments-count", {
							count: props.workoutAttachments,
						})}
					/>
					{props.live ? (
						<RailButton
							icon="sliders-horizontal"
							onClick={() => onOverlay("preferences")}
							label={text("client.editor.preferences")}
							trailing={<AppIcon size={15} name="chevron-right" className="text-text-subtle" />}
						/>
					) : null}
				</RowGroup>
				{props.live && measurement.error ? (
					<Button size="sm" variant="secondary" onClick={measurement.retry}>
						{text("client.editor.retry-measurements")}
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

function RailButton(
	props: Omit<ComponentProps<"button">, "children"> & {
		readonly label: Text;
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
