import { readCursorPages } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	createRyotQuery,
	ManagedAssetProvider,
	nextPageCursor,
	PaginationError,
	paginationItems,
	type useRyot,
	useRyotInfiniteQuery,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, EmptyState, LoadMoreButton, Notice, Skeleton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useDeferredValue, useMemo, useRef, useState } from "react";

import type { ExerciseKind } from "../../shared/exercise-kinds";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { equipmentListRecipe, targetListRecipe } from "../../shared/taxonomy-recipes";
import {
	workoutExerciseCollectionOptionsRecipe,
	workoutExercisePickerRecipe,
} from "../../shared/workout-exercise-recipes";
import { AssetArtWell, managedAssetBatch } from "../asset-urls";
import { EditorSheet } from "./editor-sheet";
import {
	emptyFilters,
	labelForKind,
	type PickerExercise,
	type PickerFilters,
	type PickerSort,
} from "./picker-model";
import { PickerSelectionTray } from "./picker-selection-tray";
import { PickerToolbar, PresetForm } from "./picker-toolbar";
import { usePickerPresets } from "./use-picker-presets";
import { useProviderSearch } from "./use-provider-search";

type ExercisePickerProps = {
	readonly onClose: () => void;
	readonly onApply: (exercises: readonly PickerExercise[]) => void;
	readonly replacement?: {
		readonly name: string;
		readonly title?: string;
		readonly kind: ExerciseKind;
		readonly applyLabel?: string;
		readonly description?: string;
		readonly excludeIds?: readonly string[];
	};
};

const pickerOptionsQuery = createRyotQuery(({ client }) => {
	const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
	return Effect.gen(function* () {
		const [targets, equipment, collections] = yield* Effect.all([
			readCursorPages((after) =>
				client.data.query(targetListRecipe({ after, reference, limit: 100 })),
			),
			readCursorPages((after) =>
				client.data.query(equipmentListRecipe({ after, reference, limit: 100 })),
			),
			readCursorPages((after) =>
				client.data.query(workoutExerciseCollectionOptionsRecipe({ after })),
			),
		]);
		return { targets: targets.items, equipment: equipment.items, collections: collections.items };
	});
});

