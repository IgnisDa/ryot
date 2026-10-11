import { RyotClientError, type RyotClient } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { EntitySchemaSlug } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	ManagedAssetProvider,
	useRyot,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, Modal, MultiSelect, Select, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { EntityArtWell } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { exerciseKindSchema, exerciseKinds, type ExerciseKind } from "../../shared/exercise-kinds";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { equipmentListRecipe, targetListRecipe } from "../../shared/taxonomy-recipes";
import {
	workoutExerciseCollectionOptionsRecipe,
	workoutExercisePickerRecipe,
	type WorkoutExercisePickerResult,
} from "../../shared/workout-exercise-recipes";
import { managedAssetBatch, useAssetUrl } from "../asset-urls";
import { readEditorExercises, readEditorPages } from "./queries";

const exerciseForces = ["pull", "push", "static"] as const;
const exerciseLevels = ["beginner", "intermediate", "expert"] as const;
const exerciseMechanics = ["compound", "isolation"] as const;
const exerciseForceSchema = Schema.Literals(exerciseForces);
const exerciseLevelSchema = Schema.Literals(exerciseLevels);
const exerciseMechanicSchema = Schema.Literals(exerciseMechanics);

const pickerFiltersSchema = Schema.Struct({
	targetIds: Schema.Array(Schema.String),
	kinds: Schema.Array(exerciseKindSchema),
	equipmentIds: Schema.Array(Schema.String),
	forces: Schema.Array(exerciseForceSchema),
	levels: Schema.Array(exerciseLevelSchema),
	collectionIds: Schema.Array(Schema.String),
	mechanics: Schema.Array(exerciseMechanicSchema),
});

const pickerSortSchema = Schema.Literals(["name", "recently-added", "times-performed"]);
const pickerPresetSchema = Schema.Struct({
	id: Schema.String,
	sort: pickerSortSchema,
	filters: pickerFiltersSchema,
	search: Schema.String.pipe(Schema.check(Schema.isMaxLength(512))),
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
});
const pickerPresetsSchema = Schema.Array(pickerPresetSchema).pipe(
	Schema.check(Schema.isMaxLength(20)),
);

type PickerFilters = typeof pickerFiltersSchema.Type;
type PickerSort = typeof pickerSortSchema.Type;
type PickerPreset = typeof pickerPresetSchema.Type;
type PickerExercise = WorkoutExercisePickerResult["items"][number];
type PickerQueryInput = {
	readonly after: string | undefined;
	readonly filters: PickerFilters;
	readonly search: string;
	readonly sort: PickerSort;
};

type ExercisePickerProps = {
	readonly replacement?: { readonly name: string; readonly kind: ExerciseKind };
	readonly onClose: () => void;
	readonly onApply: (exercises: readonly WorkoutExercisePickerResult["items"][number][]) => void;
};

const PRESETS_STORAGE_KEY = "fitness-workout-exercise-picker-presets";
const emptyFilters: PickerFilters = {
	kinds: [],
	forces: [],
	levels: [],
	mechanics: [],
	targetIds: [],
	equipmentIds: [],
	collectionIds: [],
};

const pickerOptionsQuery = createRyotQuery(({ client }) => {
	const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
	return Effect.gen(function* () {
		const [targets, equipment, collections] = yield* Effect.all([
			readEditorPages((after) =>
				client.data.query(targetListRecipe({ after, reference, limit: 100 })),
			),
			readEditorPages((after) =>
				client.data.query(equipmentListRecipe({ after, reference, limit: 100 })),
			),
			readEditorPages((after) =>
				client.data.query(workoutExerciseCollectionOptionsRecipe({ after })),
			),
		]);
		return { targets, equipment, collections };
	});
});

