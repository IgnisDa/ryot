import { Button, Group, NumberInput, Stack } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useState } from "react";
import {
	createLogEventPayload,
	createProgressEventPayload,
	type MediaSearchLogDateOption,
} from "~/features/entities/search-modal-media-actions";
import {
	defaultSearchResultRowActionState,
	type SearchResultRowActionState,
} from "~/features/entities/search-result-row";
import { SearchResultLogPanel } from "~/features/entities/search-result-row-panels";
import { useEventSchemasQuery } from "~/features/event-schemas/hooks";
import { useApiClient } from "~/hooks/api";
import { useThemeTokens } from "~/hooks/theme";

interface ContinueLoggingModalContentProps {
	modalId: string;
	entityId: string;
	accentColor: string;
	onSaved: () => void;
	entitySchemaId: string;
	initialPercent: number | null;
}

export function ContinueLoggingModalContent(
	props: ContinueLoggingModalContentProps,
) {
	const apiClient = useApiClient();
	const [progressPercent, setProgressPercent] = useState<number | string>(
		props.initialPercent ?? "",
	);
	const createEvents = apiClient.useMutation("post", "/events");
	const eventSchemasQuery = useEventSchemasQuery(
		props.entitySchemaId,
		!!props.entitySchemaId,
	);

	const isValid =
		typeof progressPercent === "number" &&
		progressPercent > 0 &&
		progressPercent <= 100 &&
		progressPercent !== props.initialPercent;

	const handleSave = async () => {
		try {
			const payload = createProgressEventPayload({
				entityId: props.entityId,
				progressPercent: progressPercent as number,
				eventSchemas: eventSchemasQuery.eventSchemas,
			});
			await createEvents.mutateAsync({ body: payload });
			modals.close(props.modalId);
			props.onSaved();
		} catch (error) {
			notifications.show({
				color: "red",
				title: "Could not log progress",
				message: error instanceof Error ? error.message : "Please try again.",
			});
		}
	};

	return (
		<Stack gap="sm">
			<NumberInput
				min={1}
				step={1}
				max={100}
				size="xs"
				suffix="%"
				label="Progress"
				value={progressPercent}
				onChange={setProgressPercent}
				description="Enter your current progress (1–100%)"
				styles={{
					input: { fontFamily: "var(--mantine-font-family-monospace)" },
				}}
			/>
			<Group gap="xs">
				<Button
					size="compact-xs"
					loading={createEvents.isPending}
					onClick={() => void handleSave()}
					disabled={!isValid || createEvents.isPending}
					style={{ backgroundColor: props.accentColor, color: "white" }}
				>
					Save
				</Button>
				<Button
					variant="subtle"
					size="compact-xs"
					onClick={() => modals.close(props.modalId)}
				>
					Cancel
				</Button>
			</Group>
		</Stack>
	);
}

interface StartLoggingModalContentProps {
	modalId: string;
	entityId: string;
	accentColor: string;
	onSaved: () => void;
	entitySchemaId: string;
}

export function StartLoggingModalContent(props: StartLoggingModalContentProps) {
	const t = useThemeTokens();
	const apiClient = useApiClient();
	const [logDate, setLogDate] = useState<MediaSearchLogDateOption>("now");
	const [logStartedOn, setLogStartedOn] = useState("");
	const [logCompletedOn, setLogCompletedOn] = useState("");
	const createEvents = apiClient.useMutation("post", "/events");
	const eventSchemasQuery = useEventSchemasQuery(
		props.entitySchemaId,
		!!props.entitySchemaId,
	);

	const actionState: SearchResultRowActionState = {
		...defaultSearchResultRowActionState,
		logDate,
		logStartedOn,
		logCompletedOn,
		openPanel: "log",
	};

	const handlePatchActionState = (
		patch: Partial<SearchResultRowActionState>,
	) => {
		if (patch.logDate !== undefined) {
			setLogDate(patch.logDate);
		}
		if (patch.logStartedOn !== undefined) {
			setLogStartedOn(patch.logStartedOn);
		}
		if (patch.logCompletedOn !== undefined) {
			setLogCompletedOn(patch.logCompletedOn);
		}
		if ("openPanel" in patch && patch.openPanel === null) {
			modals.close(props.modalId);
		}
	};

	const handleSave = async () => {
		try {
			const payload = createLogEventPayload({
				logDate,
				startedOn: logStartedOn,
				entityId: props.entityId,
				completedOn: logCompletedOn,
				eventSchemas: eventSchemasQuery.eventSchemas,
			});
			await createEvents.mutateAsync({ body: payload });
			modals.close(props.modalId);
			props.onSaved();
		} catch (error) {
			notifications.show({
				color: "red",
				title: "Could not log progress",
				message: error instanceof Error ? error.message : "Please try again.",
			});
		}
	};

	return (
		<SearchResultLogPanel
			border={t.border}
			textMuted={t.textMuted}
			actionState={actionState}
			accentColor={props.accentColor}
			onSaveLog={() => void handleSave()}
			onPatchActionState={handlePatchActionState}
		/>
	);
}
