import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Button, Chip, Group, Modal, Stack, TextInput } from "@mantine/core";
import { useLongPress } from "@mantine/hooks";
import type { FilterPresetsQuery } from "@ryot/generated/graphql/backend/graphql";
import { useState } from "react";

export const CreateFilterPresetModal = (props: {
	opened: boolean;
	onClose: () => void;
	placeholder?: string;
	onSave: (name: string) => void;
}) => {
	const [presetName, setPresetName] = useState("");

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			title="Save Filter Preset"
		>
			<Stack>
				<TextInput
					data-autofocus
					value={presetName}
					label="Preset Name"
					placeholder={props.placeholder || "e.g., My Preset"}
					onChange={(e) => setPresetName(e.currentTarget.value)}
				/>

				<Group justify="flex-end" mt="md">
					<Button variant="default" onClick={props.onClose}>
						Cancel
					</Button>
					<Button
						disabled={!presetName.trim()}
						onClick={() => {
							if (presetName.trim()) {
								props.onSave(presetName.trim());
								setPresetName("");
							}
						}}
					>
						Save Preset
					</Button>
				</Group>
			</Stack>
		</Modal>
	);
};

const FilterPresetChip = (props: {
	id: string;
	name: string;
	onDelete: (id: string, name: string) => void;
}) => {
	const longPressHandlers = useLongPress(() =>
		props.onDelete(props.id, props.name),
	);
	return (
		<Chip size="sm" value={props.id} {...longPressHandlers}>
			{props.name}
		</Chip>
	);
};

type FilterPresetsResponse = FilterPresetsQuery["filterPresets"];

export const FilterPresetBar = (props: {
	activePresetId: string | null;
	filterPresets?: FilterPresetsResponse;
	onDeletePreset: (presetId: string, presetName: string) => void;
	onSelectPreset: (presetId: string, presetFilters: unknown) => void;
}) => {
	const [parent] = useAutoAnimate();
	const presets = props.filterPresets;
	if (!presets || presets.response.length === 0) return null;

	return (
		<Chip.Group
			value={props.activePresetId || undefined}
			key={props.activePresetId || "no-filter-preset"}
			onChange={(value) => {
				if (!value) return;
				const preset = presets.response.find((p) => p.id === value);
				if (preset) props.onSelectPreset(preset.id, preset.filters);
			}}
		>
			<Group gap="xs" ref={parent} wrap="nowrap" style={{ overflowX: "auto" }}>
				{presets.response.map((preset) => (
					<FilterPresetChip
						id={preset.id}
						key={preset.id}
						name={preset.name}
						onDelete={props.onDeletePreset}
					/>
				))}
			</Group>
		</Chip.Group>
	);
};
