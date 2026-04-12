import { SimpleGrid, Stack, Text, UnstyledButton } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
	SearchEntityModalContent,
	SearchEntityModalTitle,
} from "~/features/entities/search-modal";
import type { AppEntitySchema } from "~/features/entity-schemas/model";
import { TrackerIcon } from "~/features/trackers/icons";
import { useThemeTokens } from "~/hooks/theme";
import {
	ContinueLoggingModalContent,
	StartLoggingModalContent,
} from "./modals";

type ModalHandlersDeps = {
	trackerId: string;
	invalidateOverview: () => void;
	searchableSchemas: AppEntitySchema[];
};

export function useMediaOverviewModalHandlers(deps: ModalHandlersDeps) {
	const t = useThemeTokens();

	const openSearchModal = (schema: AppEntitySchema) => {
		const searchModalId = `builtin-media-search-${deps.trackerId}-${schema.id}`;

		modals.open({
			size: "lg",
			centered: true,
			modalId: searchModalId,
			overlayProps: { backgroundOpacity: 0.55, blur: 3 },
			children: (
				<SearchEntityModalContent
					entitySchema={schema}
					initialAction="backlog"
					onActionCompleted={deps.invalidateOverview}
				/>
			),
			title: (
				<SearchEntityModalTitle
					actionVerb="Queue"
					entitySchemaName={schema.name}
					onBack={() => modals.close(searchModalId)}
				/>
			),
		});
	};

	const handleStartItem = (
		entityId: string,
		entitySchemaId: string,
		accentColor: string,
	) => {
		const startModalId = `builtin-media-start-${entityId}`;
		modals.open({
			size: "md",
			centered: true,
			modalId: startModalId,
			overlayProps: { backgroundOpacity: 0.55, blur: 3 },
			title: (
				<Text ff="var(--mantine-headings-font-family)" fw={600} fz="md">
					Log progress
				</Text>
			),
			children: (
				<StartLoggingModalContent
					entityId={entityId}
					modalId={startModalId}
					accentColor={accentColor}
					entitySchemaId={entitySchemaId}
					onSaved={deps.invalidateOverview}
				/>
			),
		});
	};

	const handleContinueItem = (
		entityId: string,
		accentColor: string,
		entitySchemaId: string,
		initialPercent: number | null,
	) => {
		const continueModalId = `builtin-media-continue-${entityId}`;
		modals.open({
			size: "sm",
			centered: true,
			modalId: continueModalId,
			overlayProps: { backgroundOpacity: 0.55, blur: 3 },
			title: (
				<Text ff="var(--mantine-headings-font-family)" fw={600} fz="md">
					Log progress
				</Text>
			),
			children: (
				<ContinueLoggingModalContent
					entityId={entityId}
					modalId={continueModalId}
					accentColor={accentColor}
					entitySchemaId={entitySchemaId}
					initialPercent={initialPercent}
					onSaved={deps.invalidateOverview}
				/>
			),
		});
	};

	const ENTITY_SUBTITLES: Record<string, string> = {
		book: "Log books you've read",
		movie: "Log films you've seen",
		music: "Rate albums and tracks",
		anime: "Watch and follow series",
		"comic-book": "Track your issues",
		manga: "Follow volumes and series",
		person: "Follow creators and cast",
		show: "Track episodes and seasons",
		audiobook: "Listen to spoken books",
		"visual-novel": "Track your reading",
		podcast: "Subscribe and log episodes",
		"video-game": "Log your play sessions",
	};

	const openTypePickerModal = () => {
		const typePickerModalId = `builtin-media-type-picker-${deps.trackerId}`;

		modals.open({
			size: "lg",
			centered: true,
			modalId: typePickerModalId,
			overlayProps: { backgroundOpacity: 0.55, blur: 3 },
			title: (
				<Text ff="var(--mantine-headings-font-family)" fw={600} fz="md">
					Track something
				</Text>
			),
			children: (
				<SimpleGrid cols={{ base: 3, sm: 4 }} spacing="sm">
					{deps.searchableSchemas.map((schema) => {
						return (
							<UnstyledButton
								key={schema.id}
								onClick={() => openSearchModal(schema)}
							>
								<Stack gap={6} align="center">
									<TrackerIcon
										size={24}
										icon={schema.icon}
										color={schema.accentColor}
									/>
									<Text
										fz="xs"
										fw={600}
										c={t.textPrimary}
										ff="var(--mantine-headings-font-family)"
									>
										{schema.name}
									</Text>
									<Text fz={10} c={t.textMuted}>
										{ENTITY_SUBTITLES[schema.slug] ??
											`Search and track ${schema.name.toLowerCase()}`}
									</Text>
								</Stack>
							</UnstyledButton>
						);
					})}
				</SimpleGrid>
			),
		});
	};

	return { handleStartItem, handleContinueItem, openTypePickerModal };
}
