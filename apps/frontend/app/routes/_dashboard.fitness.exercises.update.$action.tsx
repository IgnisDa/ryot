import {
	Button,
	Container,
	FileInput,
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
import { IconPhoto } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClientError } from "graphql-request";
import { useEffect, useMemo } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { z } from "zod";
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
	return { action, id: query.id };
};

export const meta = () => {
	return [{ title: "Create Exercise | Ryot" }];
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
				muscles: (details.muscles as string[] | undefined) || [],
				instructions: (details.instructions || []).join("\n"),
			});
		}
	}, [details, loaderData.action]);

	const exerciseImages = useQuery({
		queryKey: ["exercise-images", form.values.images],
		queryFn: async () => {
			const s3Images = await Promise.all(
				form.values.images.map((f) => clientSideFileUpload(f, "exercises")),
			);
			return s3Images;
		},
	});

	const memoizedInput = useMemo<UpdateCustomExerciseInput>(
		() => ({
			name: form.values.name,
			id: loaderData.id || "dummy",
			source: ExerciseSource.Custom,
			lot: form.values.lot as ExerciseLot,
			shouldDelete: form.values.shouldDelete,
			level: form.values.level as ExerciseLevel,
			force: form.values.force
				? (form.values.force as ExerciseForce)
				: undefined,
			mechanic: form.values.mechanic
				? (form.values.mechanic as ExerciseMechanic)
				: undefined,
			equipment: form.values.equipment
				? (form.values.equipment as ExerciseEquipment)
				: undefined,
			muscles: (form.values.muscles || []) as ExerciseMuscle[],
			instructions: form.values.instructions
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean),
			assets: {
				s3Videos: [],
				remoteImages: [],
				remoteVideos: [],
				s3Images: exerciseImages.data || [],
			},
		}),
		[loaderData.id, form.values, exerciseImages.data],
	);

	const createMutation = useMutation({
		mutationFn: async () => {
			const { createCustomExercise } = await clientGqlService.request(
				CreateCustomExerciseDocument,
				{ input: memoizedInput },
			);
			return createCustomExercise;
		},
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
		if (loaderData.action === Action.Create) {
			createMutation.mutate();
		} else {
			updateMutation.mutate();
		}
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
					{!fileUploadNotAllowed ? (
						<FileInput
							multiple
							name="images"
							label="Images"
							accept="image/*"
							value={form.values.images}
							leftSection={<IconPhoto />}
							onChange={(files) =>
								form.setFieldValue("images", (files as File[]) || [])
							}
							description={
								details &&
								"Please re-upload the images while updating the exercise, old ones will be deleted"
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
