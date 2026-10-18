import { Button, Card, Field, MenuButton, MultiSelect, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import type { RefObject } from "react";

import {
	exerciseForces,
	type ExerciseKind,
	exerciseKinds,
	exerciseLevels,
	exerciseMechanics,
} from "../../shared/exercise-kinds";
import {
	capitalize,
	labelForKind,
	maxPickerPresets,
	type PickerFilters,
	type PickerPreset,
	type PickerSort,
	sortLabels,
	sortOrder,
} from "./picker-model";

const chip =
	"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill border border-border-emphasis bg-surface px-3 text-[13px] font-medium whitespace-nowrap hover:bg-hover pointer-coarse:h-10";

const chevron = <AppIcon size={13} name="chevron-down" />;

type FilterOption = { readonly id: string; readonly name: string };

const optionChoices = (options: readonly FilterOption[] | undefined) =>
	(options ?? []).map(({ id, name }) => ({ value: id, label: name }));

const literalChoices = <Value extends string>(values: readonly Value[]) =>
	values.map((value) => ({ value, label: capitalize(value) }));

export function PickerToolbar({
	searchRef,
	...props
}: {
	readonly search: string;
	readonly sort: PickerSort;
	readonly activePresetId: string;
	readonly filters: PickerFilters;
	readonly canWritePresets: boolean;
	readonly presetsFull: boolean;
	readonly presets: readonly PickerPreset[];
	readonly searchRef: RefObject<HTMLInputElement | null>;
	readonly replacementKind: ExerciseKind | undefined;
	readonly options:
		| {
				readonly targets: readonly FilterOption[];
				readonly equipment: readonly FilterOption[];
				readonly collections: readonly FilterOption[];
		  }
		| undefined;
	readonly onSearch: (search: string) => void;
	readonly onSort: (sort: PickerSort) => void;
	readonly onSavePreset: () => void;
	readonly onDeletePreset: () => void;
	readonly onApplyPreset: (id: string) => void;
	readonly onFilter: <Key extends keyof PickerFilters>(key: Key, value: PickerFilters[Key]) => void;
}) {
	const { filters, options, onFilter } = props;
	const appliedPreset = props.presets.find(({ id }) => id === props.activePresetId);
	return (
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
					maxLength={512}
					ref={searchRef}
					autoComplete="off"
					value={props.search}
					className="w-full pl-9"
					aria-label="Search exercises"
					placeholder="Search your library"
					onChange={(event) => props.onSearch(event.currentTarget.value)}
				/>
			</div>
			<div
				role="toolbar"
				aria-label="Filters"
				className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none]"
			>
				<MenuButton
					label="Sort exercises"
					items={sortOrder.map((value) => ({
						key: value,
						onSelect: () => props.onSort(value),
						label: value === props.sort ? `${sortLabels[value]} ✓` : sortLabels[value],
					}))}
					renderTrigger={(trigger) => (
						<button {...trigger} type="button" className={chip} aria-label="Sort exercises">
							<AppIcon size={14} name="arrow-up-down" />
							{sortLabels[props.sort]}
							{chevron}
						</button>
					)}
				/>
				{props.replacementKind === undefined ? (
					<MultiSelect
						label="Kind"
						variant="chip"
						selected={filters.kinds}
						onChange={(kinds) => onFilter("kinds", kinds)}
						choices={exerciseKinds.map((value) => ({ value, label: labelForKind(value) }))}
					/>
				) : (
					<span className={clsx(chip, "border-accent-border bg-accent-soft text-accent-text")}>
						{labelForKind(props.replacementKind)}
					</span>
				)}
				<MultiSelect
					label="Target"
					variant="chip"
					selected={filters.targetIds}
					choices={optionChoices(options?.targets)}
					onChange={(targetIds) => onFilter("targetIds", targetIds)}
				/>
				<MultiSelect
					variant="chip"
					label="Equipment"
					selected={filters.equipmentIds}
					choices={optionChoices(options?.equipment)}
					onChange={(equipmentIds) => onFilter("equipmentIds", equipmentIds)}
				/>
				<MultiSelect
					variant="chip"
					label="Collection"
					selected={filters.collectionIds}
					choices={optionChoices(options?.collections)}
					onChange={(collectionIds) => onFilter("collectionIds", collectionIds)}
				/>
				<MultiSelect
					label="Force"
					variant="chip"
					selected={filters.forces}
					choices={literalChoices(exerciseForces)}
					onChange={(forces) => onFilter("forces", forces)}
				/>
				<MultiSelect
					label="Level"
					variant="chip"
					selected={filters.levels}
					choices={literalChoices(exerciseLevels)}
					onChange={(levels) => onFilter("levels", levels)}
				/>
				<MultiSelect
					variant="chip"
					label="Mechanics"
					selected={filters.mechanics}
					choices={literalChoices(exerciseMechanics)}
					onChange={(mechanics) => onFilter("mechanics", mechanics)}
				/>
				{props.replacementKind === undefined ? (
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
								{chevron}
							</button>
						)}
						items={[
							...props.presets.map(({ id, name }) => ({
								key: id,
								onSelect: () => props.onApplyPreset(id),
								label: id === props.activePresetId ? `${name} ✓` : name,
							})),
							{
								key: "save",
								onSelect: props.onSavePreset,
								label: "Save current filters…",
								disabled: !props.canWritePresets || props.presetsFull,
							},
							...(appliedPreset === undefined
								? []
								: [
										{
											key: "delete",
											destructive: true,
											onSelect: props.onDeletePreset,
											disabled: !props.canWritePresets,
											label: `Delete ${appliedPreset.name}`,
										},
									]),
						]}
					/>
				) : null}
			</div>
		</div>
	);
}

export function PresetForm(props: {
	readonly name: string;
	readonly used: number;
	readonly nameError: boolean;
	readonly canSave: boolean;
	readonly onCancel: () => void;
	readonly onSave: () => void;
	readonly onName: (name: string) => void;
}) {
	return (
		<Card className="grid gap-2.5 p-3">
			<Field
				label="Preset name"
				error={props.nameError ? "Enter a name with 1 to 80 characters." : undefined}
				hint={`Saves search, filters and sort on this device. ${props.used} of ${maxPickerPresets} used.`}
			>
				{(control) => (
					<TextField
						{...control}
						maxLength={80}
						value={props.name}
						onChange={(event) => props.onName(event.currentTarget.value)}
					/>
				)}
			</Field>
			<div className="flex justify-end gap-2">
				<Button size="sm" variant="ghost" onClick={props.onCancel}>
					Cancel
				</Button>
				<Button size="sm" onClick={props.onSave} disabled={!props.canSave}>
					Save preset
				</Button>
			</div>
		</Card>
	);
}
