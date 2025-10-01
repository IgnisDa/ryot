import {
	ActionIcon,
	Button,
	Card,
	Group,
	Image,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { Dropzone, type DropzoneProps } from "@mantine/dropzone";
import { IconPhoto, IconUpload, IconX } from "@tabler/icons-react";
import { useS3PresignedUrls } from "~/lib/shared/hooks";

type ExistingImageListProps = {
	keys: string[];
	onRemove: (key: string) => void;
};

export function ExistingImageList(props: ExistingImageListProps) {
	const presignedUrls = useS3PresignedUrls(props.keys);

	if (props.keys.length === 0) return null;

	return (
		<Stack gap="xs">
			<Text size="sm" fw={500}>
				Existing images
			</Text>
			<SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
				{props.keys.map((key, index) => {
					const url = presignedUrls.data?.[index];
					return (
						<Card
							p="xs"
							key={key}
							withBorder
							radius="md"
							style={{ position: "relative" }}
						>
							<ActionIcon
								size="sm"
								color="red"
								variant="filled"
								onClick={() => props.onRemove(key)}
								style={{ position: "absolute", top: 8, right: 8 }}
							>
								<IconX size={14} />
							</ActionIcon>
							<Stack gap="xs">
								{url ? (
									<Image src={url} alt={key} radius="sm" h={160} fit="cover" />
								) : (
									<Text size="sm">{key}</Text>
								)}
							</Stack>
						</Card>
					);
				})}
			</SimpleGrid>
		</Stack>
	);
}

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
