import {
	Anchor,
	Button,
	Code,
	Container,
	FileInput,
	Group,
	JsonInput,
	NumberInput,
	Select,
	Stack,
	Switch,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
	CreateCustomMetadataDocument,
	MediaLot,
	UpdateCustomMetadataDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { camelCase, parseParameters, parseSearchQuery } from "@ryot/ts-utils";
import {
	IconCalendar,
	IconCalendarEvent,
	IconPhoto,
	IconVideo,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { z } from "zod";
import { useCoreDetails, useMetadataDetails } from "~/lib/shared/hooks";
import {
	clientGqlService,
	refreshEntityDetails,
} from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { clientSideFileUpload } from "~/lib/shared/ui-utils";
import type { Route } from "./+types/_dashboard.media.item.update.$action";

enum Action {
	Edit = "edit",
	Create = "create",
}

const searchParamsSchema = z.object({
	id: z.string().optional(),
	lot: z.enum(MediaLot).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ params, request }: Route.LoaderArgs) => {
	const { action } = parseParameters(
		params,
		z.object({ action: z.enum(Action) }),
	);
	const query = parseSearchQuery(request, searchParamsSchema);
	return { query, action };
};

export const meta = () => {
	return [{ title: "Create Or Update Media | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const coreDetails = useCoreDetails();
	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;

	const [{ data: details }] = useMetadataDetails(
		loaderData.query.id,
		loaderData.action === Action.Edit && Boolean(loaderData.query.id),
	);

	const form = useForm({
		initialValues: {
			id: (loaderData.query.id as string | undefined) || "",
			title: "",
			lot: (loaderData.query.lot as string | undefined) || "",
			isNsfw: false,
			specifics: "{}",
			description: "",
			images: [] as File[],
			videos: [] as File[],
			publishDate: "",
			publishYear: undefined as number | undefined,
			creators: "",
			genres: "",
		},
	});

	useEffect(() => {
		if (loaderData.action === Action.Edit && details) {
			const specifics =
				details.movieSpecifics ||
				details.showSpecifics ||
				details.mangaSpecifics ||
				details.animeSpecifics ||
				details.podcastSpecifics ||
				details.bookSpecifics ||
				details.audioBookSpecifics ||
				details.visualNovelSpecifics ||
				details.videoGameSpecifics ||
				details.musicSpecifics;
			form.initialize({
				id: details.id || "",
				title: details.title || "",
				lot: (details.lot as string) || "",
				isNsfw: Boolean(details.isNsfw),
				specifics: specifics ? JSON.stringify(specifics) : "{}",
				description: details.description || "",
				images: [],
				videos: [],
				publishDate: details.publishDate || "",
				publishYear: details.publishYear || undefined,
				creators:
					details.creators
						?.flatMap((c) => c.items)
						.map((c) => c.idOrName)
						.join(", ") || "",
				genres: details.genres?.map((g) => g.name).join(", ") || "",
			});
		}
	}, [details, loaderData.action]);

	const createMutation = useMutation({
		mutationFn: async (values: typeof form.values) => {
			const s3Images = await Promise.all(
				values.images.map((f) => clientSideFileUpload(f, "metadata")),
			);
			const s3Videos = await Promise.all(
				values.videos.map((f) => clientSideFileUpload(f, "metadata")),
			);
			const specificsKey = `${camelCase(values.lot)}Specifics`;
			const input = {
				title: values.title,
				lot: values.lot as MediaLot,
				isNsfw: values.isNsfw || undefined,
				description: values.description || undefined,
				[specificsKey]: values.specifics
					? JSON.parse(values.specifics)
					: undefined,
				creators: values.creators
					? values.creators
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: undefined,
				genres: values.genres
					? values.genres
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: undefined,
				publishDate: values.publishDate || undefined,
				publishYear: values.publishYear || undefined,
				assets: {
					s3Images,
					s3Videos,
					remoteImages: [],
					remoteVideos: [],
				},
			};
			const { createCustomMetadata } = await clientGqlService.request(
				CreateCustomMetadataDocument,
				{ input },
			);
			return createCustomMetadata.id as string;
		},
		onSuccess: (id) => {
			notifications.show({
				color: "green",
				title: "Success",
				message: "Media created",
			});
			navigate($path("/media/item/:id", { id }));
		},
		onError: () =>
			notifications.show({
				color: "red",
				title: "Error",
				message: "Failed to create",
			}),
	});

	const updateMutation = useMutation({
		mutationFn: async (values: typeof form.values) => {
			invariant(values.id);
			const s3Images = await Promise.all(
				values.images.map((f) => clientSideFileUpload(f, "metadata")),
			);
			const s3Videos = await Promise.all(
				values.videos.map((f) => clientSideFileUpload(f, "metadata")),
			);
			const specificsKey = `${camelCase(values.lot)}Specifics`;
			const update = {
				title: values.title,
				lot: values.lot as MediaLot,
				isNsfw: values.isNsfw || undefined,
				description: values.description || undefined,
				[specificsKey]: values.specifics
					? JSON.parse(values.specifics)
					: undefined,
				creators: values.creators
					? values.creators
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: undefined,
				genres: values.genres
					? values.genres
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: undefined,
				publishDate: values.publishDate || undefined,
				publishYear: values.publishYear || undefined,
				assets: {
					s3Images,
					s3Videos,
					remoteImages: [],
					remoteVideos: [],
				},
			};
			await clientGqlService.request(UpdateCustomMetadataDocument, {
				input: { existingMetadataId: values.id, update },
			});
			return values.id as string;
		},
		onSuccess: (id) => {
			refreshEntityDetails(id);
			notifications.show({
				color: "green",
				title: "Success",
				message: "Media updated",
			});
			navigate($path("/media/item/:id", { id }));
		},
		onError: () =>
			notifications.show({
				color: "red",
				title: "Error",
				message: "Failed to update",
			}),
	});

	const handleSubmit = form.onSubmit((values) => {
		if (loaderData.action === Action.Create) createMutation.mutate(values);
		else updateMutation.mutate(values);
	});

	return (
		<Container>
			<form onSubmit={handleSubmit} encType="multipart/form-data">
				<Stack>
					<Title>
						{details ? `Updating ${details.title}` : "Create Media"}
					</Title>
					<TextInput
						required
						autoFocus
						label="Title"
						{...form.getInputProps("title")}
					/>
					<Group wrap="nowrap">
						<Select
							required
							label="Type"
							data={convertEnumToSelectData(MediaLot)}
							{...form.getInputProps("lot")}
						/>
						<Switch
							mt="md"
							label="Is it NSFW?"
							{...form.getInputProps("isNsfw", { type: "checkbox" })}
						/>
					</Group>
					<JsonInput
						formatOnBlur
						label="Specifics"
						description={
							<>
								Please search for <Code>Specifics</Code> inputs at the{" "}
								<Anchor href="/backend/graphql" size="xs" target="_blank">
									graphql endpoint
								</Anchor>{" "}
								for the required JSON structure
							</>
						}
						{...form.getInputProps("specifics")}
					/>
					<Textarea
						label="Description"
						description="Markdown is supported"
						{...form.getInputProps("description")}
					/>
					{!fileUploadNotAllowed ? (
						<FileInput
							multiple
							label="Images"
							accept="image/*"
							leftSection={<IconPhoto />}
							value={form.values.images}
							onChange={(files) =>
								form.setFieldValue("images", (files as File[]) || [])
							}
							description={
								details &&
								"Please re-upload the images while updating the metadata, old ones will be deleted"
							}
						/>
					) : null}
					{!fileUploadNotAllowed ? (
						<FileInput
							multiple
							label="Videos"
							accept="video/*"
							leftSection={<IconVideo />}
							value={form.values.videos}
							onChange={(files) =>
								form.setFieldValue("videos", (files as File[]) || [])
							}
							description={
								details &&
								"Please re-upload the videos while updating the metadata, old ones will be deleted"
							}
						/>
					) : null}
					<Group wrap="nowrap" justify="space-between">
						<DateInput
							flex={1}
							label="Publish date"
							valueFormat="YYYY-MM-DD"
							leftSection={<IconCalendarEvent />}
							value={
								form.values.publishDate
									? new Date(form.values.publishDate)
									: undefined
							}
							onChange={(d) =>
								form.setFieldValue(
									"publishDate",
									d ? new Date(d).toISOString().slice(0, 10) : "",
								)
							}
						/>
						<NumberInput
							flex={1}
							label="Publish year"
							leftSection={<IconCalendar />}
							{...form.getInputProps("publishYear")}
						/>
					</Group>
					<TextInput
						label="Creators"
						placeholder="Comma separated names"
						{...form.getInputProps("creators")}
					/>
					<TextInput
						label="Genres"
						placeholder="Comma separated values"
						{...form.getInputProps("genres")}
					/>
					<Button
						type="submit"
						loading={createMutation.isPending || updateMutation.isPending}
					>
						{loaderData.action === Action.Create ? "Create" : "Update"}
					</Button>
				</Stack>
			</form>
		</Container>
	);
}
