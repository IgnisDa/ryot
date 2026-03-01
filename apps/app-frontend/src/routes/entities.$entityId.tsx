import {
	Alert,
	Anchor,
	Badge,
	Box,
	Card,
	Container,
	Group,
	Image,
	Loader,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useApiClient } from "@/hooks/api";
import { useAuthClient } from "@/hooks/auth";

export const Route = createFileRoute("/entities/$entityId")({
	component: EntityDetailPage,
});

const getErrorMessage = (payload: unknown) => {
	if (
		payload &&
		typeof payload === "object" &&
		"error" in payload &&
		typeof payload.error === "string"
	)
		return payload.error;

	return "Failed to load entity";
};

const toRecord = (value: unknown) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
};

const toStringValue = (value: unknown) => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
};

const toNumberValue = (value: unknown) => {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return value;
};

const toStringArray = (value: unknown) => {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(entry): entry is string =>
			typeof entry === "string" && entry.trim().length > 0,
	);
};

const toPeopleEntries = (value: unknown) => {
	if (!Array.isArray(value)) return [];

	const people = [] as Array<{
		role: string | null;
		source: string | null;
		identifier: string | null;
	}>;

	for (const person of value) {
		const record = toRecord(person);
		if (!record) continue;

		const role = toStringValue(record.role);
		const source = toStringValue(record.source);
		const identifier = toStringValue(record.identifier);
		if (!role && !source && !identifier) continue;

		people.push({ role, source, identifier });
	}

	return people;
};

function EntityDetailPage() {
	const params = Route.useParams();
	const apiClient = useApiClient();
	const authClient = useAuthClient();

	useEffect(() => {
		void authClient.signIn.anonymous();
	}, [authClient]);

	const entityRequest = useQuery({
		queryKey: ["entity", params.entityId],
		queryFn: async () => {
			const response = await apiClient.entities[":entityId"].$get({
				param: { entityId: params.entityId },
			});

			const payload = await response.json();
			if (!response.ok) throw new Error(getErrorMessage(payload));
			if (payload && typeof payload === "object" && "error" in payload)
				throw new Error(getErrorMessage(payload));

			return payload;
		},
	});

	const properties = toRecord(entityRequest.data?.data.properties);
	const assets = toRecord(properties?.assets);

	const title = toStringValue(entityRequest.data?.data.name) ?? "Untitled";
	const pages = toNumberValue(properties?.pages);
	const description = toStringValue(properties?.description);
	const publishYear = toNumberValue(properties?.publish_year);
	const sourceUrl = toStringValue(properties?.sourceUrl);
	const genres = toStringArray(properties?.genres);
	const people = toPeopleEntries(properties?.people);
	const remoteImages = toStringArray(assets?.remote_images);

	return (
		<Box
			style={{
				minHeight: "100vh",
				background: "linear-gradient(180deg, #f7fafc 0%, #edf2f7 100%)",
			}}
		>
			<Container size="lg" py="xl">
				<Stack gap="lg">
					<Stack gap={4}>
						<Title order={2}>{title}</Title>
						<Group gap="xs">
							<Badge color="blue" variant="light">
								Schema:{" "}
								{String(entityRequest.data?.data.schema_slug ?? "unknown")}
							</Badge>
							<Badge color="gray" variant="light">
								Entity ID: {params.entityId}
							</Badge>
						</Group>
					</Stack>

					{entityRequest.isPending ? (
						<Group>
							<Loader size="sm" />
							<Text c="dimmed" size="sm">
								Loading entity...
							</Text>
						</Group>
					) : null}

					{entityRequest.error ? (
						<Alert color="red" title="Entity load failed">
							{entityRequest.error.message}
						</Alert>
					) : null}

					{entityRequest.data ? (
						<>
							<Card withBorder radius="md" padding="md">
								<Stack gap="sm">
									<Title order={4}>Overview</Title>
									<Text>
										{description ?? "No description available for this entity."}
									</Text>
									<Group gap="lg">
										<Text size="sm" c="dimmed">
											Publish year: {publishYear ?? "unknown"}
										</Text>
										<Text size="sm" c="dimmed">
											Pages: {pages ?? "unknown"}
										</Text>
									</Group>
									<Stack gap={6}>
										<Text fw={600} size="sm">
											Genres
										</Text>
										{genres.length > 0 ? (
											<Group gap="xs">
												{genres.map((genre) => (
													<Badge key={genre} color="teal" variant="light">
														{genre}
													</Badge>
												))}
											</Group>
										) : (
											<Text size="sm" c="dimmed">
												No genres stored.
											</Text>
										)}
									</Stack>
									<Stack gap={6}>
										<Text fw={600} size="sm">
											Source URL
										</Text>
										{sourceUrl ? (
											<Anchor href={sourceUrl} target="_blank" rel="noreferrer">
												{sourceUrl}
											</Anchor>
										) : (
											<Text size="sm" c="dimmed">
												No source URL stored.
											</Text>
										)}
									</Stack>
								</Stack>
							</Card>

							<Card withBorder radius="md" padding="md">
								<Stack gap="sm">
									<Title order={4}>People</Title>
									{people.length > 0 ? (
										<Stack gap={6}>
											{people.map((person) => {
												const key = [
													person.role ?? "unknown-role",
													person.source ?? "unknown-source",
													person.identifier ?? "unknown-identifier",
												].join(":");

												return (
													<Text key={key} size="sm">
														{person.role ?? "Unknown role"} -{" "}
														{person.identifier ?? "Unknown identifier"}
														{person.source ? ` (${person.source})` : ""}
													</Text>
												);
											})}
										</Stack>
									) : (
										<Text size="sm" c="dimmed">
											No people stored.
										</Text>
									)}
								</Stack>
							</Card>

							<Card withBorder radius="md" padding="md">
								<Stack gap="sm">
									<Title order={4}>Images</Title>
									{remoteImages.length > 0 ? (
										<SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
											{remoteImages.map((imageUrl) => (
												<Image
													fit="contain"
													h={220}
													key={imageUrl}
													radius="sm"
													src={imageUrl}
													alt={title}
												/>
											))}
										</SimpleGrid>
									) : (
										<Text size="sm" c="dimmed">
											No remote images stored.
										</Text>
									)}
								</Stack>
							</Card>
						</>
					) : null}
				</Stack>
			</Container>
		</Box>
	);
}
