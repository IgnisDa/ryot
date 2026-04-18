import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { zodNonEmptyTrimmedString } from "@ryot/ts-utils";
import { z } from "zod";
import { useAppForm } from "#/hooks/forms";

const createCollectionFormSchema = z.object({
	name: zodNonEmptyTrimmedString,
});

type CreateCollectionFormValues = z.infer<typeof createCollectionFormSchema>;

function useCreateCollectionForm(props: {
	onSubmit: (name: string) => Promise<void>;
}) {
	return useAppForm({
		validators: { onChange: createCollectionFormSchema as never },
		defaultValues: { name: "" } satisfies CreateCollectionFormValues,
		onSubmit: async ({ value }) => {
			await props.onSubmit(value.name);
		},
	});
}

export function CreateCollectionModal(props: {
	opened: boolean;
	onClose: () => void;
	isSubmitting: boolean;
	errorMessage: string | null;
	onSubmit: (name: string) => Promise<void>;
}) {
	const form = useCreateCollectionForm({ onSubmit: props.onSubmit });

	return (
		<Modal
			centered
			size="sm"
			opened={props.opened}
			title="New collection"
			onClose={props.onClose}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.AppForm>
					<Stack gap="md">
						{props.errorMessage ? (
							<Text c="red" size="sm">
								{props.errorMessage}
							</Text>
						) : null}
						<form.AppField name="name">
							{(field) => (
								<field.TextField
									required
									label="Name"
									placeholder="My collection"
									disabled={props.isSubmitting}
								/>
							)}
						</form.AppField>
						<Group justify="flex-end" gap="md">
							<Button
								type="button"
								variant="subtle"
								onClick={props.onClose}
								disabled={props.isSubmitting}
							>
								Cancel
							</Button>
							<form.SubmitButton
								label="Create"
								disabled={props.isSubmitting}
								pendingLabel="Creating..."
							/>
						</Group>
					</Stack>
				</form.AppForm>
			</form>
		</Modal>
	);
}
