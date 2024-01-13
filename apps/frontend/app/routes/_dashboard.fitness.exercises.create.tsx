import { $path } from "@ignisda/remix-routes";
import {
	Button,
	Container,
	FileInput,
	Group,
	MultiSelect,
	ScrollArea,
	Select,
	Stack,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
	redirect,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	CreateCustomExerciseDocument,
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	ExerciseSource,
	MetadataSource,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconPhoto } from "@tabler/icons-react";
import { z } from "zod";
import { MediaDetailsLayout } from "~/components/common";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getPresignedGetUrl, uploadFileAndGetKey } from "~/lib/generals";
import { getCoreEnabledFeatures } from "~/lib/graphql.server";
import { processSubmission } from "~/lib/utilities.server";

export const loader = async (_args: LoaderFunctionArgs) => {
	const [coreEnabledFeatures] = await Promise.all([getCoreEnabledFeatures()]);
	return json({
		coreEnabledFeatures: { fileStorage: coreEnabledFeatures.fileStorage },
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Create Exercise | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.formData();
	const submission = processSubmission(formData, schema);
	const muscles = submission.muscles
		? (submission.muscles.split(",") as ExerciseMuscle[])
		: [];
	const images = JSON.parse(submission.images || "[]");
	const instructions = submission.instructions;
	const newInput = Object.assign(submission, {});
	newInput.muscles = undefined;
	newInput.instructions = undefined;
	newInput.images = undefined;
	const input = {
		source: ExerciseSource.Custom,
		...newInput,
		muscles,
		attributes: {
			images,
			instructions: instructions?.split("\n") || [],
		},
	};
	const { createCustomExercise } = await gqlClient.request(
		CreateCustomExerciseDocument,
		{ input },
		await getAuthorizationHeader(request),
	);
	return redirect(
		$path("/fitness/exercises/:id", { id: createCustomExercise }),
	);
};

const optionalString = z.string().optional();

const schema = z.object({
	id: z.string(),
	lot: z.nativeEnum(ExerciseLot),
	level: z.nativeEnum(ExerciseLevel),
	force: z.nativeEnum(ExerciseForce).optional(),
	mechanic: z.nativeEnum(ExerciseMechanic).optional(),
	equipment: z.nativeEnum(ExerciseEquipment).optional(),
	muscles: optionalString,
	instructions: optionalString,
	images: optionalString,
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [imageUrls, setImageUrls] = useListState<{ key: string; url: string }>(
		[],
	);

	const fileUploadNowAllowed = !loaderData.coreEnabledFeatures.fileStorage;

	const uploadFiles = async (files: File[]) => {
		if (files.length > 0) {
			for (const file of files) {
				const key = await uploadFileAndGetKey(
					file.name,
					"exercises",
					file.type,
					await file.arrayBuffer(),
				);
				const url = await getPresignedGetUrl(key);
				setImageUrls.append({ key, url });
			}
			notifications.show({
				title: "Success",
				message: `Uploaded ${files.length} files`,
			});
		}
	};

	return (
		<Container>
			<MediaDetailsLayout
				images={imageUrls.map((i) => i.url)}
				externalLink={{ source: MetadataSource.Custom }}
			>
				<ScrollArea.Autosize mah={400}>
					<Form method="post" replace>
						<Stack>
							<Title>Create Exercise</Title>
							<TextInput label="Name" required autoFocus name="id" />
							<Select
								label="Type"
								data={Object.values(ExerciseLot).map((l) => ({
									value: l,
									label: changeCase(l),
								}))}
								required
								name="lot"
							/>
							<Group wrap="nowrap">
								<Select
									label="Level"
									data={Object.values(ExerciseLevel)}
									required
									name="level"
								/>
								<Select
									label="Force"
									data={Object.values(ExerciseForce)}
									name="force"
								/>
							</Group>
							<Group wrap="nowrap">
								<Select
									label="Equipment"
									data={Object.values(ExerciseEquipment)}
									name="equipment"
								/>
								<Select
									label="Mechanic"
									data={Object.values(ExerciseMechanic)}
									name="mechanic"
								/>
							</Group>
							<MultiSelect
								label="Muscles"
								data={Object.values(ExerciseMuscle)}
								name="muscles"
							/>
							<Textarea
								label="Instructions"
								description="Separate each instruction with a newline"
								name="instructions"
							/>
							<input
								hidden
								value={JSON.stringify(imageUrls.map((i) => i.key))}
								name="images"
								readOnly
							/>
							<FileInput
								label="Images"
								multiple
								disabled={fileUploadNowAllowed}
								description={
									fileUploadNowAllowed &&
									"Please set the S3 variables required to enable file uploading"
								}
								onChange={(f) => uploadFiles(f)}
								accept="image/png,image/jpeg,image/jpg"
								leftSection={<IconPhoto />}
							/>
							<Button type="submit">Create</Button>
						</Stack>
					</Form>
				</ScrollArea.Autosize>
			</MediaDetailsLayout>
		</Container>
	);
}
