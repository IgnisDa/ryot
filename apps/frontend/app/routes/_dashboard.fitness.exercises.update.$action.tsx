import {
	Button,
	Container,
	Group,
	MultiSelect,
	Select,
	Stack,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
	CreateCustomExerciseDocument,
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	ExerciseSource,
	UpdateCustomExerciseDocument,
	type UpdateCustomExerciseInput,
} from "@ryot/generated/graphql/backend/graphql";
import { parseParameters, parseSearchQuery, startCase } from "@ryot/ts-utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClientError } from "graphql-request";
import { useEffect, useMemo } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { z } from "zod";
import {
	CustomEntityImageInput,
	ExistingImageList,
} from "~/components/common/custom-entities";
import { useCoreDetails, useExerciseDetails } from "~/lib/shared/hooks";
import { getExerciseDetailsPath } from "~/lib/shared/media-utils";
import { clientGqlService } from "~/lib/shared/react-query";
import {
	clientSideFileUpload,
	convertEnumToSelectData,
} from "~/lib/shared/ui-utils";
import type { Route } from "./+types/_dashboard.fitness.exercises.update.$action";

const searchParamsSchema = z.object({
	id: z.string().optional(),
	duplicateId: z.string().optional(),
});

enum Action {
	Edit = "edit",
	Create = "create",
}

export const loader = async ({ params, request }: Route.LoaderArgs) => {
	const { action } = parseParameters(
		params,
		z.object({ action: z.enum(Action) }),
	);
	const query = parseSearchQuery(request, searchParamsSchema);
	return { action, id: query.id, duplicateId: query.duplicateId };
};

export const meta = () => {
	return [{ title: "Create Or Update Exercise | Ryot" }];
};

