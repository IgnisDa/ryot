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
import {
	CreateCustomMetadataDocument,
	MediaLot,
	MediaSource,
	UpdateCustomMetadataDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { camelCase, parseParameters, parseSearchQuery } from "@ryot/ts-utils";
import { IconCalendar, IconCalendarEvent } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLoaderData } from "react-router";
import { z } from "zod";
import {
	CustomEntityImageInput,
	ExistingImageList,
} from "~/components/common/custom-entities";
import { useEntityCrud } from "~/lib/hooks/use-entity-crud";
import {
	useCoreDetails,
	useMetadataDetails,
	useUserMetadataGroupList,
	useUserPeopleList,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { buildImageAssets } from "~/lib/shared/image-utils";
import { getMetadataDetailsPath } from "~/lib/shared/media-utils";
import {
	getMetadataGroupDetailsQuery,
	getPersonDetailsQuery,
	queryClient,
} from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
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
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const loaderData = useLoaderData<typeof loader>();
	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;

	const { details, handleSubmit, isLoading } = useEntityCrud({
		action: loaderData.action,
		entityId: loaderData.query.id,
		entityName: "Media",
		s3Prefix: "metadata",
		detailsPath: getMetadataDetailsPath,
		createDocument: CreateCustomMetadataDocument,
		updateDocument: UpdateCustomMetadataDocument,
		useDetailsHook: useMetadataDetails,
		transformToCreateInput: (values, s3Images) => {
			const lot = values.lot as string;
			const specifics = values.specifics as string;
			const genres = values.genres as string;
			const creatorIds = values.creatorIds as string[];
			const groupIds = values.groupIds as string[];
			const specificsKey = `${camelCase(lot)}Specifics`;
			return {
				title: values.title as string,
				lot: lot as MediaLot,
				isNsfw: (values.isNsfw as boolean) || undefined,
				description: (values.description as string) || undefined,
				publishDate: (values.publishDate as string) || undefined,
				publishYear: (values.publishYear as number) || undefined,
				assets: buildImageAssets(s3Images),
				[specificsKey]: specifics ? JSON.parse(specifics) : undefined,
				creatorIds:
					creatorIds && creatorIds.length > 0 ? creatorIds : undefined,
				groupIds: groupIds && groupIds.length > 0 ? groupIds : undefined,
				genres: genres
					? genres
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: undefined,
			};
		},
		transformToUpdateInput: (values, s3Images, entityId) => {
			const lot = values.lot as string;
			const specifics = values.specifics as string;
			const genres = values.genres as string;
			const creatorIds = values.creatorIds as string[];
			const groupIds = values.groupIds as string[];
			const specificsKey = `${camelCase(lot)}Specifics`;
			return {
				existingMetadataId: entityId,
				update: {
					title: values.title as string,
					lot: lot as MediaLot,
					isNsfw: (values.isNsfw as boolean) || undefined,
					description: (values.description as string) || undefined,
					publishDate: (values.publishDate as string) || undefined,
					publishYear: (values.publishYear as number) || undefined,
					assets: buildImageAssets(s3Images),
					[specificsKey]: specifics ? JSON.parse(specifics) : undefined,
					creatorIds:
						creatorIds && creatorIds.length > 0 ? creatorIds : undefined,
					groupIds: groupIds && groupIds.length > 0 ? groupIds : undefined,
					genres: genres
						? genres
								.split(",")
								.map((s) => s.trim())
								.filter(Boolean)
						: undefined,
				},
			};
		},
		extractIdFromCreateResult: (result) =>
			(result as { createCustomMetadata: { id: string } }).createCustomMetadata
				.id as string,
		extractIdFromUpdateResult: () => loaderData.query.id as string,
	});

	const form = useForm({
		initialValues: {
			title: "",
			genres: "",
			isNsfw: false,
			specifics: "{}",
			description: "",
			publishDate: "",
			images: [] as File[],
			groupIds: [] as string[],
			creatorIds: [] as string[],
			existingImages: [] as string[],
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
				id: details.id || "",
				title: details.title || "",
				lot: (details.lot as string) || "",
				isNsfw: Boolean(details.isNsfw),
				description: details.description || "",
				publishDate: details.publishDate || "",
				publishYear: details.publishYear || undefined,
				existingImages: details.assets?.s3Images || [],
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

	return (
		<Container>
			<form
				onSubmit={form.onSubmit(handleSubmit)}
				encType="multipart/form-data"
			>
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
							onFilesChanged={(files) => form.setFieldValue("images", files)}
							description={
								loaderData.action === Action.Edit
									? "Existing images are retained unless removed"
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
					<Button type="submit" loading={isLoading}>
						{loaderData.action === Action.Create ? "Create" : "Update"}
					</Button>
				</Stack>
			</form>
		</Container>
	);
}
