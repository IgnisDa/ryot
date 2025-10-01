import {
	Anchor,
	Button,
	Code,
	Container,
	Group,
	JsonInput,
	MultiSelect,
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
	MediaSource,
	UpdateCustomMetadataDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { camelCase, parseParameters, parseSearchQuery } from "@ryot/ts-utils";
import { IconCalendar, IconCalendarEvent } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { z } from "zod";
import {
	CustomEntityImageInput,
	ExistingImageList,
} from "~/components/common/custom-entities";
import {
	useCoreDetails,
	useMetadataDetails,
	useUserMetadataGroupList,
	useUserPeopleList,
	useUserPreferences,
} from "~/lib/shared/hooks";
import {
	clientGqlService,
	getMetadataGroupDetailsQuery,
	getPersonDetailsQuery,
	queryClient,
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
	const userPreferences = useUserPreferences();
	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;

	const [{ data: details }] = useMetadataDetails(
		loaderData.query.id,
		loaderData.action === Action.Edit && Boolean(loaderData.query.id),
	);

	const form = useForm({
		initialValues: {
			title: "",
			genres: "",
			isNsfw: false,
			specifics: "{}",
			description: "",
			publishDate: "",
			images: [] as File[],
			existingImages: [] as string[],
			groupIds: [] as string[],
			creatorIds: [] as string[],
			publishYear: undefined as number | undefined,
			id: (loaderData.query.id as string | undefined) || "",
			lot: (loaderData.query.lot as string | undefined) || "",
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
				images: [],
				existingImages: details.assets?.s3Images || [],
				id: details.id || "",
				title: details.title || "",
				lot: (details.lot as string) || "",
				isNsfw: Boolean(details.isNsfw),
				description: details.description || "",
				publishDate: details.publishDate || "",
				publishYear: details.publishYear || undefined,
				specifics: specifics ? JSON.stringify(specifics) : "{}",
				genres: details.genres?.map((g) => g.name).join(", ") || "",
				creatorIds:
					details.creators?.flatMap((c) => c.items).map((c) => c.idOrName) ||
					[],
				groupIds: details.groups
					? [...details.groups].sort((a, b) => a.part - b.part).map((g) => g.id)
					: [],
			});
		}
	}, [details, loaderData.action]);

	const { data: peopleList } = useUserPeopleList({
		filter: { source: MediaSource.Custom },
		search: { take: Number.MAX_SAFE_INTEGER },
	});

	const peopleListData = useQuery({
		queryKey: ["user-people-list", peopleList],
		queryFn: async () => {
			const allPeopleDetails = await Promise.all(
				(peopleList?.response.items || []).map((p) =>
					queryClient
						.ensureQueryData(getPersonDetailsQuery(p))
						.then((r) => ({ label: r.details.name, value: r.details.id })),
				),
			);
			return allPeopleDetails;
		},
	});

	const { data: groupsList } = useUserMetadataGroupList({
		filter: { source: MediaSource.Custom },
		search: { take: Number.MAX_SAFE_INTEGER },
		lot: form.values.lot as MediaLot | undefined,
	});

	const groupsListData = useQuery({
		queryKey: ["user-groups-list", groupsList, form.values.lot],
		queryFn: async () => {
			const allGroupDetails = await Promise.all(
				(groupsList?.response.items || []).map((g) =>
					queryClient
						.ensureQueryData(getMetadataGroupDetailsQuery(g))
						.then((r) => ({ value: r.details.id, label: r.details.title })),
				),
			);
			return allGroupDetails;
		},
	});

	const createMutation = useMutation({
		mutationFn: async (values: typeof form.values) => {
			const s3Images = await Promise.all(
				values.images.map((f) => clientSideFileUpload(f, "metadata")),
			);
			const specificsKey = `${camelCase(values.lot)}Specifics`;
			const input = {
				title: values.title,
				lot: values.lot as MediaLot,
				isNsfw: values.isNsfw || undefined,
				description: values.description || undefined,
				publishDate: values.publishDate || undefined,
				publishYear: values.publishYear || undefined,
				[specificsKey]: values.specifics
					? JSON.parse(values.specifics)
					: undefined,
				creatorIds:
					values.creatorIds && values.creatorIds.length > 0
						? values.creatorIds
						: undefined,
				groupIds:
					values.groupIds && values.groupIds.length > 0
						? values.groupIds
						: undefined,
				genres: values.genres
					? values.genres
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: undefined,
				assets: { s3Images, s3Videos: [], remoteImages: [], remoteVideos: [] },
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
			const uploadedImages = await Promise.all(
				values.images.map((f) => clientSideFileUpload(f, "metadata")),
			);
			const s3Images = Array.from(
				new Set([...(values.existingImages || []), ...uploadedImages]),
			);
			const specificsKey = `${camelCase(values.lot)}Specifics`;
			const update = {
				title: values.title,
				lot: values.lot as MediaLot,
				isNsfw: values.isNsfw || undefined,
				description: values.description || undefined,
				publishDate: values.publishDate || undefined,
				publishYear: values.publishYear || undefined,
				[specificsKey]: values.specifics
					? JSON.parse(values.specifics)
					: undefined,
				creatorIds:
					values.creatorIds && values.creatorIds.length > 0
						? values.creatorIds
						: undefined,
				groupIds:
					values.groupIds && values.groupIds.length > 0
						? values.groupIds
						: undefined,
				genres: values.genres
					? values.genres
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: undefined,
				assets: { s3Images, s3Videos: [], remoteImages: [], remoteVideos: [] },
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
					{form.values.existingImages.length > 0 && !fileUploadNotAllowed ? (
						<ExistingImageList
							keys={form.values.existingImages}
							onRemove={(key) => {
								form.setFieldValue(
									"existingImages",
									form.values.existingImages.filter(
										(imageKey) => imageKey !== key,
									),
								);
							}}
						/>
					) : null}
					{!fileUploadNotAllowed ? (
						<CustomEntityImageInput
							files={form.values.images}
							instructions="Select images to upload"
							onDrop={(files) => form.setFieldValue("images", files)}
							description={
								loaderData.action === Action.Edit
									? "Existing images are retained unless removed below"
									: "Attach images to this media item"
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
					<MultiSelect
						clearable
						searchable
						label="Creators"
						hidePickedOptions
						data={peopleListData.data}
						value={form.values.creatorIds}
						placeholder="Select or type creators"
						onChange={(v) => form.setFieldValue("creatorIds", v)}
						description="Only custom creators are allowed and must be created beforehand"
					/>
					{userPreferences.featuresEnabled.media.groups ? (
						<MultiSelect
							clearable
							searchable
							label="Groups"
							hidePickedOptions
							data={groupsListData.data}
							placeholder="Select groups"
							value={form.values.groupIds}
							onChange={(v) => form.setFieldValue("groupIds", v)}
							description="Only custom groups are allowed and must be created beforehand"
						/>
					) : null}
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
