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
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
	CreateCustomPersonDocument,
	UpdateCustomPersonDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { parseParameters, parseSearchQuery } from "@ryot/ts-utils";
import { IconCalendar } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { z } from "zod";
import {
	CustomEntityImageInput,
	ExistingImageList,
} from "~/components/common/custom-entities";
import { useCoreDetails, usePersonDetails } from "~/lib/shared/hooks";
import {
	clientGqlService,
	refreshEntityDetails,
} from "~/lib/shared/react-query";
import { clientSideFileUpload } from "~/lib/shared/ui-utils";
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
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const coreDetails = useCoreDetails();
	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;

	const [{ data: details }] = usePersonDetails(
		loaderData.query.id || "",
		loaderData.action === Action.Edit && Boolean(loaderData.query.id),
	);

	const form = useForm({
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

	useEffect(() => {
		if (loaderData.action === Action.Edit && details?.details) {
			form.initialize({
				images: [],
				existingImages: details.details.assets?.s3Images || [],
				id: details.details.id || "",
				name: details.details.name || "",
				place: details.details.place || "",
				gender: details.details.gender || "",
				website: details.details.website || "",
				deathDate: details.details.deathDate || "",
				birthDate: details.details.birthDate || "",
				description: details.details.description || "",
				alternateNames: details.details.alternateNames?.join(", ") || "",
			});
		}
	}, [details, loaderData.action]);

	const createMutation = useMutation({
		mutationFn: async (values: typeof form.values) => {
			const s3Images = await Promise.all(
				values.images.map((f) => clientSideFileUpload(f, "person")),
			);
			const input = {
				name: values.name,
				place: values.place || undefined,
				gender: values.gender || undefined,
				website: values.website || undefined,
				birthDate: values.birthDate || undefined,
				deathDate: values.deathDate || undefined,
				description: values.description || undefined,
				alternateNames: values.alternateNames
					? values.alternateNames
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: undefined,
				assets: {
					s3Images,
					s3Videos: [],
					remoteImages: [],
					remoteVideos: [],
				},
			};
			const { createCustomPerson } = await clientGqlService.request(
				CreateCustomPersonDocument,
				{ input },
			);
			return createCustomPerson.id as string;
		},
		onSuccess: (id) => {
			notifications.show({
				color: "green",
				title: "Success",
				message: "Person created",
			});
			navigate($path("/media/people/item/:id", { id }));
		},
		onError: () =>
			notifications.show({
				color: "red",
				title: "Error",
				message: "Failed to create person",
			}),
	});

	const updateMutation = useMutation({
		mutationFn: async (values: typeof form.values) => {
			invariant(values.id);
			const uploadedImages = await Promise.all(
				values.images.map((f) => clientSideFileUpload(f, "person")),
			);
			const s3Images = Array.from(
				new Set([...(values.existingImages || []), ...uploadedImages]),
			);
			const update = {
				name: values.name,
				place: values.place || undefined,
				gender: values.gender || undefined,
				website: values.website || undefined,
				deathDate: values.deathDate || undefined,
				birthDate: values.birthDate || undefined,
				description: values.description || undefined,
				alternateNames: values.alternateNames
					? values.alternateNames
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: undefined,
				assets: {
					s3Images,
					s3Videos: [],
					remoteImages: [],
					remoteVideos: [],
				},
			};
			await clientGqlService.request(UpdateCustomPersonDocument, {
				input: { existingPersonId: values.id, update },
			});
			return values.id as string;
		},
		onSuccess: (id) => {
			refreshEntityDetails(id);
			notifications.show({
				color: "green",
				title: "Success",
				message: "Person updated",
			});
			navigate($path("/media/people/item/:id", { id }));
		},
		onError: () =>
			notifications.show({
				color: "red",
				title: "Error",
				message: "Failed to update person",
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
							onDrop={(files) => form.setFieldValue("images", files)}
							description={
								loaderData.action === Action.Edit
									? "Existing images are retained unless removed below"
									: "Attach images to this person"
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