const pickerExercisesQuery = createRyotQuery<PickerQueryInput, WorkoutExercisePickerResult>(
	({ input, client }) =>
		client.data.query(
			workoutExercisePickerRecipe({
				...input.filters,
				sort: input.sort,
				after: input.after,
				search: input.search,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
);

const labelForKind = (kind: ExerciseKind | null) =>
	kind === null ? "Exercise" : kind.replaceAll("_", " ");

const metaForExercise = (exercise: PickerExercise) =>
	[
		...exercise.targets.items.map(({ name }) => name),
		...exercise.equipment.items.map(({ name }) => name),
	].join(" · ");

function ExerciseOption(props: {
	readonly exercise: PickerExercise;
	readonly selected: boolean;
	readonly disabled: boolean;
	readonly onToggle: () => void;
}) {
	const asset = props.exercise.images?.[0];
	const url = useAssetUrl(asset);
	const meta = metaForExercise(props.exercise);
	return (
		<button
			type="button"
			role="checkbox"
			onClick={props.onToggle}
			disabled={props.disabled}
			aria-checked={props.selected}
			aria-label={props.exercise.name}
			className={clsx(
				"flex min-h-18 w-full items-center gap-3 border-b border-border px-2 py-2 text-left",
				props.selected && "bg-accent-soft",
				props.disabled && "opacity-50",
			)}
		>
			<EntityArtWell
				url={url}
				shape="rounded"
				className="size-12 shrink-0"
				monogram={props.exercise.name}
				state={asset === undefined ? "absent" : "ready"}
			/>
			<span className="min-w-0 flex-1">
				<span className="block truncate font-semibold text-text">{props.exercise.name}</span>
				<span className="block text-sm text-text-muted">
					{labelForKind(props.exercise.kind)}
					{meta === "" ? "" : ` · ${meta}`}
				</span>
			</span>
			<span
				aria-hidden="true"
				className={clsx(
					"grid size-5 shrink-0 place-items-center rounded border",
					props.selected ? "border-accent-deep bg-accent text-accent-ink" : "border-border-strong",
				)}
			>
				{props.selected ? <AppIcon size={14} name="check" /> : null}
			</span>
		</button>
	);
}

function readProviderExercise(
	client: RyotClient,
	exercise: { readonly id: string; readonly name: string },
) {
	const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
	return readEditorPages((after) =>
		client.data.query(
			workoutExercisePickerRecipe({ after, reference, sort: "name", search: exercise.name }),
		),
	).pipe(Effect.map((items) => items.find(({ id }) => id === exercise.id)));
}

export function ExercisePicker(props: ExercisePickerProps) {
	const client = useRyot();
	const identity = client.pluginIdentity(PLUGIN_PACKAGE_ID);
	const pluginId = identity.pluginId;
	const schedule = useRyotSchedule();
	const options = useRyotQuery(pickerOptionsQuery);
	const [filters, setFilters] = useState<PickerFilters>(emptyFilters);
	const [sort, setSort] = useState<PickerSort>("times-performed");
	const [search, setSearch] = useState("");
	const deferredSearch = useDeferredValue(search.trim());
	const [pages, setPages] = useState<readonly (string | undefined)[]>([undefined]);
	const [selected, setSelected] = useState<readonly PickerExercise[]>([]);
	const [providerPending, setProviderPending] = useState(false);
	const [providerError, setProviderError] = useState(false);
	const [providerNotice, setProviderNotice] = useState<string>();
	const providerCancel = useRef<(() => void) | undefined>(undefined);
	const providerRunning = useRef(false);
	const searchRef = useRef<HTMLInputElement>(null);
	const writingPreset = useRef(false);
	const presetSequence = useRef(0);
	const [presets, setPresets] = useState<readonly PickerPreset[]>([]);
	const [presetStatus, setPresetStatus] = useState<"loading" | "ready" | "error">("loading");
	const [presetReadError, setPresetReadError] = useState(false);
	const [presetWriteError, setPresetWriteError] = useState(false);
	const [pendingPresetWrite, setPendingPresetWrite] = useState<readonly PickerPreset[] | null>(
		null,
	);
	const [presetName, setPresetName] = useState("");
	const [activePresetId, setActivePresetId] = useState("");
	const [presetNameError, setPresetNameError] = useState(false);
	const after = pages.at(-1);
	const replacementKind = props.replacement?.kind;
	const effectiveFilters = useMemo(
		() => (replacementKind === undefined ? filters : { ...filters, kinds: [replacementKind] }),
		[filters, replacementKind],
	);
	const result = useRyotQuery(pickerExercisesQuery, {
		sort,
		after,
		search: deferredSearch,
		filters: effectiveFilters,
	});
	const currentItems = result.data?.items ?? [];
	const selectedIds = new Set(selected.map(({ id }) => id));

	const resetPages = () => setPages([undefined]);
	const changeFilter = <Key extends keyof PickerFilters>(key: Key, value: PickerFilters[Key]) => {
		setFilters((current) => ({ ...current, [key]: value }));
		setActivePresetId("");
		resetPages();
	};
	const changeSort = (value: string) => {
		if (Schema.is(pickerSortSchema)(value)) {
			setSort(value);
			setActivePresetId("");
			resetPages();
		}
	};

	const loadPresets = useCallback(() => {
		const read = client.storage.get(pluginId, PRESETS_STORAGE_KEY);
		return schedule.run(
			Effect.gen(function* () {
				setPresetStatus("loading");
				setPresetReadError(false);
				const stored = yield* read;
				if (stored === null) {
					return [] as const;
				}
				return yield* Schema.decodeUnknownEffect(pickerPresetsSchema)(stored).pipe(
					Effect.mapError(() => new RyotClientError("malformed-result")),
				);
			}).pipe(
				Effect.tap((value) =>
					Effect.sync(() => {
						setPresets(value);
						setPresetStatus("ready");
					}),
				),
				Effect.catch(() =>
					Effect.sync(() => {
						setPresetReadError(true);
						setPresetStatus("error");
					}),
				),
			),
			() => undefined,
		);
	}, [client, pluginId, schedule]);

	useEffect(() => loadPresets(), [loadPresets]);

	const persistPresets = (next: readonly PickerPreset[]) => {
		if (writingPreset.current) {
			return;
		}
		writingPreset.current = true;
		setPendingPresetWrite(next);
		setPresetWriteError(false);
		schedule.run(
			Schema.encodeEffect(pickerPresetsSchema)(next).pipe(
				Effect.flatMap((encoded) => client.storage.set(pluginId, PRESETS_STORAGE_KEY, encoded)),
				Effect.tap(() =>
					Effect.sync(() => {
						setPresets(next);
						setPendingPresetWrite(null);
					}),
				),
				Effect.catch(() => Effect.sync(() => setPresetWriteError(true))),
			),
			() => {
				writingPreset.current = false;
			},
		);
	};

	const savePreset = () => {
		if (writingPreset.current) {
			return;
		}
		const name = presetName.trim();
		if (name === "" || name.length > 80) {
			setPresetNameError(true);
			return;
		}
		if (presets.length >= 20) {
			return;
		}
		let id = `${schedule.now()}-${presetSequence.current++}`;
		while (presets.some((preset) => preset.id === id)) {
			id = `${schedule.now()}-${presetSequence.current++}`;
		}
		const preset: PickerPreset = { id, name, sort, filters, search: search.trim() };
		setPresetNameError(false);
		setActivePresetId(preset.id);
		setPresetName("");
		persistPresets([...presets, preset]);
	};

	const applyPreset = (id: string) => {
		setActivePresetId(id);
		const preset = presets.find((candidate) => candidate.id === id);
		if (preset === undefined) {
			return;
		}
		setFilters(preset.filters);
		setSort(preset.sort);
		setSearch(preset.search);
		resetPages();
	};

	const deletePreset = () => {
		if (writingPreset.current) {
			return;
		}
		const next = presets.filter(({ id }) => id !== activePresetId);
		if (next.length === presets.length) {
			return;
		}
		setActivePresetId("");
		persistPresets(next);
	};

	const toggleExercise = (exercise: PickerExercise) => {
		if (exercise.kind === null) {
			return;
		}
		setSelected((current) => {
			if (current.some(({ id }) => id === exercise.id)) {
				return current.filter(({ id }) => id !== exercise.id);
			}
			if (props.replacement !== undefined) {
				return exercise.kind === props.replacement.kind ? [exercise] : current;
			}
			return [...current, exercise];
		});
	};

	const openProviderSearch = () => {
		if (providerRunning.current) {
			return;
		}
		providerRunning.current = true;
		setProviderPending(true);
		setProviderError(false);
		setProviderNotice(undefined);
		const work = Effect.gen(function* () {
			const outcome = yield* client.screens.openProviderSearch({
				initialQuery: search,
				schema: { owner: { pluginId, kind: "plugin" }, slug: EntitySchemaSlug.make("exercise") },
			});
			if (outcome.kind === "cancelled") {
				return { exercises: [], kind: "cancelled" as const };
			}
			const exercises = yield* readEditorExercises(client, outcome.entityIds);
			const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
			const providerExercises = yield* Effect.forEach(
				outcome.entityIds,
				(id): Effect.Effect<PickerExercise | void, RyotClientError> => {
					const exercise = byId.get(id);
					return exercise === undefined ? Effect.void : readProviderExercise(client, exercise);
				},
			);
			return {
				kind: "added" as const,
				exercises: providerExercises.filter(
					(exercise): exercise is PickerExercise => exercise !== undefined,
				),
			};
		}).pipe(
			Effect.tap((outcome) =>
				outcome.kind === "cancelled"
					? Effect.void
					: Effect.sync(() => {
							const eligible = outcome.exercises.filter(
								(exercise) =>
									exercise.kind !== null &&
									(props.replacement === undefined || exercise.kind === props.replacement.kind),
							);
							if (eligible.length < outcome.exercises.length) {
								setProviderNotice(
									"The exercise was added to your library, but its kind is not eligible for this selection.",
								);
							}
							if (props.replacement !== undefined) {
								const exercise = eligible[0];
								if (exercise !== undefined) {
									setSelected([exercise]);
								}
							} else {
								for (const exercise of eligible) {
									setSelected((current) =>
										current.some(({ id }) => id === exercise.id) ? current : [...current, exercise],
									);
								}
							}
							result.refetch();
						}),
			),
			Effect.catch(() => Effect.sync(() => setProviderError(true))),
			Effect.asVoid,
		);
		providerCancel.current = schedule.run(work, () => {
			providerRunning.current = false;
			setProviderPending(false);
		});
	};
	useEffect(() => () => providerCancel.current?.(), []);

	const canWritePresets = presetStatus === "ready" && pendingPresetWrite === null;
	const rowAssets = managedAssetBatch(currentItems.map(({ images }) => images?.[0]));
	const title =
		props.replacement === undefined ? "Choose exercises" : `Replace ${props.replacement.name}`;
	return (
		<Modal
			onClose={props.onClose}
			initialFocusRef={searchRef}
			dismissible={!providerPending}
			labelledBy="exercise-picker-title"
			closeLabel="Cancel exercise selection"
			containerClassName="items-center justify-center p-3"
			className="flex max-h-[90%] w-full max-w-3xl flex-col overflow-y-auto rounded-xl border border-border bg-surface p-4 font-ui shadow-card"
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<h2 id="exercise-picker-title" className="font-display text-xl font-semibold text-text">
						{title}
					</h2>
					<p className="mt-1 text-sm text-text-muted">
						{props.replacement === undefined
							? "Select one or more exercises for this workout."
							: `Choose one ${labelForKind(props.replacement.kind)} exercise.`}
					</p>
				</div>
				<button
					type="button"
					onClick={props.onClose}
					disabled={providerPending}
					aria-label="Cancel exercise selection"
					className="grid size-10 shrink-0 place-items-center rounded-lg text-text-muted"
				>
					<AppIcon name="x" size={18} />
				</button>
			</div>

			<div className="mt-4 grid gap-3">
				<label className="flex flex-col gap-1.5 text-sm font-medium text-text">
					Search exercises
					<input
						type="search"
						value={search}
						ref={searchRef}
						maxLength={512}
						autoComplete="off"
						aria-label="Search exercises"
						placeholder="Search your library"
						onChange={(event) => {
							setSearch(event.currentTarget.value);
							setActivePresetId("");
							resetPages();
						}}
						className="min-h-11 rounded-lg border border-border bg-raised px-3 text-base text-text outline-none focus:ring-2 focus:ring-focus"
					/>
				</label>
				<details>
					<summary className="cursor-pointer text-sm font-medium text-text-muted">
						Filters and sort
					</summary>
					<div className="mt-2 grid max-h-52 grid-cols-2 gap-2 overflow-y-auto">
						{props.replacement === undefined ? (
							<MultiSelect
								label="Exercise kinds"
								selected={filters.kinds}
								closeIcon={<AppIcon name="x" size={16} />}
								checkIcon={<AppIcon size={14} name="check" />}
								searchIcon={<AppIcon size={14} name="search" />}
								chevronIcon={<AppIcon size={14} name="chevron-down" />}
								choices={exerciseKinds.map((value) => ({ value, label: labelForKind(value) }))}
								onChange={(kinds) =>
									changeFilter(
										"kinds",
										kinds.filter((kind): kind is ExerciseKind =>
											Schema.is(exerciseKindSchema)(kind),
										),
									)
								}
							/>
						) : null}
						<MultiSelect
							label="Targets"
							selected={filters.targetIds}
							closeIcon={<AppIcon name="x" size={16} />}
							checkIcon={<AppIcon size={14} name="check" />}
							searchIcon={<AppIcon size={14} name="search" />}
							chevronIcon={<AppIcon size={14} name="chevron-down" />}
							onChange={(targetIds) => changeFilter("targetIds", targetIds)}
							choices={(options.data?.targets ?? []).map(({ id, name }) => ({
								value: id,
								label: name,
							}))}
						/>
						<MultiSelect
							label="Equipment"
							selected={filters.equipmentIds}
							closeIcon={<AppIcon name="x" size={16} />}
							checkIcon={<AppIcon size={14} name="check" />}
							searchIcon={<AppIcon size={14} name="search" />}
							chevronIcon={<AppIcon size={14} name="chevron-down" />}
							onChange={(equipmentIds) => changeFilter("equipmentIds", equipmentIds)}
							choices={(options.data?.equipment ?? []).map(({ id, name }) => ({
								value: id,
								label: name,
							}))}
						/>
						<MultiSelect
							label="Collections"
							selected={filters.collectionIds}
							closeIcon={<AppIcon name="x" size={16} />}
							checkIcon={<AppIcon size={14} name="check" />}
							searchIcon={<AppIcon size={14} name="search" />}
							chevronIcon={<AppIcon size={14} name="chevron-down" />}
							onChange={(collectionIds) => changeFilter("collectionIds", collectionIds)}
							choices={(options.data?.collections ?? []).map(({ id, name }) => ({
								value: id,
								label: name,
							}))}
						/>
						<MultiSelect
							label="Force"
							selected={filters.forces}
							closeIcon={<AppIcon name="x" size={16} />}
							checkIcon={<AppIcon size={14} name="check" />}
							searchIcon={<AppIcon size={14} name="search" />}
							chevronIcon={<AppIcon size={14} name="chevron-down" />}
							choices={exerciseForces.map((value) => ({ value, label: value }))}
							onChange={(forces) =>
								changeFilter(
									"forces",
									forces.filter((force): force is PickerFilters["forces"][number] =>
										Schema.is(exerciseForceSchema)(force),
									),
								)
							}
						/>
						<MultiSelect
							label="Level"
							selected={filters.levels}
							closeIcon={<AppIcon name="x" size={16} />}
							checkIcon={<AppIcon size={14} name="check" />}
							searchIcon={<AppIcon size={14} name="search" />}
							chevronIcon={<AppIcon size={14} name="chevron-down" />}
							choices={exerciseLevels.map((value) => ({ value, label: value }))}
							onChange={(levels) =>
								changeFilter(
									"levels",
									levels.filter((level): level is PickerFilters["levels"][number] =>
										Schema.is(exerciseLevelSchema)(level),
									),
								)
							}
						/>
						<MultiSelect
							label="Mechanics"
							selected={filters.mechanics}
							closeIcon={<AppIcon name="x" size={16} />}
							checkIcon={<AppIcon size={14} name="check" />}
							searchIcon={<AppIcon size={14} name="search" />}
							chevronIcon={<AppIcon size={14} name="chevron-down" />}
							choices={exerciseMechanics.map((value) => ({ value, label: value }))}
							onChange={(mechanics) =>
								changeFilter(
									"mechanics",
									mechanics.filter((mechanic): mechanic is PickerFilters["mechanics"][number] =>
										Schema.is(exerciseMechanicSchema)(mechanic),
									),
								)
							}
						/>
						<Select
							value={sort}
							onChange={changeSort}
							label="Sort exercises"
							checkIcon={<AppIcon size={14} name="check" />}
							chevronIcon={<AppIcon size={14} name="chevron-down" />}
							choices={[
								{ value: "name", label: "Name" },
								{ value: "recently-added", label: "Recently added" },
								{ value: "times-performed", label: "Times performed" },
							]}
						/>
					</div>
				</details>
			</div>

			<section
				aria-label="Saved picker presets"
				className="mt-3 rounded-lg border border-border p-3"
			>
				<details open={presetReadError || presetWriteError ? true : undefined}>
					<summary className="cursor-pointer text-sm font-medium text-text-muted">
						Saved presets
					</summary>
					<div className="flex flex-wrap items-center gap-2">
						<Select
							label="Saved presets"
							value={activePresetId}
							onChange={applyPreset}
							placeholder="Apply a preset"
							checkIcon={<AppIcon size={14} name="check" />}
							chevronIcon={<AppIcon size={14} name="chevron-down" />}
							choices={presets.map(({ id, name }) => ({ value: id, label: name }))}
						/>
						{activePresetId === "" ? null : (
							<Button
								type="button"
								variant="secondary"
								onClick={deletePreset}
								disabled={!canWritePresets}
							>
								Delete preset
							</Button>
						)}
					</div>
					<div className="mt-2 flex flex-wrap items-end gap-2">
						<label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-text">
							Save current filters as
							<input
								maxLength={80}
								value={presetName}
								aria-label="Preset name"
								aria-invalid={presetNameError}
								onChange={(event) => setPresetName(event.currentTarget.value)}
								className="min-h-11 rounded-lg border border-border bg-raised px-3 text-base text-text outline-none focus:ring-2 focus:ring-focus"
							/>
						</label>
						<Button
							type="button"
							variant="secondary"
							onClick={savePreset}
							disabled={!canWritePresets || presets.length >= 20}
						>
							Save preset
						</Button>
					</div>
					{presetNameError ? (
						<StatusMessage tone="error">Enter a name with 1 to 80 characters.</StatusMessage>
					) : null}
					{presets.length >= 20 ? (
						<StatusMessage tone="error">
							You can save up to 20 presets. Delete one to save another.
						</StatusMessage>
					) : null}
					{presetReadError ? (
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<StatusMessage tone="error">
								Saved presets could not be read or decoded. They were not changed.
							</StatusMessage>
							<Button type="button" variant="secondary" onClick={loadPresets}>
								Retry loading presets
							</Button>
						</div>
					) : null}
					{presetWriteError ? (
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<StatusMessage tone="error">
								Saved presets could not be written. Your change is ready to retry.
							</StatusMessage>
							<Button
								type="button"
								variant="secondary"
								onClick={() => {
									if (pendingPresetWrite !== null) {
										persistPresets(pendingPresetWrite);
									}
								}}
							>
								Retry saving presets
							</Button>
						</div>
					) : null}
				</details>
			</section>
			{options.isError ? (
				<div className="mt-2 flex flex-wrap items-center gap-2">
					<StatusMessage tone="error">Filter options could not be loaded.</StatusMessage>
					<Button type="button" variant="secondary" onClick={options.refetch}>
						Retry filters
					</Button>
				</div>
			) : null}

			<div className="mt-3 flex flex-wrap items-center justify-between gap-2">
				<p aria-live="polite" className="text-sm text-text-muted">
					{selected.length} selected
				</p>
				<Button
					type="button"
					disabled={providerPending}
					onClick={openProviderSearch}
					variant={currentItems.length === 0 ? "primary" : "secondary"}
				>
					{providerPending ? "Searching providers…" : "Add from provider"}
				</Button>
			</div>
			{providerNotice ? <StatusMessage tone="pending">{providerNotice}</StatusMessage> : null}
			{providerError ? (
				<div className="mt-2 flex items-center gap-2">
					<StatusMessage tone="error">
						The provider search could not be completed. Your selection is unchanged.
					</StatusMessage>
					<Button
						type="button"
						variant="secondary"
						disabled={providerPending}
						onClick={openProviderSearch}
					>
						Try again
					</Button>
				</div>
			) : null}
			{selected.length > 0 ? (
				<ul aria-label="Selected exercises" className="mt-2 flex flex-wrap gap-2">
					{selected.map((exercise) => (
						<li key={exercise.id}>
							<button
								type="button"
								aria-label={`Remove ${exercise.name}`}
								onClick={() => toggleExercise(exercise)}
								className="flex min-h-9 items-center gap-1 rounded-pill border border-border px-3 text-sm text-text"
							>
								{exercise.name}
								<AppIcon name="x" size={14} />
							</button>
						</li>
					))}
				</ul>
			) : null}

			<ManagedAssetProvider assets={rowAssets}>
				<div
					role="region"
					aria-label="Exercise library"
					className="mt-3 min-h-32 flex-1 overflow-y-auto rounded-lg border border-border"
				>
					{result.isPending ? (
						<StatusMessage tone="pending">Loading exercises…</StatusMessage>
					) : null}
					{result.isError ? (
						<div className="flex flex-wrap items-center gap-2 p-3">
							<StatusMessage tone="error">Exercises could not be loaded.</StatusMessage>
							<Button type="button" variant="secondary" onClick={result.refetch}>
								Retry
							</Button>
						</div>
					) : null}
					{!result.isPending && !result.isError && currentItems.length === 0 ? (
						<p className="p-4 text-center text-sm text-text-muted">
							No exercises match these filters.
						</p>
					) : null}
					{currentItems.map((exercise) => {
						const incompatible =
							exercise.kind === null ||
							(props.replacement !== undefined && exercise.kind !== props.replacement.kind);
						return (
							<ExerciseOption
								key={exercise.id}
								exercise={exercise}
								disabled={incompatible}
								selected={selectedIds.has(exercise.id)}
								onToggle={() => toggleExercise(exercise)}
							/>
						);
					})}
				</div>
			</ManagedAssetProvider>
			<div className="sticky bottom-0 mt-2 flex items-center justify-between gap-2 border-t border-border bg-surface pt-3">
				<div className="flex gap-2">
					<Button
						type="button"
						variant="ghost"
						disabled={pages.length <= 1}
						onClick={() => setPages((current) => current.slice(0, -1))}
					>
						Previous page
					</Button>
					<Button
						type="button"
						variant="ghost"
						disabled={
							result.data === undefined ||
							!result.data.pageInfo.hasMore ||
							result.data.pageInfo.nextCursor === null
						}
						onClick={() => {
							const nextCursor = result.data?.pageInfo.nextCursor;
							if (nextCursor !== null && nextCursor !== undefined) {
								setPages((current) => [...current, nextCursor]);
							}
						}}
					>
						Next page
					</Button>
				</div>
				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="secondary"
						onClick={props.onClose}
						disabled={providerPending}
					>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={selected.length === 0 || providerPending}
						onClick={() => {
							props.onApply(selected);
							props.onClose();
						}}
					>
						{props.replacement === undefined
							? `Add ${selected.length} ${selected.length === 1 ? "exercise" : "exercises"}`
							: "Replace exercise"}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
