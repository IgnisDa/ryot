import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	Button,
	Chip,
	Group,
	Modal,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useLongPress } from "@mantine/hooks";
import { useState } from "react";
import type { useFilterPresets } from "~/lib/hooks/filters/use-presets";

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
				<Text c="dimmed" size="xs" ta="right">
					Hint: Long press on a preset to delete it.
				</Text>

				<Group justify="flex-end">
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

export const FilterPresetModalManager = (props: {
	opened: boolean;
	onClose: () => void;
	placeholder?: string;
	presetManager: ReturnType<typeof useFilterPresets>;
}) => (
	<CreateFilterPresetModal
		opened={props.opened}
		onClose={props.onClose}
		placeholder={props.placeholder}
		onSave={props.presetManager.createSaveHandler(props.onClose)}
	/>
);

const FilterPresetChip = (props: {
	id: string;
	name: string;
	onDelete: (id: string, name: string) => void;
}) => {
	const longPressHandlers = useLongPress(() =>
		props.onDelete(props.id, props.name),
	);
	return (
		<Chip size="sm" value={props.id} wrapperProps={{ ...longPressHandlers }}>
			{props.name}
		</Chip>
	);
};

export const FilterPresetBar = (props: {
	presetManager: ReturnType<typeof useFilterPresets>;
}) => {
	const [parent] = useAutoAnimate();
	const presets = props.presetManager.filterPresets;
	if (!presets || presets.response.length === 0) return null;

	return (
		<Chip.Group
			value={props.presetManager.activePresetId || undefined}
			key={props.presetManager.activePresetId || "no-filter-preset"}
			onChange={(value) => {
				if (!value) return;
				const preset = presets.response.find((p) => p.id === value);
				if (preset) props.presetManager.applyPreset(preset.id, preset.filters);
			}}
		>
			<Group gap="xs" ref={parent} wrap="nowrap" style={{ overflowX: "auto" }}>
				{presets.response.map((preset) => (
					<FilterPresetChip
						id={preset.id}
						key={preset.id}
						name={preset.name}
						onDelete={props.presetManager.deletePreset}
					/>
				))}
			</Group>
		</Chip.Group>
	);
};
