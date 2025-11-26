import {
	Button,
	Container,
	Group,
	Stack,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import {
	CreateCustomPersonDocument,
	UpdateCustomPersonDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { parseParameters, parseSearchQuery } from "@ryot/ts-utils";
import { IconCalendar } from "@tabler/icons-react";
import { useEffect } from "react";
import { useLoaderData } from "react-router";
import { z } from "zod";
import {
	CustomEntityImageInput,
	ExistingImageList,
} from "~/components/common/custom-entities";
import { useEntityCrud } from "~/lib/hooks/use-entity-crud";
import { useSavedForm } from "~/lib/hooks/use-saved-form";
import { useCoreDetails, usePersonDetails } from "~/lib/shared/hooks";
import { buildImageAssets } from "~/lib/shared/image-utils";
import { getPersonDetailsPath } from "~/lib/shared/media-utils";
import type { Route } from "./+types/_dashboard.media.people.update.$action";

enum Action {
	Edit = "edit",
	Create = "create",
}

const searchParamsSchema = z.object({
	id: z.string().optional(),
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
	return [{ title: "Create Or Update Person | Ryot" }];
};

export default function Page() {
	const coreDetails = useCoreDetails();
	const loaderData = useLoaderData<typeof loader>();
	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;

	const form = useSavedForm({
		storageKeyPrefix: "PersonUpdate",
		initialValues: {
			name: "",
			place: "",
			gender: "",
			website: "",
			deathDate: "",
			birthDate: "",
			description: "",
			alternateNames: "",
			images: [] as File[],
			existingImages: [] as string[],
			id: (loaderData.query.id as string | undefined) || "",
		},
		validate: {
			name: (value) => (value.trim() ? null : "Name is required"),
			website: (value) => {
				if (!value) return null;
				try {
					new URL(value);
					return null;
				} catch {
					return "Invalid URL format";
				}
			},
			deathDate: (value, values) => {
				if (!value || !values.birthDate) return null;
				const birthDate = new Date(values.birthDate);
				const deathDate = new Date(value);
				return deathDate >= birthDate
					? null
					: "Death date cannot be before birth date";
			},
		},
	});

	type FormValues = typeof form.values;

	const { details, handleSubmit, isLoading } = useEntityCrud<
		FormValues,
		NonNullable<ReturnType<typeof usePersonDetails>[0]["data"]>,
		{ createCustomPerson: { id: string } }
	>({
		action: loaderData.action,
		entityId: loaderData.query.id,
		entityName: "Person",
		s3Prefix: "person",
		detailsPath: getPersonDetailsPath,
		createDocument: CreateCustomPersonDocument,
		updateDocument: UpdateCustomPersonDocument,
		useDetailsHook: usePersonDetails,
		transformToCreateInput: (values, s3Images) => ({
			name: values.name,
			place: values.place || undefined,
			gender: values.gender || undefined,
			website: values.website || undefined,
			birthDate: values.birthDate || undefined,
			deathDate: values.deathDate || undefined,
			description: values.description || undefined,
			assets: buildImageAssets(s3Images),
			alternateNames: values.alternateNames
				? values.alternateNames
						.split(",")
						.map((s: string) => s.trim())
						.filter(Boolean)
				: undefined,
		}),
		transformToUpdateInput: (values, s3Images, entityId) => ({
			existingPersonId: entityId,
			update: {
				name: values.name,
				place: values.place || undefined,
				gender: values.gender || undefined,
				website: values.website || undefined,
				deathDate: values.deathDate || undefined,
				birthDate: values.birthDate || undefined,
				description: values.description || undefined,
				assets: buildImageAssets(s3Images),
				alternateNames: values.alternateNames
					? values.alternateNames
							.split(",")
							.map((s: string) => s.trim())
							.filter(Boolean)
					: undefined,
			},
		}),
		extractIdFromCreateResult: (result) => result.createCustomPerson.id,
		extractIdFromUpdateResult: () => loaderData.query.id as string,
		onSuccessCleanup: () => {
			form.reset();
			form.clearSavedState();
		},
	});

	useEffect(() => {
		if (loaderData.action === Action.Edit && details?.details) {
			form.initialize({
				images: [],
				id: details.details.id || "",
				name: details.details.name || "",
				place: details.details.place || "",
				gender: details.details.gender || "",
				website: details.details.website || "",
				deathDate: details.details.deathDate || "",
				birthDate: details.details.birthDate || "",
				description: details.details.description || "",
				existingImages: details.details.assets?.s3Images || [],
				alternateNames: details.details.alternateNames?.join(", ") || "",
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
						{details?.details
							? `Updating ${details.details.name}`
							: "Create Person"}
					</Title>
					<TextInput
						required
						autoFocus
						label="Name"
						{...form.getInputProps("name")}
					/>
					<TextInput
						label="Alternate Names"
						placeholder="Comma separated names"
						description="Other names this person is known by"
						{...form.getInputProps("alternateNames")}
					/>
					<Textarea
						label="Description"
						description="Markdown is supported"
						placeholder="Brief biography or description"
						{...form.getInputProps("description")}
					/>
					<Group wrap="nowrap" justify="space-between">
						<DateInput
							flex={1}
							label="Birth date"
							valueFormat="YYYY-MM-DD"
							leftSection={<IconCalendar />}
							value={
								form.values.birthDate
									? new Date(form.values.birthDate)
									: undefined
							}
							onChange={(d) =>
								form.setFieldValue(
									"birthDate",
									d ? new Date(d).toISOString().slice(0, 10) : "",
								)
							}
						/>
						<DateInput
							flex={1}
							label="Death date"
							valueFormat="YYYY-MM-DD"
							leftSection={<IconCalendar />}
							value={
								form.values.deathDate
									? new Date(form.values.deathDate)
									: undefined
							}
							onChange={(d) =>
								form.setFieldValue(
									"deathDate",
									d ? new Date(d).toISOString().slice(0, 10) : "",
								)
							}
						/>
					</Group>
					<Group wrap="nowrap">
						<TextInput
							flex={1}
							label="Gender"
							placeholder="e.g., Male, Female, Non-binary"
							{...form.getInputProps("gender")}
						/>
						<TextInput
							flex={1}
							label="Place"
							placeholder="Birth place or primary location"
							{...form.getInputProps("place")}
						/>
					</Group>
					<TextInput
						type="url"
						label="Website"
						placeholder="https://example.com"
						description="Official website or main online presence"
						{...form.getInputProps("website")}
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
									: "Attach images to this person"
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
