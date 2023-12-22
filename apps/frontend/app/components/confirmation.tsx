import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import {
	confirmable,
	ConfirmDialogProps,
	createConfirmationCreater,
	createMountPoint,
	createReactTreeMounter,
} from "react-confirm";

type ConfirmationProps = {
	confirmation: string;
	title?: string;
	okLabel?: string;
	cancelLabel?: string;
};

type ConfirmationResponse = boolean;

const Confirmation: React.FC<
	ConfirmDialogProps<ConfirmationProps, ConfirmationResponse>
> = (props) => {
	return (
		<Modal
			opened={props.show}
			onClose={() => props.proceed(false)}
			size="auto"
			centered
			withCloseButton={false}
		>
			<Stack>
				<Text>{props.confirmation}</Text>
				<Group justify="space-between">
					<Button onClick={() => props.proceed(false)} variant="outline">
						{props.cancelLabel ?? "Cancel"}
					</Button>
					<Button onClick={() => props.proceed(true)} color="red">
						{props.okLabel ?? "OK"}
					</Button>
				</Group>
			</Stack>
		</Modal>
	);
};

const AppConfirmable = confirmable<ConfirmationProps, ConfirmationResponse>(
	Confirmation,
);

const mounter = createReactTreeMounter();

export const createConfirmation = createConfirmationCreater(mounter);

export const MountPoint = createMountPoint(mounter);

export const confirmWrapper = createConfirmation<
	ConfirmationProps,
	ConfirmationResponse
>(AppConfirmable);
