import { RyotClientError, type RyotClient } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { EntitySchemaSlug, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	ManagedAssetProvider,
	useRyot,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	Dialog,
	EmptyState,
	Field,
	MultiSelect,
	Notice,
	Skeleton,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
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
import { MenuButton } from "./menu-button";
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

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const labelForKind = (kind: ExerciseKind | null) =>
	kind === null ? "Exercise" : capitalize(kind.replaceAll("_", " "));

const metaForExercise = (exercise: PickerExercise) =>
	[
		...exercise.targets.items.map(({ name }) => name),
		...exercise.equipment.items.map(({ name }) => name),
	].join(" · ");

function ExerciseOption(props: {
	readonly exercise: PickerExercise;
	readonly selected: boolean;
	readonly disabled: boolean;
	readonly replacing: boolean;
	readonly onToggle: () => void;
}) {
	const asset = props.exercise.images?.[0];
	const url = useAssetUrl(asset);
	const meta = metaForExercise(props.exercise);
	return (
		<button
			type="button"
			onClick={props.onToggle}
			disabled={props.disabled}
			aria-checked={props.selected}
			aria-label={props.exercise.name}
			role={props.replacing ? "radio" : "checkbox"}
			className={clsx(
				"flex min-h-16 w-full items-center gap-3 border-b border-border px-1 py-2 text-left hover:bg-hover disabled:opacity-50",
				props.selected && "bg-accent-soft",
			)}
		>
			<EntityArtWell
				url={url}
				shape="rounded"
				className="size-11 shrink-0"
				monogram={props.exercise.name}
				state={asset === undefined ? "absent" : "ready"}
			/>
			<span className="min-w-0 flex-1">
				<span className="block font-semibold text-text [overflow-wrap:anywhere]">
					{props.exercise.name}
				</span>
				<span className="block text-xs text-text-muted">
					{labelForKind(props.exercise.kind)}
					{meta === "" ? "" : ` · ${meta}`}
				</span>
			</span>
			<span
				aria-hidden="true"
				className={clsx(
					"grid size-5.5 shrink-0 place-items-center border-[1.5px]",
					props.replacing ? "rounded-full" : "rounded-sm",
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
	const [savingPreset, setSavingPreset] = useState(false);
	const { compact, safeAreaBottom } = useRyotViewport();
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
	const [loaded, setLoaded] = useState<{
		readonly items: readonly PickerExercise[];
		readonly result: WorkoutExercisePickerResult | undefined;
	}>({ items: [], result: undefined });
	if (result.data !== undefined && result.data !== loaded.result) {
		setLoaded({
			result: result.data,
			items:
				after === undefined
					? result.data.items
					: [
							...new Map(
								[...loaded.items, ...result.data.items].map((exercise) => [exercise.id, exercise]),
							).values(),
						],
		});
	}
	const items = loaded.items;
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
			return false;
		}
		const name = presetName.trim();
		if (name === "" || name.length > 80) {
			setPresetNameError(true);
			return false;
		}
		if (presets.length >= 20) {
			return false;
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
		return true;
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
	const rowAssets = managedAssetBatch(items.map(({ images }) => images?.[0]));
	const nextCursor = result.data?.pageInfo.nextCursor;
	const canShowMore =
		result.data?.pageInfo.hasMore === true &&
		nextCursor !== null &&
		nextCursor !== undefined &&
		!pages.includes(nextCursor);
	const replacing = props.replacement !== undefined;
	const icons = {
		closeIcon: <AppIcon name="x" size={16} />,
		checkIcon: <AppIcon size={14} name="check" />,
		searchIcon: <AppIcon size={14} name="search" />,
		chevronIcon: <AppIcon size={13} name="chevron-down" />,
	};
	const chip =
		"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill border border-border-emphasis bg-surface px-3 text-[13px] font-medium whitespace-nowrap hover:bg-hover pointer-coarse:h-10";
	const sortLabels: Record<PickerSort, string> = {
		name: "Name",
		"recently-added": "Recently added",
		"times-performed": "Times performed",
	};
	const appliedPreset = presets.find(({ id }) => id === activePresetId);
	return (
		<Dialog
			size="lg"
			onClose={props.onClose}
			initialFocusRef={searchRef}
			dismissible={!providerPending}
			safeAreaBottom={safeAreaBottom}
			closeLabel="Cancel exercise selection"
			placement={compact ? "sheet" : "center"}
			closeIcon={<AppIcon name="x" size={18} />}
			title={replacing ? `Replace ${props.replacement.name}` : "Add exercises"}
			description={
				replacing
					? `Only ${labelForKind(props.replacement.kind)} exercises can replace it. Matching values are kept.`
					: undefined
			}
			footer={
				<>
					<div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
						<p aria-live="polite" className="sr-only">
							{selected.length} selected
						</p>
						{selected.length === 0 ? (
							<span className="text-sm text-text-muted">
								{replacing ? "Choose one exercise" : "Nothing selected"}
							</span>
						) : (
							<ul
								aria-label="Selected exercises"
								className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]"
							>
								{selected.map((exercise) => (
									<li key={exercise.id} className="shrink-0">
										<button
											type="button"
											aria-label={`Remove ${exercise.name}`}
											onClick={() => toggleExercise(exercise)}
											className="inline-flex h-8 max-w-44 items-center gap-1.5 rounded-pill border border-accent-border bg-accent-soft px-3 text-[13px] font-medium text-accent-text pointer-coarse:h-10"
										>
											<span className="truncate">{exercise.name}</span>
											<AppIcon name="x" size={13} />
										</button>
									</li>
								))}
							</ul>
						)}
					</div>
					<Button
						className="flex-none"
						disabled={selected.length === 0 || providerPending}
						onClick={() => {
							props.onApply(selected);
							props.onClose();
						}}
					>
						{replacing
							? "Replace exercise"
							: `Add ${selected.length} ${selected.length === 1 ? "exercise" : "exercises"}`}
					</Button>
				</>
			}
		>
			<div className="grid gap-3">
				<div className="sticky -top-3 z-10 -mx-5 grid gap-2.5 bg-raised px-5 pt-3 pb-2">
					<div className="relative">
						<span
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-subtle"
						>
							<AppIcon size={16} name="search" />
						</span>
						<TextField
							type="search"
							value={search}
							ref={searchRef}
							maxLength={512}
							autoComplete="off"
							className="w-full pl-9"
							aria-label="Search exercises"
							placeholder="Search your library"
							onChange={(event) => {
								setSearch(event.currentTarget.value);
								setActivePresetId("");
								resetPages();
							}}
						/>
					</div>
					<div
						role="toolbar"
						aria-label="Filters"
						className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none]"
					>
						<MenuButton
							label="Sort exercises"
							items={(["times-performed", "name", "recently-added"] as const).map((value) => ({
								key: value,
								onSelect: () => changeSort(value),
								label: value === sort ? `${sortLabels[value]} ✓` : sortLabels[value],
							}))}
							renderTrigger={(trigger) => (
								<button {...trigger} type="button" className={chip} aria-label="Sort exercises">
									<AppIcon size={14} name="arrow-up-down" />
									{sortLabels[sort]}
									{icons.chevronIcon}
								</button>
							)}
						/>
						{replacing ? (
							<span className={clsx(chip, "border-accent-border bg-accent-soft text-accent-text")}>
								{labelForKind(props.replacement.kind)}
							</span>
						) : (
							<MultiSelect
								{...icons}
								label="Kind"
								variant="chip"
								selected={filters.kinds}
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
						)}
						<MultiSelect
							{...icons}
							label="Target"
							variant="chip"
							selected={filters.targetIds}
							onChange={(targetIds) => changeFilter("targetIds", targetIds)}
							choices={(options.data?.targets ?? []).map(({ id, name }) => ({
								value: id,
								label: name,
							}))}
						/>
						<MultiSelect
							{...icons}
							variant="chip"
							label="Equipment"
							selected={filters.equipmentIds}
							onChange={(equipmentIds) => changeFilter("equipmentIds", equipmentIds)}
							choices={(options.data?.equipment ?? []).map(({ id, name }) => ({
								value: id,
								label: name,
							}))}
						/>
						<MultiSelect
							{...icons}
							variant="chip"
							label="Collection"
							selected={filters.collectionIds}
							onChange={(collectionIds) => changeFilter("collectionIds", collectionIds)}
							choices={(options.data?.collections ?? []).map(({ id, name }) => ({
								value: id,
								label: name,
							}))}
						/>
						<MultiSelect
							{...icons}
							label="Force"
							variant="chip"
							selected={filters.forces}
							choices={exerciseForces.map((value) => ({ value, label: capitalize(value) }))}
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
							{...icons}
							label="Level"
							variant="chip"
							selected={filters.levels}
							choices={exerciseLevels.map((value) => ({ value, label: capitalize(value) }))}
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
							{...icons}
							variant="chip"
							label="Mechanics"
							selected={filters.mechanics}
							choices={exerciseMechanics.map((value) => ({ value, label: capitalize(value) }))}
							onChange={(mechanics) =>
								changeFilter(
									"mechanics",
									mechanics.filter((mechanic): mechanic is PickerFilters["mechanics"][number] =>
										Schema.is(exerciseMechanicSchema)(mechanic),
									),
								)
							}
						/>
						{replacing ? null : (
							<MenuButton
								label="Presets"
								renderTrigger={(trigger) => (
									<button
										{...trigger}
										type="button"
										aria-label="Presets"
										className={clsx(
											chip,
											appliedPreset !== undefined &&
												"border-accent-border bg-accent-soft text-accent-text",
										)}
									>
										<AppIcon size={14} name="layers-3" />
										{appliedPreset?.name ?? "Presets"}
										{icons.chevronIcon}
									</button>
								)}
								items={[
									...presets.map(({ id, name }) => ({
										key: id,
										onSelect: () => applyPreset(id),
										label: id === activePresetId ? `${name} ✓` : name,
									})),
									{
										key: "save",
										label: "Save current filters…",
										onSelect: () => setSavingPreset(true),
										disabled: !canWritePresets || presets.length >= 20,
									},
									...(appliedPreset === undefined
										? []
										: [
												{
													key: "delete",
													destructive: true,
													onSelect: deletePreset,
													disabled: !canWritePresets,
													label: `Delete ${appliedPreset.name}`,
												},
											]),
								]}
							/>
						)}
					</div>
				</div>
				{savingPreset ? (
					<Card className="grid gap-2.5 p-3">
						<Field
							label="Preset name"
							error={presetNameError ? "Enter a name with 1 to 80 characters." : undefined}
							hint={`Saves search, filters and sort on this device. ${presets.length} of 20 used.`}
						>
							{(control) => (
								<TextField
									{...control}
									maxLength={80}
									value={presetName}
									onChange={(event) => setPresetName(event.currentTarget.value)}
								/>
							)}
						</Field>
						<div className="flex justify-end gap-2">
							<Button size="sm" variant="ghost" onClick={() => setSavingPreset(false)}>
								Cancel
							</Button>
							<Button
								size="sm"
								disabled={!canWritePresets || presets.length >= 20}
								onClick={() => {
									if (savePreset()) {
										setSavingPreset(false);
									}
								}}
							>
								Save preset
							</Button>
						</div>
					</Card>
				) : null}
				{presets.length >= 20 && !replacing ? (
					<Notice tone="info" icon={<AppIcon size={16} name="info" />}>
						You can save up to 20 presets. Delete one to save another.
					</Notice>
				) : null}
				{presetReadError ? (
					<Notice
						tone="danger"
						icon={<AppIcon size={16} name="circle-alert" />}
						action={
							<Button size="sm" variant="secondary" onClick={loadPresets}>
								Retry loading presets
							</Button>
						}
					>
						Saved presets could not be read or decoded. They were not changed.
					</Notice>
				) : null}
				{presetWriteError ? (
					<Notice
						tone="danger"
						icon={<AppIcon size={16} name="circle-alert" />}
						action={
							<Button
								size="sm"
								variant="secondary"
								onClick={() => {
									if (pendingPresetWrite !== null) {
										persistPresets(pendingPresetWrite);
									}
								}}
							>
								Retry saving presets
							</Button>
						}
					>
						Saved presets could not be written. Your change is ready to retry.
					</Notice>
				) : null}
				{options.isError ? (
					<Notice
						tone="danger"
						icon={<AppIcon size={16} name="circle-alert" />}
						action={
							<Button size="sm" variant="secondary" onClick={options.refetch}>
								Retry filters
							</Button>
						}
					>
						Filter options could not be loaded.
					</Notice>
				) : null}
				{providerNotice ? (
					<Notice tone="info" icon={<AppIcon size={16} name="info" />}>
						{providerNotice}
					</Notice>
				) : null}
				{providerError ? (
					<Notice
						tone="danger"
						icon={<AppIcon size={16} name="circle-alert" />}
						action={
							<Button
								size="sm"
								variant="secondary"
								disabled={providerPending}
								onClick={openProviderSearch}
							>
								Try again
							</Button>
						}
					>
						The provider search could not be completed. Your selection is unchanged.
					</Notice>
				) : null}
				<ManagedAssetProvider assets={rowAssets}>
					<div role="region" className="grid" aria-label="Exercise library">
						{result.isPending && items.length === 0 ? (
							<div role="status" className="grid gap-2" aria-label="Loading exercises">
								{[0, 1, 2].map((index) => (
									<Skeleton key={index} className="h-14" />
								))}
							</div>
						) : null}
						{result.isError ? (
							<Notice
								tone="danger"
								icon={<AppIcon size={16} name="circle-alert" />}
								action={
									<Button size="sm" variant="secondary" onClick={result.refetch}>
										Retry
									</Button>
								}
							>
								Exercises could not be loaded.
							</Notice>
						) : null}
						{!result.isPending && !result.isError && items.length === 0 ? (
							<EmptyState
								icon={<AppIcon size={20} name="search-x" />}
								description="Try another name or clear filters, or add it from an exercise provider."
								title={
									search.trim() === ""
										? "No exercises match these filters"
										: `No exercises match “${search.trim()}”`
								}
							/>
						) : null}
						{items.map((exercise) => {
							const incompatible =
								exercise.kind === null ||
								(props.replacement !== undefined && exercise.kind !== props.replacement.kind);
							return (
								<ExerciseOption
									key={exercise.id}
									exercise={exercise}
									replacing={replacing}
									disabled={incompatible}
									selected={selectedIds.has(exercise.id)}
									onToggle={() => toggleExercise(exercise)}
								/>
							);
						})}
						<div className="grid gap-2 pt-3.5">
							{canShowMore ? (
								<Button
									variant="ghost"
									disabled={result.isFetching}
									onClick={() => setPages((current) => [...current, nextCursor])}
								>
									Show more
								</Button>
							) : null}
							<Button
								disabled={providerPending}
								onClick={openProviderSearch}
								variant={items.length === 0 && !result.isPending ? "primary" : "outline"}
							>
								{providerPending ? (
									"Searching providers…"
								) : (
									<>
										<AppIcon size={15} name="external-link" />
										Add from provider
									</>
								)}
							</Button>
						</div>
					</div>
				</ManagedAssetProvider>
			</div>
		</Dialog>
	);
}
