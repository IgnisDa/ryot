import {
	Alert,
	Badge,
	Card,
	Container,
	Grid,
	Image,
	Link,
	Loader,
	Text,
	View,
} from "reshaped";
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
	const publishYear = toNumberValue(properties?.publishYear);
	const sourceUrl = toStringValue(properties?.sourceUrl);
	const genres = toStringArray(properties?.genres);
	const people = toPeopleEntries(properties?.people);
	const remoteImages = toStringArray(assets?.remote_images);

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
							{title}
						</Text>
						<View direction="row" gap={2} wrap>
							<Badge color="primary" variant="faded">
								Schema: {String(entityRequest.data?.data.schemaSlug ?? "unknown")}
							</Badge>
							<Badge color="neutral" variant="faded">
								Entity ID: {params.entityId}
							</Badge>
						</View>
					</View>

					{entityRequest.isPending ? (
						<View direction="row" gap={3} align="center">
							<Loader size="small" />
							<Text variant="caption-1" color="neutral-faded">
								Loading entity...
							</Text>
						</View>
					) : null}

					{entityRequest.error ? (
						<Alert color="critical" title="Entity load failed">
							{entityRequest.error.message}
						</Alert>
					) : null}

					{entityRequest.data ? (
						<>
							<Card padding={4}>
								<View gap={3}>
									<Text variant="title-4" as="h4">
										Overview
									</Text>
									<Text>
										{description ?? "No description available for this entity."}
									</Text>
									<View direction="row" gap={4} wrap>
										<Text variant="caption-1" color="neutral-faded">
											Publish year: {publishYear ?? "unknown"}
										</Text>
										<Text variant="caption-1" color="neutral-faded">
											Pages: {pages ?? "unknown"}
										</Text>
									</View>
									<View gap={1}>
										<Text variant="body-3" weight="medium">
											Genres
										</Text>
										{genres.length > 0 ? (
											<View direction="row" gap={2} wrap>
												{genres.map((genre) => (
													<Badge key={genre} color="positive" variant="faded">
														{genre}
													</Badge>
												))}
											</View>
										) : (
											<Text variant="caption-1" color="neutral-faded">
												No genres stored.
											</Text>
										)}
									</View>
									<View gap={1}>
										<Text variant="body-3" weight="medium">
											Source URL
										</Text>
										{sourceUrl ? (
											<Link
												href={sourceUrl}
												attributes={{ target: "_blank", rel: "noreferrer" }}
											>
												{sourceUrl}
											</Link>
										) : (
											<Text variant="caption-1" color="neutral-faded">
												No source URL stored.
											</Text>
										)}
									</View>
								</View>
							</Card>

							<Card padding={4}>
								<View gap={3}>
									<Text variant="title-4" as="h4">
										People
									</Text>
									{people.length > 0 ? (
										<View gap={2}>
											{people.map((person) => {
												const key = [
													person.role ?? "unknown-role",
													person.source ?? "unknown-source",
													person.identifier ?? "unknown-identifier",
												].join(":");

												return (
													<Text key={key} variant="body-3">
														{person.role ?? "Unknown role"} -{" "}
														{person.identifier ?? "Unknown identifier"}
														{person.source ? ` (${person.source})` : ""}
													</Text>
												);
											})}
										</View>
									) : (
										<Text variant="caption-1" color="neutral-faded">
											No people stored.
										</Text>
									)}
								</View>
							</Card>

							<Card padding={4}>
								<View gap={3}>
									<Text variant="title-4" as="h4">
										Images
									</Text>
									{remoteImages.length > 0 ? (
										<Grid columns={{ s: 1, m: 2, l: 3 }} gap={4}>
											{remoteImages.map((imageUrl) => (
												<Grid.Item key={imageUrl}>
													<Image
														height={220}
														src={imageUrl}
														alt={title}
														displayMode="contain"
														borderRadius="small"
													/>
												</Grid.Item>
											))}
										</Grid>
									) : (
										<Text variant="caption-1" color="neutral-faded">
											No remote images stored.
										</Text>
									)}
								</View>
							</Card>
						</>
					) : null}
				</View>
			</Container>
		</div>
	);
}
