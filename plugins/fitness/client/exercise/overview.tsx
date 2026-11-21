import type { AssetLocator } from "@ryot-app/plugin-client-sdk";
import { Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	type Text,
	useFormatters,
	useHostScreen,
	useRyot,
} from "@ryot-app/plugin-client-sdk/react";
import { Button } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { useState } from "react";

import { WorkoutExerciseOverridesSchema } from "../../shared/workout-editor-preferences";
import { fitnessRoute } from "../../shared/workout-editor-routes";
import { AssetArtWell } from "../asset-urls";
import { HeaderActionsMenu } from "../header-actions-menu";
import { useExerciseLabels, useFitnessMessages } from "../messages";
import { ExerciseDefaultsSheet } from "../workout-editor/preferences";
import { type ActiveEditorDraft, addToDraftLabel } from "./active-draft";
import {
	exerciseFacts,
	type ExerciseRecord,
	groupTargets,
	isCustomExercise,
} from "./details-model";
import { ExerciseMergeFlow, mergeBlockedReason, MergeFailureMessage } from "./merge";
import { cardClass, cardHeadingClass, sectionHeadingClass } from "./styles";

const assetKey = (asset: AssetLocator) => (asset.type === "remote" ? asset.url : asset.key);

export function ExerciseOverview(props: {
	readonly compact: boolean;
	readonly exercise: ExerciseRecord;
}) {
	const text = useFitnessMessages();
	return (
		<section
			aria-label={text("client.exercise.overview.label")}
			className={clsx(
				"grid gap-5",
				!props.compact && "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start",
			)}
		>
			<ExerciseImages compact={props.compact} exercise={props.exercise} />
			<MusclesCard exercise={props.exercise} />
		</section>
	);
}

