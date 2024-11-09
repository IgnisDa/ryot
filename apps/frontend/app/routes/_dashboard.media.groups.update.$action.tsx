import {
	Button,
	Container,
	Select,
	Stack,
	Textarea,
	TextInput,
	Title,
} from "@mantine/core";
import {
	CreateCustomMetadataGroupDocument,
	MediaLot,
	UpdateCustomMetadataGroupDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { parseParameters, parseSearchQuery } from "@ryot/ts-utils";
import { useEffect } from "react";
import { useLoaderData } from "react-router";
import { z } from "zod";
import {
	CustomEntityImageInput,
	ExistingImageList,
} from "~/components/common/custom-entities";
import { useEntityCrud } from "~/lib/hooks/use-entity-crud";
import { useSavedForm } from "~/lib/hooks/use-saved-form";
import { useCoreDetails, useMetadataGroupDetails } from "~/lib/shared/hooks";
import { buildImageAssets } from "~/lib/shared/image-utils";
import { getMetadataGroupDetailsPath } from "~/lib/shared/media-utils";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import type { Route } from "./+types/_dashboard.media.groups.update.$action";

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
	return [{ title: "Create Or Update Group | Ryot" }];
};

export default function Page() {
	const coreDetails = useCoreDetails();
	const loaderData = useLoaderData<typeof loader>();
	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;

	const form = useSavedForm<{
		id: string;
		lot: string;
		title: string;
		images: File[];
		description: string;
		existingImages: string[];
	}>({
		storageKeyPrefix: "MetadataGroup",
		initialValues: {
			title: "",
			description: "",
			images: [] as File[],
			existingImages: [] as string[],
			id: (loaderData.query.id as string | undefined) || "",
			lot: (loaderData.query.lot as string | undefined) || "",
		},
	});

	const { details, handleSubmit, isLoading } = useEntityCrud<
		typeof form.values,
		NonNullable<ReturnType<typeof useMetadataGroupDetails>[0]["data"]>,
		{ createCustomMetadataGroup: { id: string } }
	>({
		entityName: "Group",
		s3Prefix: "metadata-group",
		action: loaderData.action,
		entityId: loaderData.query.id,
		useDetailsHook: useMetadataGroupDetails,
		detailsPath: getMetadataGroupDetailsPath,
		onSuccessCleanup: () => form.clearSavedState(),
		createDocument: CreateCustomMetadataGroupDocument,
		updateDocument: UpdateCustomMetadataGroupDocument,
		extractIdFromUpdateResult: () => loaderData.query.id as string,
		extractIdFromCreateResult: (result) =>
			result.createCustomMetadataGroup.id as string,
		transformToCreateInput: (values, s3Images) => ({
			title: values.title,
			lot: values.lot as MediaLot,
			description: values.description || undefined,
			assets: buildImageAssets(s3Images),
		}),
		transformToUpdateInput: (values, s3Images, entityId) => ({
			existingMetadataGroupId: entityId,
			update: {
				title: values.title,
				lot: values.lot as MediaLot,
				description: values.description || undefined,
				assets: buildImageAssets(s3Images),
			},
		}),
	});

	useEffect(() => {
		if (loaderData.action === Action.Edit && details) {
			form.initialize({
				images: [],
				id: details.details.id,
				title: details.details.title || "",
				lot: (details.details.lot as string) || "",
				description: details.details.description || "",
				existingImages: details.details.assets?.s3Images || [],
			});
		}
	}, [details, loaderData.action]);

	return (
		<Container>
			<form
				onSubmit={form.onSubmit(handleSubmit)}
				encType="multipart/form-data"
			>
				<Stack>
					<Title>
						{details ? `Updating ${details.details.title}` : "Create Group"}
					</Title>
					<TextInput
						required
						autoFocus
						label="Title"
						{...form.getInputProps("title")}
					/>
					<Select
						required
						label="Type"
						data={convertEnumToSelectData(MediaLot)}
						{...form.getInputProps("lot")}
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
									: "Attach images to this group"
							}
						/>
					) : null}
					<Button type="submit" loading={isLoading}>
						{loaderData.action === Action.Create ? "Create" : "Update"}
					</Button>
				</Stack>
			</form>
		</Container>
	);
}