const pickerExercisesQuery = createRyotQuery(
	({
		input,
		client,
	}: {
		readonly client: ReturnType<typeof useRyot>;
		readonly input: {
			readonly search: string;
			readonly sort: PickerSort;
			readonly filters: PickerFilters;
			readonly after: string | undefined;
		};
	}) =>
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

const metaForExercise = (exercise: PickerExercise) =>
	[
		...exercise.targets.items.map(({ name }) => name),
		...exercise.equipment.items.map(({ name }) => name),
	].join(" · ");

export function ExercisePicker(props: ExercisePickerProps) {
	const replacement = props.replacement;
	const replacing = replacement !== undefined;
	const options = useRyotQuery(pickerOptionsQuery);
	const presets = usePickerPresets();
	const searchRef = useRef<HTMLInputElement>(null);
	const [filters, setFilters] = useState<PickerFilters>(emptyFilters);
	const [sort, setSort] = useState<PickerSort>("times-performed");
	const [search, setSearch] = useState("");
	const deferredSearch = useDeferredValue(search.trim());
	const [selected, setSelected] = useState<readonly PickerExercise[]>([]);
	const [activePresetId, setActivePresetId] = useState("");
	const [savingPreset, setSavingPreset] = useState(false);
	const [presetName, setPresetName] = useState("");
	const [presetNameError, setPresetNameError] = useState(false);
	const effectiveFilters = useMemo(
		() => (replacement === undefined ? filters : { ...filters, kinds: [replacement.kind] }),
		[filters, replacement],
	);
	const exercises = useRyotInfiniteQuery(
		pickerExercisesQuery,
		{ sort, search: deferredSearch, filters: effectiveFilters },
		{
			initialPageParam: undefined,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after }),
		},
	);
	const exerciseItems = useMemo(
		() =>
			paginationItems(
				exercises.pages,
				(page) => page.items,
				({ id }) => id,
			),
		[exercises.pages],
	);
	const invalidCursor = exercises.error instanceof PaginationError;
	const providerSearch = useProviderSearch({
		search,
		onCreateRequested: props.onClose,
		replacementKind: replacement?.kind,
		onFound: (found) => {
			if (replacing) {
				const first = found[0];
				if (first !== undefined) {
					setSelected([first]);
				}
			} else {
				setSelected((current) => [
					...current,
					...found.filter(({ id }) => !current.some((exercise) => exercise.id === id)),
				]);
			}
			exercises.refetch();
		},
	});
	const selectedIds = new Set(selected.map(({ id }) => id));

	const clearPreset = () => setActivePresetId("");
	const changeFilter = <Key extends keyof PickerFilters>(key: Key, value: PickerFilters[Key]) => {
		setFilters((current) => ({ ...current, [key]: value }));
		clearPreset();
	};
	const toggleExercise = (exercise: PickerExercise) => {
		if (exercise.kind === null) {
			return;
		}
		setSelected((current) => {
			if (current.some(({ id }) => id === exercise.id)) {
				return current.filter(({ id }) => id !== exercise.id);
			}
			if (replacement !== undefined) {
				return exercise.kind === replacement.kind ? [exercise] : current;
			}
			return [...current, exercise];
		});
	};
	const savePreset = () => {
		const name = presetName.trim();
		if (name === "" || name.length > 80) {
			setPresetNameError(true);
			return;
		}
		const id = crypto.randomUUID();
		if (presets.add({ id, name, sort, filters, search: search.trim() })) {
			setPresetNameError(false);
			setActivePresetId(id);
			setPresetName("");
			setSavingPreset(false);
		}
	};
	const applyPreset = (id: string) => {
		setActivePresetId(id);
		const preset = presets.presets.find((candidate) => candidate.id === id);
		if (preset !== undefined) {
			setFilters(preset.filters);
			setSort(preset.sort);
			setSearch(preset.search);
		}
	};
	const deletePreset = () => {
		if (presets.remove(activePresetId)) {
			clearPreset();
		}
	};

	const visibleExercises = exerciseItems.filter(({ id }) => !replacement?.excludeIds?.includes(id));
	const noMatches =
		!exercises.isPending && !exercises.isError && !invalidCursor && visibleExercises.length === 0;
	return (
		<EditorSheet
			size="lg"
			onClose={props.onClose}
			initialFocusRef={searchRef}
			dismissible={!providerSearch.pending}
			closeLabel="Cancel exercise selection"
			title={replacing ? (replacement.title ?? `Replace ${replacement.name}`) : "Add exercises"}
			description={
				replacing
					? (replacement.description ??
						`Only ${labelForKind(replacement.kind)} exercises can replace it. Matching values are kept.`)
					: undefined
			}
			footer={
				<PickerSelectionTray
					selected={selected}
					replacing={replacing}
					onRemove={toggleExercise}
					disabled={providerSearch.pending}
					applyLabel={replacement?.applyLabel}
					onApply={() => {
						props.onApply(selected);
						props.onClose();
					}}
				/>
			}
		>
			<div className="grid gap-3">
				<PickerToolbar
					sort={sort}
					search={search}
					filters={filters}
					searchRef={searchRef}
					options={options.data}
					onFilter={changeFilter}
					presets={presets.presets}
					presetsFull={presets.full}
					onApplyPreset={applyPreset}
					onDeletePreset={deletePreset}
					activePresetId={activePresetId}
					canWritePresets={presets.canWrite}
					replacementKind={replacement?.kind}
					onSavePreset={() => setSavingPreset(true)}
					onSort={(value) => {
						setSort(value);
						clearPreset();
					}}
					onSearch={(value) => {
						setSearch(value);
						clearPreset();
					}}
				/>
				{savingPreset ? (
					<PresetForm
						name={presetName}
						onSave={savePreset}
						onName={setPresetName}
						nameError={presetNameError}
						used={presets.presets.length}
						onCancel={() => setSavingPreset(false)}
						canSave={presets.canWrite && !presets.full}
					/>
				) : null}
				{presets.full && !replacing ? (
					<Notice tone="info" icon={<AppIcon size={16} name="info" />}>
						You can save up to 20 presets. Delete one to save another.
					</Notice>
				) : null}
				{presets.status === "error" ? (
					<Notice
						tone="danger"
						icon={<AppIcon size={16} name="circle-alert" />}
						action={
							<Button size="sm" variant="secondary" onClick={presets.reload}>
								Retry loading presets
							</Button>
						}
					>
						Saved presets could not be read or decoded. They were not changed.
					</Notice>
				) : null}
				{presets.writeError ? (
					<Notice
						tone="danger"
						icon={<AppIcon size={16} name="circle-alert" />}
						action={
							<Button size="sm" variant="secondary" onClick={presets.retryWrite}>
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
				{providerSearch.notice ? (
					<Notice tone="info" icon={<AppIcon size={16} name="info" />}>
						{providerSearch.notice}
					</Notice>
				) : null}
				{providerSearch.failed ? (
					<Notice
						tone="danger"
						icon={<AppIcon size={16} name="circle-alert" />}
						action={
							<Button
								size="sm"
								variant="secondary"
								onClick={providerSearch.open}
								disabled={providerSearch.pending}
							>
								Try again
							</Button>
						}
					>
						The provider search could not be completed. Your selection is unchanged.
					</Notice>
				) : null}
				<ManagedAssetProvider
					assets={managedAssetBatch(visibleExercises.map(({ images }) => images?.[0]))}
				>
					<div role="region" className="grid" aria-label="Exercise library">
						{exercises.isPending && exerciseItems.length === 0 ? (
							<div role="status" className="grid gap-2" aria-label="Loading exercises">
								{[0, 1, 2].map((index) => (
									<Skeleton key={index} className="h-14" />
								))}
							</div>
						) : null}
						{exercises.isError && !invalidCursor ? (
							<Notice
								tone="danger"
								icon={<AppIcon size={16} name="circle-alert" />}
								action={
									<Button size="sm" variant="secondary" onClick={exercises.retry}>
										Retry
									</Button>
								}
							>
								Exercises could not be loaded.
							</Notice>
						) : null}
						{noMatches ? (
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
						{visibleExercises.map((exercise) => (
							<ExerciseOption
								key={exercise.id}
								exercise={exercise}
								replacing={replacing}
								selected={selectedIds.has(exercise.id)}
								onToggle={() => toggleExercise(exercise)}
								disabled={
									exercise.kind === null ||
									(replacement !== undefined && exercise.kind !== replacement.kind)
								}
							/>
						))}
						<div className="grid gap-2 pt-3.5">
							{exercises.hasNextPage && !invalidCursor && !exercises.isError ? (
								<LoadMoreButton
									variant="ghost"
									label="Show more"
									disabled={exercises.isFetching}
									onClick={exercises.fetchNextPage}
									isFetchingNextPage={exercises.isFetchingNextPage}
								/>
							) : null}
							<Button
								onClick={providerSearch.open}
								disabled={providerSearch.pending}
								variant={
									visibleExercises.length === 0 && !exercises.isPending ? "primary" : "outline"
								}
							>
								{providerSearch.pending ? (
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
		</EditorSheet>
	);
}

function ExerciseOption(props: {
	readonly selected: boolean;
	readonly disabled: boolean;
	readonly replacing: boolean;
	readonly onToggle: () => void;
	readonly exercise: PickerExercise;
}) {
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
			<AssetArtWell
				name={props.exercise.name}
				className="size-11 shrink-0"
				asset={props.exercise.images?.[0]}
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
