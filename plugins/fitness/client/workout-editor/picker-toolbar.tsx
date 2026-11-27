import { type DisplayText, type Text, useDisplayText } from "@ryot-app/plugin-client-sdk/react";
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
import { useExerciseLabels, useFitnessMessages } from "../messages";
import {
	maxPickerPresets,
	type PickerFilters,
	type PickerPreset,
	type PickerSort,
	sortLabel,
	sortOrder,
} from "./picker-model";

const chip =
	"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill border border-border-emphasis bg-surface px-3 text-[13px] font-medium whitespace-nowrap hover:bg-hover pointer-coarse:h-10";

const chevron = <AppIcon size={13} name="chevron-down" />;

type FilterOption = { readonly id: string; readonly name: string };

const optionChoices = (
	displayText: (text: DisplayText) => Text,
	options: undefined | readonly FilterOption[],
) => (options ?? []).map(({ id, name }) => ({ value: id, label: displayText(name) }));

export function PresetForm(props: {
	readonly name: string;
	readonly used: number;
	readonly canSave: boolean;
	readonly nameError: boolean;
	readonly onSave: () => void;
	readonly onCancel: () => void;
	readonly onName: (name: string) => void;
}) {
	const text = useFitnessMessages();
	return (
		<Card className="grid gap-2.5 p-3">
			<Field
				label={text("client.presets.name")}
				error={props.nameError ? text("client.presets.name-error") : undefined}
				hint={text("client.presets.hint", { used: props.used, max: maxPickerPresets })}
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
					{text("common.action.cancel")}
				</Button>
				<Button size="sm" onClick={props.onSave} disabled={!props.canSave}>
					{text("client.presets.save")}
				</Button>
			</div>
		</Card>
	);
}

export function PickerToolbar({
	searchRef,
	...props
}: {
	readonly search: string;
	readonly sort: PickerSort;
	readonly presetsFull: boolean;
	readonly activePresetId: string;
	readonly filters: PickerFilters;
	readonly canWritePresets: boolean;
	readonly onSavePreset: () => void;
	readonly onDeletePreset: () => void;
	readonly presets: readonly PickerPreset[];
	readonly onSearch: (search: string) => void;
	readonly onSort: (sort: PickerSort) => void;
	readonly onApplyPreset: (id: string) => void;
	readonly replacementKind: undefined | ExerciseKind;
	readonly searchRef: RefObject<null | HTMLInputElement>;
	readonly onFilter: <Key extends keyof PickerFilters>(key: Key, value: PickerFilters[Key]) => void;
	readonly options:
		| undefined
		| {
				readonly targets: readonly FilterOption[];
				readonly equipment: readonly FilterOption[];
				readonly collections: readonly FilterOption[];
		  };
}) {
	const displayText = useDisplayText();
	const text = useFitnessMessages();
	const labels = useExerciseLabels();
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
					aria-label={text("client.picker.search")}
					placeholder={text("client.picker.search-placeholder")}
					onChange={(event) => props.onSearch(event.currentTarget.value)}
				/>
			</div>
			<div
				role="toolbar"
				aria-label={text("client.picker.filters")}
				className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none]"
			>
				<MenuButton
					label={text("client.picker.sort-label")}
					triggerElement={
						<button type="button" className={chip} aria-label={text("client.picker.sort-label")}>
							<AppIcon size={14} name="arrow-up-down" />
							{sortLabel(text, props.sort)}
							{chevron}
						</button>
					}
					items={sortOrder.map((value) => ({
						key: value,
						onSelect: () => props.onSort(value),
						label:
							value === props.sort
								? text("client.picker.checked", { label: sortLabel(text, value) })
								: sortLabel(text, value),
					}))}
				/>
				{props.replacementKind === undefined ? (
					<MultiSelect
						variant="chip"
						selected={filters.kinds}
						label={text("property.kind")}
						onChange={(kinds) => onFilter("kinds", kinds)}
						choices={exerciseKinds.map((value) => ({ value, label: labels.kind(value) }))}
					/>
				) : (
					<span className={clsx(chip, "border-accent-border bg-accent-soft text-accent-text")}>
						{labels.kind(props.replacementKind)}
					</span>
				)}
				<MultiSelect
					variant="chip"
					selected={filters.targetIds}
					label={text("property.target")}
					choices={optionChoices(displayText, options?.targets)}
					onChange={(targetIds) => onFilter("targetIds", targetIds)}
				/>
				<MultiSelect
					variant="chip"
					selected={filters.equipmentIds}
					label={text("browse.field.equipment")}
					choices={optionChoices(displayText, options?.equipment)}
					onChange={(equipmentIds) => onFilter("equipmentIds", equipmentIds)}
				/>
				<MultiSelect
					variant="chip"
					selected={filters.collectionIds}
					label={text("client.picker.collection")}
					choices={optionChoices(displayText, options?.collections)}
					onChange={(collectionIds) => onFilter("collectionIds", collectionIds)}
				/>
				<MultiSelect
					variant="chip"
					selected={filters.forces}
					label={text("property.force")}
					onChange={(forces) => onFilter("forces", forces)}
					choices={exerciseForces.map((value) => ({ value, label: labels.force(value) }))}
				/>
				<MultiSelect
					variant="chip"
					selected={filters.levels}
					label={text("property.level")}
					onChange={(levels) => onFilter("levels", levels)}
					choices={exerciseLevels.map((value) => ({ value, label: labels.level(value) }))}
				/>
				<MultiSelect
					variant="chip"
					selected={filters.mechanics}
					label={text("client.picker.mechanics")}
					onChange={(mechanics) => onFilter("mechanics", mechanics)}
					choices={exerciseMechanics.map((value) => ({ value, label: labels.mechanic(value) }))}
				/>
				{props.replacementKind === undefined ? (
					<MenuButton
						label={text("client.presets.title")}
						triggerElement={
							<button
								type="button"
								aria-label={text("client.presets.title")}
								className={clsx(
									chip,
									appliedPreset !== undefined &&
										"border-accent-border bg-accent-soft text-accent-text",
								)}
							>
								<AppIcon size={14} name="layers-3" />
								{appliedPreset?.name ?? text("client.presets.title")}
								{chevron}
							</button>
						}
						items={[
							...props.presets.map(({ id, name }) => ({
								key: id,
								onSelect: () => props.onApplyPreset(id),
								label:
									id === props.activePresetId
										? text("client.picker.checked", { label: name })
										: displayText(name),
							})),
							{
								key: "save",
								onSelect: props.onSavePreset,
								label: text("client.presets.save-current"),
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
											label: text("client.supersets.delete-label", { name: appliedPreset.name }),
										},
									]),
						]}
					/>
				) : null}
			</div>
		</div>
	);
}
