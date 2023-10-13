import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import { APP_ROUTES } from "@/lib/constants";
import { useEnabledCoreFeatures } from "@/lib/hooks/graphql";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getPresignedGetUrl, uploadFileAndGetKey } from "@/lib/utilities";
import {
	Box,
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
import { useForm, zodResolver } from "@mantine/form";
import { useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CreateCustomExerciseDocument,
	type CreateCustomExerciseMutationVariables,
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	ExerciseSource,
	MetadataSource,
} from "@ryot/generated/graphql/backend/graphql";
import { IconPhoto } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement, useEffect } from "react";
import { withQuery } from "ufo";
import { z } from "zod";
import type { NextPageWithLayout } from "../../_app";

const formSchema = z.object({
	name: z.string(),
	lot: z.nativeEnum(ExerciseLot),
	level: z.nativeEnum(ExerciseLevel),
	force: z.nativeEnum(ExerciseForce).optional(),
	mechanic: z.nativeEnum(ExerciseMechanic).optional(),
	equipment: z.nativeEnum(ExerciseEquipment).optional(),
	muscles: z.nativeEnum(ExerciseMuscle).array().optional(),
	instructions: z.string().optional(),
});
type FormSchema = z.infer<typeof formSchema>;

const Page: NextPageWithLayout = () => {
	const router = useRouter();

	const [images, setImages] = useListState<string>([]);
	const form = useForm<FormSchema>({
		validate: zodResolver(formSchema),
	});

	useEffect(() => {
		const name = router.query.name?.toString();
		if (name) {
			form.setFieldValue("name", name);
			form.setFieldValue("level", ExerciseLevel.Intermediate);
		}
	}, [router.query]);

	const enabledFeatures = useEnabledCoreFeatures();
	const imageUrls = useQuery(
		["presignedUrl", images],
		async () => {
			const imageUrls = [];
			for (const image of images)
				imageUrls.push(await getPresignedGetUrl(image));
			return imageUrls;
		},
		{ staleTime: Infinity },
	);

	const createCustomExercise = useMutation({
		mutationFn: async (variables: CreateCustomExerciseMutationVariables) => {
			const { createCustomExercise } = await gqlClient.request(
				CreateCustomExerciseDocument,
				variables,
			);
			return createCustomExercise;
		},
		onSuccess: (data) => {
			if (data.id)
				router.push(
					withQuery(APP_ROUTES.fitness.exercises.details, { id: data.id }),
				);
		},
	});

	const fileUploadNowAllowed = !enabledFeatures?.data?.fileStorage;

	const uploadFiles = async (files: File[]) => {
		if (files.length > 0) {
			for (const file of files) {
				const uploadedKey = await uploadFileAndGetKey(
					file.name,
					file.type,
					await file.arrayBuffer(),
				);
				setImages.append(uploadedKey);
			}
			notifications.show({
				title: "Success",
				message: `Uploaded ${files.length} files`,
			});
		}
	};

	return (
		<>
			<Head>
				<title>Create Exercise | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					images={imageUrls?.data || []}
					externalLink={{ source: MetadataSource.Custom }}
				>
					<ScrollArea.Autosize mah={400}>
						<Box
							component="form"
							onSubmit={form.onSubmit((values) => {
								const muscles = values.muscles;
								const instructions = values.instructions;
								values.muscles = undefined;
								values.instructions = undefined;
								createCustomExercise.mutate({
									input: {
										id: 100,
										source: ExerciseSource.Custom,
										...values,
										attributes: {
											images,
											instructions: instructions?.split("\n") || [],
											muscles: muscles || [],
										},
									},
								});
							})}
						>
							<Stack>
								<Title>Create Exercise</Title>
								<TextInput
									label="Name"
									{...form.getInputProps("name")}
									required
									autoFocus
								/>
								<Select
									label="Type"
									{...form.getInputProps("lot")}
									data={Object.values(ExerciseLot)}
									required
								/>
								<Group wrap="nowrap">
									<Select
										label="Level"
										{...form.getInputProps("level")}
										data={Object.values(ExerciseLevel)}
										required
									/>
									<Select
										label="Force"
										{...form.getInputProps("force")}
										data={Object.values(ExerciseForce)}
									/>
								</Group>
								<Group wrap="nowrap">
									<Select
										label="Equipment"
										{...form.getInputProps("equipment")}
										data={Object.values(ExerciseEquipment)}
									/>
									<Select
										label="Mechanic"
										{...form.getInputProps("mechanic")}
										data={Object.values(ExerciseMechanic)}
									/>
								</Group>
								<MultiSelect
									label="Mucles"
									{...form.getInputProps("muscles")}
									data={Object.values(ExerciseMuscle)}
								/>
								<Textarea
									label="Instructions"
									description="Separate each instuction with a newline"
									{...form.getInputProps("instructions")}
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
						</Box>
					</ScrollArea.Autosize>
				</MediaDetailsLayout>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
