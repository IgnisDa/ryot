import { Button, Card, Group, Stack, Text } from "@mantine/core";
import { Dropzone, type DropzoneProps } from "@mantine/dropzone";
import { IconPhoto, IconUpload, IconX } from "@tabler/icons-react";

type FileDropzoneProps = {
	files: File[];
	onClear?: () => void;
	description?: string;
	instructions?: string;
	accept: DropzoneProps["accept"];
	onDrop: (files: File[]) => void;
};

export const FileDropzone = (props: FileDropzoneProps) => {
	const files = props.files || [];
	const instructions =
		props.instructions || "Drag files here or click to select files";

	const handleClear = () => {
		if (props.onClear) props.onClear();
		else props.onDrop([]);
	};

	return (
		<Card>
			<Stack gap="xs">
				<Dropzone
					multiple
					accept={props.accept}
					onDrop={(dropzoneFiles) => props.onDrop(dropzoneFiles)}
				>
					<Group
						gap="xl"
						mih={120}
						justify="center"
						style={{ pointerEvents: "none" }}
					>
						<Dropzone.Accept>
							<IconUpload size={48} stroke={1.5} />
						</Dropzone.Accept>
						<Dropzone.Reject>
							<IconX size={48} stroke={1.5} />
						</Dropzone.Reject>
						<Dropzone.Idle>
							<IconPhoto size={48} stroke={1.5} />
						</Dropzone.Idle>
						<Stack gap={4} align="center">
							<Text size="lg">{instructions}</Text>
							{props.description ? (
								<Text size="sm" c="dimmed">
									{props.description}
								</Text>
							) : null}
						</Stack>
					</Group>
				</Dropzone>
				{files.length ? (
					<Stack gap={4}>
						{files.map((file, index) => (
							<Text key={`${file.name}-${index}`} size="sm">
								{file.name}
							</Text>
						))}
						<Group justify="flex-end">
							<Button variant="light" size="xs" onClick={handleClear}>
								Clear selection
							</Button>
						</Group>
					</Stack>
				) : null}
			</Stack>
		</Card>
	);
};