export function Instructions(props: { readonly exercise: ExerciseRecord }) {
	const text = useFitnessMessages();
	const steps = props.exercise.instructions ?? [];
	if (steps.length === 0 && !isCustomExercise(props.exercise)) {
		return null;
	}
	return (
		<section className={cardClass} aria-label={text("client.exercise.instructions.title")}>
			<h2 className={sectionHeadingClass}>{text("client.exercise.instructions.title")}</h2>
			{steps.length === 0 ? (
				<p className="text-[14px] text-text-muted">{text("client.exercise.instructions.empty")}</p>
			) : (
				<ol className="flex flex-col gap-3">
					{steps.map((step, index) => (
						<li key={step} className="flex gap-3 text-[15px] text-text">
							<span
								aria-hidden="true"
								className="grid size-6 shrink-0 place-items-center rounded-pill bg-accent-soft text-[13px] font-semibold text-accent-text"
							>
								{index + 1}
							</span>
							<p>{step}</p>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

export function ExerciseHeader(props: {
	readonly compact: boolean;
	readonly onChanged: () => void;
	readonly onPostReview: () => void;
	readonly exercise: ExerciseRecord;
	readonly draft: undefined | ActiveEditorDraft;
}) {
	const text = useFitnessMessages();
	const labels = useExerciseLabels();
	const { compact, exercise } = props;
	const custom = isCustomExercise(exercise);
	const pills = [
		exercise.kind === null ? null : labels.kind(exercise.kind),
		exercise.mechanic === null ? null : labels.mechanic(exercise.mechanic),
		exercise.force === null ? null : labels.force(exercise.force),
		exercise.level === null ? null : labels.level(exercise.level),
		...exercise.equipment.items.map((item) => item.name),
	].filter((label) => label !== null);
	return (
		<header
			className={clsx(
				"flex gap-4",
				compact ? "flex-col" : "flex-row flex-wrap items-end justify-between",
			)}
		>
			<div className="flex min-w-0 flex-col gap-3">
				<span className="font-ui font-semibold text-[13px] tracking-wide text-accent-text uppercase">
					{text(custom ? "client.exercise.eyebrow-custom" : "client.editor.exercise")}
				</span>
				<h1
					className={clsx(
						"font-display font-semibold text-text",
						compact ? "text-[34px] leading-tight" : "text-5xl leading-none",
					)}
				>
					{exercise.name}
				</h1>
				<div className="flex flex-wrap gap-2 font-ui">
					{pills.map((label, index) => (
						<Pill key={label} label={label} tone={index === 0 ? "accent" : "plain"} />
					))}
					{custom ? <Pill label={text("client.exercise.created-by-you")} /> : null}
				</div>
			</div>
			<ExerciseActions
				compact={compact}
				draft={props.draft}
				exercise={exercise}
				onChanged={props.onChanged}
				onPostReview={props.onPostReview}
			/>
		</header>
	);
}

function Pill(props: { readonly label: string; readonly tone?: "plain" | "accent" }) {
	return (
		<span
			className={clsx(
				"rounded-pill border px-3 py-1 text-[13px] font-medium",
				props.tone === "accent"
					? "border-accent-border bg-accent-soft text-accent-text"
					: "border-border-strong text-text-muted",
			)}
		>
			{props.label}
		</span>
	);
}

function ExerciseImages(props: { readonly compact: boolean; readonly exercise: ExerciseRecord }) {
	const text = useFitnessMessages();
	const { compact, exercise } = props;
	const images = exercise.images ?? [];
	const [selected, setSelected] = useState(0);
	return (
		<div className="flex min-w-0 flex-col gap-3">
			<AssetArtWell
				fit="contain"
				name={exercise.name}
				asset={images[selected]}
				className={clsx("w-full", compact ? "aspect-4/3" : "aspect-16/10")}
			/>
			{images.length > 1 ? (
				<div role="group" className="flex gap-2" aria-label={text("client.exercise.images")}>
					{images.map((asset, index) => (
						<button
							type="button"
							key={assetKey(asset)}
							aria-pressed={index === selected}
							onClick={() => setSelected(index)}
							aria-label={text("client.exercise.show-image", {
								index: index + 1,
								total: images.length,
							})}
							className={clsx(
								"overflow-hidden rounded-lg border-2",
								index === selected ? "border-accent" : "border-border",
							)}
						>
							<AssetArtWell fit="contain" asset={asset} className="size-16" name={exercise.name} />
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

function MusclesCard(props: { readonly exercise: ExerciseRecord }) {
	const text = useFitnessMessages();
	const labels = useExerciseLabels();
	const formatters = useFormatters();
	const { exercise } = props;
	const groups = groupTargets(text, exercise.targets.items);
	const facts = exerciseFacts(formatters, text, labels, exercise);
	const custom = isCustomExercise(exercise);
	if (groups.length === 0 && facts.length === 0 && !custom) {
		return null;
	}
	return (
		<aside className={cardClass} aria-label={text("client.editor.details")}>
			{groups.length === 0 && !custom ? null : (
				<h2 className={cardHeadingClass}>{text("client.exercise.muscles-worked")}</h2>
			)}
			{groups.length === 0 && custom ? (
				<p className="text-[14px] text-text-muted">{text("client.exercise.no-muscles")}</p>
			) : null}
			{groups.map((group) => (
				<div key={group.label ?? "all"} className="flex flex-col gap-2">
					{group.label === null ? null : (
						<span className="text-[12px] font-semibold tracking-wide text-text-muted uppercase">
							{group.label}
						</span>
					)}
					<ul className="flex flex-wrap gap-2">
						{group.names.map((name) => (
							<li key={name}>
								<Pill label={name} tone={group.primary ? "accent" : "plain"} />
							</li>
						))}
					</ul>
				</div>
			))}
			{facts.length === 0 ? null : (
				<dl className="grid gap-2 border-t border-border pt-3 text-[14px]">
					{facts.map((fact) => (
						<div key={fact.label} className="flex justify-between gap-4">
							<dt className="text-text-muted">{fact.label}</dt>
							<dd className="text-right text-text">{fact.value}</dd>
						</div>
					))}
				</dl>
			)}
		</aside>
	);
}

function ExerciseActions(props: {
	readonly compact: boolean;
	readonly onChanged: () => void;
	readonly onPostReview: () => void;
	readonly exercise: ExerciseRecord;
	readonly draft: undefined | ActiveEditorDraft;
}) {
	const text = useFitnessMessages();
	const { draft, exercise } = props;
	const client = useRyot();
	const [action, setAction] = useState<"merge" | "preferences">();
	const openScreen = useHostScreen();
	const [mergeFailure, setMergeFailure] = useState<Text>();
	const overrides = Schema.decodeResult(WorkoutExerciseOverridesSchema)(
		exercise.membershipProperties ?? {},
	);
	const exerciseKind = exercise.kind;
	const inDraft = draft?.exerciseIds.includes(exercise.id) === true;
	const mergeItem =
		exerciseKind !== null
			? [
					{
						key: "merge",
						disabled: inDraft,
						onSelect: () => setAction("merge"),
						label: inDraft
							? text("client.exercise.merge-blocked-item", {
									reason: mergeBlockedReason(
										text,
										draft.mode.kind.startsWith("template") ? "template" : "workout",
									),
								})
							: text("client.exercise.merge-item"),
					},
				]
			: [];
	return (
		<div className={clsx("flex flex-wrap gap-2", props.compact && "w-full")}>
			{draft === undefined ? null : (
				<Button
					className={clsx(props.compact && "flex-1")}
					onClick={() =>
						client.navigation.push({
							...fitnessRoute("/workout-editor"),
							search: { add: exercise.id },
						})
					}
				>
					{addToDraftLabel(text, draft.mode)}
				</Button>
			)}
			{isCustomExercise(exercise) ? (
				<Button
					variant="secondary"
					onClick={() =>
						client.navigation.push(
							fitnessRoute(`/exercises/${encodeURIComponent(exercise.id)}/edit`),
						)
					}
				>
					{text("common.action.edit")}
				</Button>
			) : null}
			<Button
				variant="secondary"
				onClick={() => openScreen(client.screens.addToCollection({ entityId: exercise.id }))}
			>
				{text("client.exercise.add-to-collection")}
			</Button>
			<HeaderActionsMenu
				entityId={exercise.id}
				label={text("client.exercise.more-actions")}
				items={[
					{
						key: "preferences",
						onSelect: () => setAction("preferences"),
						label: text("client.exercise.preferences"),
						disabled: exerciseKind === null || overrides._tag === "Failure",
					},
					{
						key: "review",
						onSelect: props.onPostReview,
						label: text("client.exercise.post-review"),
					},
					{
						key: "duplicate",
						label: text("client.exercise.duplicate"),
						onSelect: () =>
							client.navigation.push({
								...fitnessRoute("/exercises/new"),
								search: { duplicate: exercise.id },
							}),
					},
					...mergeItem,
				]}
			/>
			{mergeFailure === undefined ? null : <MergeFailureMessage message={mergeFailure} />}
			{action === "merge" && exerciseKind !== null ? (
				<ExerciseMergeFlow
					kind={exerciseKind}
					name={exercise.name}
					exerciseId={exercise.id}
					onFailed={setMergeFailure}
					onClose={() => setAction(undefined)}
				/>
			) : null}
			{action === "preferences" && exerciseKind !== null && overrides._tag === "Success" ? (
				<ExerciseDefaultsSheet
					exerciseId={exercise.id}
					onSaved={props.onChanged}
					exerciseKind={exerciseKind}
					exerciseName={exercise.name}
					overrides={overrides.success}
					onClose={() => setAction(undefined)}
				/>
			) : null}
		</div>
	);
}
