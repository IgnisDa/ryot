import {
	ActionIcon,
	Card,
	FileInput,
	Image,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
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

type CustomEntityImageInputProps = {
	files: File[];
	description?: string;
	instructions?: string;
	onDrop: (files: File[]) => void;
};

export const CustomEntityImageInput = (props: CustomEntityImageInputProps) => {
	const files = props.files || [];
	const instructions = props.instructions || "Select files to upload";

	const handleChange = (value: File | File[] | null) => {
		if (value === null) {
			props.onDrop([]);
			return;
		}

		if (Array.isArray(value)) {
			props.onDrop(value);
			return;
		}

		props.onDrop([value]);
	};

	return (
		<Card>
			<Stack gap="xs">
				<Stack gap={4}>
					<Text size="lg">{instructions}</Text>
					{props.description ? (
						<Text size="sm" c="dimmed">
							{props.description}
						</Text>
					) : null}
				</Stack>
				<FileInput
					multiple
					accept="image/*"
					onChange={handleChange}
					value={files.length ? files : undefined}
				/>
			</Stack>
		</Card>
	);
};
