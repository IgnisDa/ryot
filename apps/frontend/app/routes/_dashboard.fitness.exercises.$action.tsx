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
import { parseFormData } from "@mjackson/form-data-parser";
import {
	CreateCustomExerciseDocument,
	ExerciseDetailsDocument,
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	UpdateCustomExerciseDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	cloneDeep,
	getActionIntent,
	parseParameters,
	parseSearchQuery,
	processSubmission,
	startCase,
	zodBoolAsString,
} from "@ryot/ts-utils";
import { IconPhoto } from "@tabler/icons-react";
import { ClientError } from "graphql-request";
import { Form, data, redirect, useLoaderData } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { getExerciseDetailsPath } from "~/lib/common";
import { useCoreDetails } from "~/lib/hooks";
import {
	createS3FileUploader,
	createToastHeaders,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.fitness.exercises.$action";

const searchParamsSchema = z.object({
	id: z.string().optional(),
});

enum Action {
	Create = "create",
	Update = "update",
}

export const loader = async ({ params, request }: Route.LoaderArgs) => {
	const { action } = parseParameters(
		params,
		z.object({ action: z.nativeEnum(Action) }),
	);
	const query = parseSearchQuery(request, searchParamsSchema);
	const details = await match(action)
		.with(Action.Create, () => undefined)
		.with(Action.Update, async () => {
			invariant(query.id);
			const { exerciseDetails } = await serverGqlService.authenticatedRequest(
				request,
				ExerciseDetailsDocument,
				{ exerciseId: query.id },
			);
			return exerciseDetails;
		})
		.exhaustive();
	return { action, details };
};

export const meta = () => {
	return [{ title: "Create Exercise | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const uploader = createS3FileUploader("exercises");
	const formData = await parseFormData(request.clone(), uploader);
	const submission = processSubmission(formData, schema);
	const muscles = submission.muscles
		? (submission.muscles.split(",") as Array<ExerciseMuscle>)
		: [];
	const instructions = submission.instructions;
	const newInput = cloneDeep(submission);
	newInput.muscles = undefined;
	newInput.instructions = undefined;
	newInput.images = undefined;
	const input = {
		...newInput,
		muscles,
		attributes: {
			images: submission.images || [],
			instructions: instructions?.split("\n").map((s) => s.trim()) || [],
		},
	};
	try {
		const intent = getActionIntent(request);
		return await match(intent)
			.with(Action.Create, async () => {
				const { createCustomExercise } =
					await serverGqlService.authenticatedRequest(
						request,
						CreateCustomExerciseDocument,
						{ input: { ...input, id: "dummy" } },
					);
				return redirect(getExerciseDetailsPath(createCustomExercise));
			})
			.with(Action.Update, async () => {
				const id = submission.id;
				invariant(id);
				await serverGqlService.authenticatedRequest(
					request,
					UpdateCustomExerciseDocument,
					{ input: { ...input, id } },
				);
				const redirectUrl = submission.shouldDelete
					? $path("/fitness/exercises/list")
					: getExerciseDetailsPath(id);
				return redirect(redirectUrl);
			})
			.run();
	} catch (e) {
		if (e instanceof ClientError && e.response.errors) {
			const message = e.response.errors[0].message;
			return data(
				{ error: e.message },
				{
					status: 400,
					headers: await createToastHeaders({ message, type: "error" }),
				},
			);
		}
		throw e;
	}
};

const optionalString = z.string().optional();
const optionalStringArray = z.array(z.string()).optional();

const schema = z.object({
	name: z.string(),
	id: optionalString,
	muscles: optionalString,
	images: optionalStringArray,
	instructions: optionalString,
	lot: z.nativeEnum(ExerciseLot),
	shouldDelete: zodBoolAsString.optional(),
	level: z.nativeEnum(ExerciseLevel),
	force: z.nativeEnum(ExerciseForce).optional(),
	mechanic: z.nativeEnum(ExerciseMechanic).optional(),
	equipment: z.nativeEnum(ExerciseEquipment).optional(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;
	const title = startCase(loaderData.action);

	return (
		<Container>
			<Form
				method="POST"
				encType="multipart/form-data"
				action={withQuery(".", { intent: loaderData.action })}
			>
				<Stack>
					<Title>{title} Exercise</Title>
					{loaderData.details?.id ? (
						<input
							name="id"
							type="hidden"
							defaultValue={loaderData.details.id}
						/>
					) : null}
					<TextInput
						required
						autoFocus
						name="name"
						label="Name"
						defaultValue={loaderData.details?.name}
					/>
					<Select
						required
						name="lot"
						label="Type"
						defaultValue={loaderData.details?.lot}
						readOnly={loaderData.action === Action.Update}
						data={Object.values(ExerciseLot).map((l) => ({
							value: l,
							label: startCase(l.toLowerCase()),
						}))}
					/>
					<Group wrap="nowrap">
						<Select
							required
							name="level"
							label="Level"
							w={{ base: "100%", md: "50%" }}
							data={Object.values(ExerciseLevel)}
							defaultValue={loaderData.details?.level}
						/>
						<Select
							name="force"
							label="Force"
							w={{ base: "100%", md: "50%" }}
							data={Object.values(ExerciseForce)}
							defaultValue={loaderData.details?.force}
						/>
					</Group>
					<Group wrap="nowrap">
						<Select
							name="equipment"
							label="Equipment"
							w={{ base: "100%", md: "50%" }}
							data={Object.values(ExerciseEquipment)}
							defaultValue={loaderData.details?.equipment}
						/>
						<Select
							name="mechanic"
							label="Mechanic"
							w={{ base: "100%", md: "50%" }}
							data={Object.values(ExerciseMechanic)}
							defaultValue={loaderData.details?.mechanic}
						/>
					</Group>
					<MultiSelect
						name="muscles"
						label="Muscles"
						data={Object.values(ExerciseMuscle)}
						defaultValue={loaderData.details?.muscles}
					/>
					<Textarea
						name="instructions"
						label="Instructions"
						description="Separate each instruction with a newline"
						defaultValue={loaderData.details?.attributes.instructions.join(
							"\n",
						)}
						autosize
					/>
					{!fileUploadNotAllowed ? (
						<FileInput
							multiple
							name="images"
							label="Images"
							leftSection={<IconPhoto />}
							accept="image/png,image/jpeg,image/jpg"
							description={
								loaderData.details &&
								"Please re-upload the images while updating the exercise, old ones will be deleted"
							}
						/>
					) : null}
					<Group w="100%" grow>
						{loaderData.details ? (
							<Button
								color="red"
								value="true"
								type="submit"
								name="shouldDelete"
							>
								Delete
							</Button>
						) : null}
						<Button type="submit">{title}</Button>
					</Group>
				</Stack>
			</Form>
		</Container>
	);
}
