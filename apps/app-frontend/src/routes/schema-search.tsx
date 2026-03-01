import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	Alert,
	Badge,
	Button,
	Card,
	Container,
	Grid,
	Image,
	Loader,
	NumberField,
	Select,
	Text,
	TextField,
	View,
} from "reshaped";
import { useApiClient } from "@/hooks/api";
import { useAuthClient } from "@/hooks/auth";

export const Route = createFileRoute("/schema-search")({
	component: SchemaSearchPage,
});

const getPayloadErrorMessage = (payload: unknown) => {
	if (
		!payload ||
		typeof payload !== "object" ||
		!Object.hasOwn(payload, "error")
	) {
		return null;
	}

	const { error } = payload as { error?: unknown };
	if (!error) return null;
	if (typeof error === "string") return error;
	if (typeof error !== "object") return "Request failed";
	if (!Object.hasOwn(error, "message")) return "Request failed";

	const { message } = error as { message?: unknown };
	return typeof message === "string" ? message : "Request failed";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const hasErrorPayload = (payload: unknown): payload is { error: unknown } =>
	isRecord(payload) && Object.hasOwn(payload, "error");

const hasSchemasData = (
	payload: unknown,
): payload is {
	data: Array<{
		scriptPairs: Array<{
			searchScriptId: string;
			detailsScriptId: string;
			searchScriptName: string;
		}>;
		name: string;
	}>;
} => isRecord(payload) && Array.isArray(payload.data);

const hasSearchResultData = (
	payload: unknown,
): payload is {
	data: Array<{
		title: string;
		identifier: string;
		image?: string | null;
		publishYear?: number | null;
	}>;
	meta: {
		total: number;
		page: number;
		hasMore: boolean;
	};
} =>
	isRecord(payload) &&
	Array.isArray(payload.data) &&
	isRecord(payload.meta) &&
	typeof payload.meta.total === "number" &&
	typeof payload.meta.page === "number" &&
	typeof payload.meta.hasMore === "boolean";

function SchemaSearchPage() {
	const apiClient = useApiClient();
	const authClient = useAuthClient();
	const navigate = Route.useNavigate();
	const [page, setPage] = useState(1);
	const [query, setQuery] = useState("harry potter");
	const [scriptFilter, setScriptFilter] = useState("");
	const [selectedSearchScriptId, setSelectedSearchScriptId] = useState("");
	const [importingIdentifier, setImportingIdentifier] = useState<string | null>(
		null,
	);

	const trimmedQuery = query.trim();

	useEffect(() => {
		void authClient.signIn.anonymous();
	}, [authClient]);

	const schemasQuery = useQuery({
		refetchOnMount: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
		queryKey: ["entity-schemas-list"],
		queryFn: async () => {
			const response = await apiClient["entity-schemas"].list.$get();
			const payload = await response.json();
			if (hasErrorPayload(payload)) {
				const errorMessage =
					getPayloadErrorMessage(payload) ?? "Request failed";
				throw new Error(errorMessage);
			}
			return payload;
		},
	});

	const schemasData = hasSchemasData(schemasQuery.data)
		? schemasQuery.data.data
		: [];

	const searchScripts = schemasData.flatMap((schema) =>
		schema.scriptPairs.map((pair) => ({
			value: pair.searchScriptId,
			label: `${schema.name} - ${pair.searchScriptName}`,
			detailsScriptId: pair.detailsScriptId,
		})),
	);

	const selectedSearchScript = searchScripts?.find(
		(script) => script.value === selectedSearchScriptId,
	);

	const normalizedScriptFilter = scriptFilter.trim().toLowerCase();

	const filteredSearchScripts = normalizedScriptFilter
		? searchScripts.filter((script) =>
				script.label.toLowerCase().includes(normalizedScriptFilter),
			)
		: searchScripts;

	const searchScriptOptions =
		selectedSearchScript &&
		!filteredSearchScripts.some(
			(script) => script.value === selectedSearchScript.value,
		)
			? [selectedSearchScript, ...filteredSearchScripts]
			: filteredSearchScripts;

	useEffect(() => {
		if (searchScripts.length > 0 && !selectedSearchScriptId) {
			setSelectedSearchScriptId(searchScripts[0].value);
		}
	}, [searchScripts, selectedSearchScriptId]);

	const searchRequest = useQuery({
		refetchOnMount: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
		enabled: Boolean(trimmedQuery && selectedSearchScriptId),
		queryKey: [
			"entity-schema-search",
			trimmedQuery,
			selectedSearchScriptId,
			page,
		],
		queryFn: async () => {
			if (!selectedSearchScriptId) throw new Error("No search script selected");

			const response = await apiClient["entity-schemas"].search.$post({
				json: {
					page,
					query: trimmedQuery,
					searchScriptId: selectedSearchScriptId,
				},
			});

			const payload = await response.json();
			if (hasErrorPayload(payload)) {
				const errorMessage =
					getPayloadErrorMessage(payload) ?? "Request failed";
				throw new Error(errorMessage);
			}

			return payload;
		},
	});

	const completedResult = hasSearchResultData(searchRequest.data)
		? searchRequest.data
		: null;
	const isSearching = searchRequest.isFetching || searchRequest.isPending;
	const loadingLabel = "Searching...";
	const searchError = searchRequest.error?.message;

	const importEntityRequest = useMutation({
		mutationFn: async (identifier: string) => {
			const detailsScriptId = selectedSearchScript?.detailsScriptId;
			if (!detailsScriptId) throw new Error("No details script available");

			const response = await apiClient["entity-schemas"].import.$post({
				json: { identifier, detailsScriptId },
			});

			const payload = await response.json();

			if (hasErrorPayload(payload))
				throw new Error("Import returned invalid payload");

			return payload.data.entityId;
		},
		onMutate: (identifier) => {
			setImportingIdentifier(identifier);
		},
		onSuccess: (entityId) => {
			void navigate({ params: { entityId }, to: "/entities/$entityId" });
		},
		onSettled: () => {
			setImportingIdentifier(null);
		},
	});

	const importError = importEntityRequest.error?.message;

	return (
		<div
			style={{
				minHeight: "100vh",
				background: "linear-gradient(180deg, #f7fafc 0%, #edf2f7 100%)",
			}}
		>
			<Container width="964px" padding={8}>
				<View gap={6}>
					<View gap={1}>
						<Text variant="title-2" as="h2">
							Entity Schema Search
						</Text>
						<Text color="neutral-faded">
							Search and import entities from various sources. Select a search
							script below to get started.
						</Text>
					</View>

					<View direction={{ s: "column", m: "row" }} gap={4} align="start">
						<View.Item grow>
							<TextField
								name="Query"
								value={query}
								onChange={(event) => setQuery(event.value)}
							/>
						</View.Item>
						<View.Item grow>
							<NumberField
								min={1}
								name="Page"
								value={page}
								onChange={(event) => setPage(Number(event.value) || 1)}
								increaseAriaLabel="Increase page"
								decreaseAriaLabel="Decrease page"
							/>
						</View.Item>
					</View>

					<Select
						name="Search Script"
						options={searchScriptOptions}
						value={selectedSearchScriptId}
						onChange={(event) => setSelectedSearchScriptId(event.value)}
						placeholder={
							schemasQuery.isPending
								? "Loading schemas..."
								: "Select a search script"
						}
						disabled={schemasQuery.isPending || !searchScripts.length}
					/>

					<TextField
						name="Search Script Filter"
						value={scriptFilter}
						onChange={(event) => setScriptFilter(event.value)}
						placeholder="Filter search scripts"
						disabled={schemasQuery.isPending || !searchScripts.length}
					/>

					{isSearching ? (
						<View direction="row" gap={3} align="center">
							<Loader size="small" />
							<Text variant="caption-1" color="neutral-faded">
								{loadingLabel}
							</Text>
						</View>
					) : null}

					{searchError ? (
						<Alert color="critical" title="Search failed">
							{searchError}
						</Alert>
					) : null}

					{importError ? (
						<Alert color="critical" title="Import failed">
							{importError}
						</Alert>
					) : null}

					{completedResult ? (
						<View direction="row" gap={2} wrap>
							<Badge color="primary" variant="faded">
								Total: {completedResult.meta.total}
							</Badge>
							<Badge color="positive" variant="faded">
								Next page:{" "}
								{completedResult.meta.hasMore
									? completedResult.meta.page + 1
									: "none"}
							</Badge>
						</View>
					) : null}

					<Grid columns={{ s: 1, m: 2 }} gap={4}>
						{completedResult?.data.map((item) => (
							<Grid.Item key={item.identifier}>
								<Card padding={4}>
									<View gap={3}>
										{item.image ? (
											<Image
												height={180}
												src={item.image}
												alt={item.title}
												displayMode="contain"
												borderRadius="small"
											/>
										) : null}
										<Text variant="title-4" as="h4">
											{item.title}
										</Text>
										<Text variant="caption-1" color="neutral-faded">
											Identifier: {item.identifier}
										</Text>
										<Text variant="caption-1" color="neutral-faded">
											Publish year: {item.publishYear ?? "unknown"}
										</Text>
										<Button
											variant="faded"
											disabled={importEntityRequest.isPending}
											loading={
												importEntityRequest.isPending &&
												importingIdentifier === item.identifier
											}
											onClick={() =>
												importEntityRequest.mutate(item.identifier)
											}
										>
											Import
										</Button>
									</View>
								</Card>
							</Grid.Item>
						))}
					</Grid>
				</View>
			</Container>
		</div>
	);
}
