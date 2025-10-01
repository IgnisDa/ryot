import {
	Button,
	Container,
	Select,
	Stack,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { IMAGE_MIME_TYPE } from "@mantine/dropzone";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
	CreateCustomMetadataGroupDocument,
	MediaLot,
	UpdateCustomMetadataGroupDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { parseParameters, parseSearchQuery } from "@ryot/ts-utils";
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { z } from "zod";
import {
	ExistingImageList,
	FileDropzone,
} from "~/components/common/custom-entities";
import { useCoreDetails, useMetadataGroupDetails } from "~/lib/shared/hooks";
import {
	clientGqlService,
	refreshEntityDetails,
} from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { clientSideFileUpload } from "~/lib/shared/ui-utils";
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
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const coreDetails = useCoreDetails();
	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;

	const [{ data: details }] = useMetadataGroupDetails(
		loaderData.query.id,
		loaderData.action === Action.Edit && Boolean(loaderData.query.id),
	);

	const form = useForm({
		initialValues: {
			id: (loaderData.query.id as string | undefined) || "",
			title: "",
			lot: (loaderData.query.lot as string | undefined) || "",
			description: "",
			images: [] as File[],
			existingImages: [] as string[],
		},
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

	const createMutation = useMutation({
		mutationFn: async (values: typeof form.values) => {
			const s3Images = await Promise.all(
				values.images.map((f) => clientSideFileUpload(f, "metadata-group")),
			);
			const input = {
				title: values.title,
				lot: values.lot as MediaLot,
				description: values.description || undefined,
				assets: {
					s3Images,
					s3Videos: [],
					remoteImages: [],
					remoteVideos: [],
				},
			};
			const { createCustomMetadataGroup } = await clientGqlService.request(
				CreateCustomMetadataGroupDocument,
				{ input },
			);
			return createCustomMetadataGroup.id as string;
		},
		onSuccess: (id) => {
			notifications.show({
				color: "green",
				title: "Success",
				message: "Group created",
			});
			navigate($path("/media/groups/item/:id", { id }));
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
				values.images.map((f) => clientSideFileUpload(f, "metadata-group")),
			);
			const s3Images = Array.from(
				new Set([...(values.existingImages || []), ...uploadedImages]),
			);
			const update = {
				title: values.title,
				lot: values.lot as MediaLot,
				description: values.description || undefined,
				assets: {
					s3Images,
					s3Videos: [],
					remoteImages: [],
					remoteVideos: [],
				},
			};
			await clientGqlService.request(UpdateCustomMetadataGroupDocument, {
				input: { existingMetadataGroupId: values.id, update },
			});
			return values.id as string;
		},
		onSuccess: (id) => {
			refreshEntityDetails(id);
			notifications.show({
				color: "green",
				title: "Success",
				message: "Group updated",
			});
			navigate($path("/media/groups/item/:id", { id }));
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
						<FileDropzone
							accept={IMAGE_MIME_TYPE}
							files={form.values.images}
							onDrop={(files) => form.setFieldValue("images", files)}
							onClear={() => form.setFieldValue("images", [])}
							instructions="Drag images here or click to select files"
							description={
								loaderData.action === Action.Edit
									? "Existing images are retained unless removed below"
									: "Attach images to this group"
							}
						/>
					) : null}
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
