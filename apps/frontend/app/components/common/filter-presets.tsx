import { Button, Chip, Group, Modal, Stack, TextInput } from "@mantine/core";
import { useLongPress } from "@mantine/hooks";
import { useState } from "react";

export const CreateFilterPresetModal = (props: {
	opened: boolean;
	onClose: () => void;
	onSave: (name: string) => void;
	placeholder?: string;
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

export const FilterPresetChip = (props: {
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
