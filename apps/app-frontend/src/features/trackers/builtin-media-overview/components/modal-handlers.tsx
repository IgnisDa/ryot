import { SimpleGrid, Stack, Text, UnstyledButton } from "@mantine/core";
import { useHover } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import {
	SearchEntityModalContent,
	SearchEntityModalTitle,
} from "~/features/entities/search-modal";
import type { AppEntitySchema } from "~/features/entity-schemas/model";
import { TrackerIcon } from "~/features/trackers/icons";
import { useThemeTokens } from "~/hooks/theme";
import { colorMix, STONE } from "../shared";
import {
	ContinueLoggingModalContent,
	StartLoggingModalContent,
} from "./modals";

function TypePickerCard(props: {
	schema: AppEntitySchema;
	onSelect: () => void;
	t: ReturnType<typeof useThemeTokens>;
}) {
	const { hovered, ref } = useHover();
	const accent = props.schema.accentColor ?? STONE;

	return (
		<UnstyledButton
			ref={ref}
			onClick={props.onSelect}
			style={{
				padding: "14px 8px",
				borderRadius: "var(--mantine-radius-md)",
				transition: "background 140ms ease, border-color 140ms ease",
				background: colorMix(accent, hovered ? 0.15 : 0.07),
				border: `1px solid ${colorMix(accent, hovered ? 0.45 : 0.2)}`,
			}}
		>
			<Stack gap={8} align="center">
				<TrackerIcon size={28} icon={props.schema.icon} color={accent} />
				<Text
					fz="xs"
					fw={600}
					ta="center"
					c={props.t.textPrimary}
					ff="var(--mantine-headings-font-family)"
				>
					{props.schema.name}
				</Text>
			</Stack>
		</UnstyledButton>
	);
}

function TypePickerGrid(props: {
	schemas: AppEntitySchema[];
	onSelect: (schema: AppEntitySchema) => void;
	t: ReturnType<typeof useThemeTokens>;
}) {
	return (
		<SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
			{props.schemas.map((schema) => (
				<TypePickerCard
					t={props.t}
					key={schema.id}
					schema={schema}
					onSelect={() => props.onSelect(schema)}
				/>
			))}
		</SimpleGrid>
	);
}

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
				<TypePickerGrid
					t={t}
					onSelect={openSearchModal}
					schemas={deps.searchableSchemas}
				/>
			),
		});
	};

	return { handleStartItem, handleContinueItem, openTypePickerModal };
}
