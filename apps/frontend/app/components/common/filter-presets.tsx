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
import { hasLength, useForm } from "@mantine/form";
import { useLongPress } from "@mantine/hooks";
import type { useFilterPresets } from "~/lib/hooks/filters/use-presets";

export const CreateFilterPresetModal = (props: {
	opened: boolean;
	onClose: () => void;
	placeholder: string;
	onSave: (name: string) => void;
}) => {
	const form = useForm({
		mode: "uncontrolled",
		initialValues: { name: "" },
		validate: {
			name: hasLength({ min: 3 }, "Must be at least 3 characters"),
		},
	});

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			title="Save filter as preset"
		>
			<form
				onSubmit={form.onSubmit((values) => {
					props.onSave(values.name);
					form.reset();
				})}
			>
				<Stack>
					<TextInput
						data-autofocus
						label="Preset Name"
						placeholder={props.placeholder}
						{...form.getInputProps("name")}
					/>
					<Text c="dimmed" size="xs" ta="right">
						Hint: Long press on a preset to delete it.
					</Text>

					<Group justify="flex-end">
						<Button variant="default" onClick={props.onClose}>
							Cancel
						</Button>
						<Button type="submit">Save Preset</Button>
					</Group>
				</Stack>
			</form>
		</Modal>
	);
};

export const FilterPresetModalManager = (props: {
	opened: boolean;
	onClose: () => void;
	placeholder: string;
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
		<Chip
			size="sm"
			value={props.id}
			style={{ userSelect: "none" }}
			wrapperProps={{ ...longPressHandlers }}
		>
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