export default function Page() {
	const navigate = useNavigate();
	const coreDetails = useCoreDetails();
	const loaderData = useLoaderData<typeof loader>();
	const title = startCase(loaderData.action);
	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;

	const { data: details } = useExerciseDetails(
		loaderData.id,
		loaderData.action === Action.Edit && Boolean(loaderData.id),
	);

	const { data: duplicateDetails } = useExerciseDetails(
		loaderData.duplicateId,
		loaderData.action === Action.Create && Boolean(loaderData.duplicateId),
	);

	const form = useForm({
		initialValues: {
			lot: "",
			name: "",
			level: "",
			force: "",
			mechanic: "",
			equipment: "",
			instructions: "",
			images: [] as File[],
			muscles: [] as string[],
			existingImages: [] as string[],
			shouldDelete: undefined as boolean | undefined,
		},
	});

	useEffect(() => {
		if (loaderData.action === Action.Edit && details) {
			form.initialize({
				images: [],
				shouldDelete: undefined,
				name: details.name || "",
				lot: (details.lot as string) || "",
				level: (details.level as string) || "",
				force: (details.force as string) || "",
				mechanic: (details.mechanic as string) || "",
				equipment: (details.equipment as string) || "",
				existingImages: details.assets?.s3Images || [],
				muscles: (details.muscles as string[] | undefined) || [],
				instructions: (details.instructions || []).join("\n"),
			});
		}
	}, [details, loaderData.action]);

	useEffect(() => {
		if (loaderData.action === Action.Create && duplicateDetails) {
			form.initialize({
				images: [],
				shouldDelete: undefined,
				name: `${duplicateDetails.name} (Copy)`,
				lot: (duplicateDetails.lot as string) || "",
				level: (duplicateDetails.level as string) || "",
				force: (duplicateDetails.force as string) || "",
				mechanic: (duplicateDetails.mechanic as string) || "",
				equipment: (duplicateDetails.equipment as string) || "",
				existingImages: duplicateDetails.assets?.s3Images || [],
				muscles: (duplicateDetails.muscles as string[] | undefined) || [],
				instructions: (duplicateDetails.instructions || []).join("\n"),
			});
		}
	}, [duplicateDetails, loaderData.action]);

	const exerciseImages = useQuery({
		queryKey: ["exercise-images", form.values.images],
		queryFn: async () => {
			const s3Images = await Promise.all(
				form.values.images.map((f) => clientSideFileUpload(f, "exercises")),
			);
			return s3Images;
		},
	});

	const memoizedInput = useMemo<UpdateCustomExerciseInput>(() => {
		const s3Images = Array.from(
			new Set([
				...(form.values.existingImages || []),
				...((exerciseImages.data as string[] | undefined) || []),
			]),
		);
		return {
			name: form.values.name,
			id: loaderData.id || "dummy",
			source: ExerciseSource.Custom,
			lot: form.values.lot as ExerciseLot,
			shouldDelete: form.values.shouldDelete,
			level: form.values.level as ExerciseLevel,
			muscles: (form.values.muscles || []) as ExerciseMuscle[],
			assets: { s3Images, s3Videos: [], remoteImages: [], remoteVideos: [] },
			force: form.values.force
				? (form.values.force as ExerciseForce)
				: undefined,
			mechanic: form.values.mechanic
				? (form.values.mechanic as ExerciseMechanic)
				: undefined,
			equipment: form.values.equipment
				? (form.values.equipment as ExerciseEquipment)
				: undefined,
			instructions: form.values.instructions
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean),
		};
	}, [loaderData.id, form.values, exerciseImages.data]);

	const createMutation = useMutation({
		mutationFn: async () =>
			clientGqlService
				.request(CreateCustomExerciseDocument, { input: memoizedInput })
				.then((res) => res.createCustomExercise),
		onSuccess: (id) => {
			notifications.show({
				color: "green",
				title: "Success",
				message: "Exercise created",
			});
			navigate(getExerciseDetailsPath(id));
		},
		onError: (e) => {
			const message =
				e instanceof ClientError && e.response.errors
					? e.response.errors[0].message
					: "Failed to create exercise";
			notifications.show({ color: "red", title: "Error", message });
		},
	});

	const updateMutation = useMutation({
		mutationFn: async () => {
			invariant(loaderData.id);
			await clientGqlService.request(UpdateCustomExerciseDocument, {
				input: memoizedInput,
			});
			return loaderData.id;
		},
		onSuccess: (id) => {
			const destination = memoizedInput.shouldDelete
				? $path("/fitness/exercises/list")
				: getExerciseDetailsPath(id);
			notifications.show({
				color: "green",
				title: "Success",
				message: memoizedInput.shouldDelete
					? "Exercise deleted"
					: "Exercise updated",
			});
			navigate(destination);
		},
		onError: (e) => {
			const message =
				e instanceof ClientError && e.response.errors
					? e.response.errors[0].message
					: "Failed to update exercise";
			notifications.show({ color: "red", title: "Error", message });
		},
	});

	const handleSubmit = form.onSubmit(async () => {
		if (loaderData.action === Action.Create) createMutation.mutate();
		else updateMutation.mutate();
	});

	return (
		<Container>
			<form onSubmit={handleSubmit} encType="multipart/form-data">
				<Stack>
					<Title>{title} Exercise</Title>
					<TextInput
						required
						autoFocus
						label="Name"
						{...form.getInputProps("name")}
					/>
					<Select
						required
						label="Type"
						data={convertEnumToSelectData(ExerciseLot)}
						readOnly={loaderData.action === Action.Edit}
						{...form.getInputProps("lot")}
					/>
					<Group wrap="nowrap">
						<Select
							required
							label="Level"
							w={{ base: "100%", md: "50%" }}
							data={convertEnumToSelectData(ExerciseLevel)}
							{...form.getInputProps("level")}
						/>
						<Select
							label="Force"
							w={{ base: "100%", md: "50%" }}
							data={convertEnumToSelectData(ExerciseForce)}
							{...form.getInputProps("force")}
						/>
					</Group>
					<Group wrap="nowrap">
						<Select
							label="Equipment"
							w={{ base: "100%", md: "50%" }}
							data={convertEnumToSelectData(ExerciseEquipment)}
							{...form.getInputProps("equipment")}
						/>
						<Select
							label="Mechanic"
							w={{ base: "100%", md: "50%" }}
							data={convertEnumToSelectData(ExerciseMechanic)}
							{...form.getInputProps("mechanic")}
						/>
					</Group>
					<MultiSelect
						label="Muscles"
						data={convertEnumToSelectData(ExerciseMuscle)}
						{...form.getInputProps("muscles")}
					/>
					<Textarea
						autosize
						label="Instructions"
						description="Separate each instruction with a newline"
						{...form.getInputProps("instructions")}
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
									: "Attach images to this exercise"
							}
						/>
					) : null}
					<Group w="100%" grow>
						{details ? (
							<Button
								color="red"
								type="submit"
								disabled={updateMutation.isPending}
								onClick={() => {
									form.setFieldValue("shouldDelete", true);
								}}
							>
								Delete
							</Button>
						) : null}
						<Button
							type="submit"
							loading={createMutation.isPending || updateMutation.isPending}
						>
							{title}
						</Button>
					</Group>
				</Stack>
			</form>
		</Container>
	);
}
