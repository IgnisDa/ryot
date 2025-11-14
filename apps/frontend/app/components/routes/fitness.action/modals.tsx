import { Button, Group, Modal, Stack, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconBellRinging } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { useUserDetails } from "~/lib/shared/hooks";
import type { Exercise } from "~/lib/state/fitness";
import { BulkDeleteDrawer } from "./bulk-delete-drawer";
import { UploadAssetsModal } from "./miscellaneous";
import { ReorderDrawer } from "./reorder";
import { DisplaySupersetModal } from "./supersets";
import { TimerAndStopwatchDrawer } from "./timer-and-stopwatch-drawer";
import type { FuncStartTimer } from "./types";

const NotificationPermissionModal = (props: {
	opened: boolean;
	onClose: () => void;
}) => {
	const userDetails = useUserDetails();
	const [, setHasAskedForNotificationPermission] = useLocalStorage(
		`HasAskedForNotificationPermission-${userDetails.id}`,
		false,
	);

	const handleClose = () => {
		setHasAskedForNotificationPermission(true);
		props.onClose();
	};

	const handleEnableNotifications = async () => {
		await Notification.requestPermission();
		handleClose();
	};

	return (
		<Modal
			opened={props.opened}
			onClose={handleClose}
			centered
			title={
				<Group>
					<IconBellRinging size={24} />
					<Title order={4}>Enable Workout Notifications</Title>
				</Group>
			}
		>
			<Stack gap="md">
				<Text>
					Allow notifications to stay on track with your workout. You'll receive
					alerts when your rest timer completes, even when the app is in the
					background.
				</Text>
				<Group justify="flex-end">
					<Button variant="subtle" onClick={handleClose}>
						Not Now
					</Button>
					<Button onClick={handleEnableNotifications}>
						Enable Notifications
					</Button>
				</Group>
			</Stack>
		</Modal>
	);
};

interface ModalsProps {
	stopTimer: () => void;
	timerDrawerOpened: boolean;
	startTimer: FuncStartTimer;
	openTimerDrawer: () => void;
	closeTimerDrawer: () => void;
	toggleTimerDrawer: () => void;
	pauseOrResumeTimer: () => void;
	bulkDeleteDrawerOpened: boolean;
	notificationModalOpened: boolean;
	closeBulkDeleteDrawer: () => void;
	closeNotificationModal: () => void;
	currentWorkoutExercises?: Array<Exercise>;
	exerciseToDelete: string | null | undefined;
	assetsModalOpened: string | null | undefined;
	supersetWithExerciseIdentifier: string | null;
	isReorderDrawerOpened: string | null | undefined;
	setSupersetModalOpened: (value: string | null) => void;
	setAssetsModalOpened: (value: string | null | undefined) => void;
	setIsReorderDrawerOpened: (value: string | null | undefined) => void;
}

export const WorkoutModals = (props: ModalsProps) => (
	<>
		<NotificationPermissionModal
			opened={props.notificationModalOpened}
			onClose={props.closeNotificationModal}
		/>
		<DisplaySupersetModal
			supersetWith={props.supersetWithExerciseIdentifier}
			onClose={() => props.setSupersetModalOpened(null)}
		/>
		<UploadAssetsModal
			modalOpenedBy={props.assetsModalOpened}
			closeModal={() => props.setAssetsModalOpened(undefined)}
		/>
		<BulkDeleteDrawer
			opened={props.bulkDeleteDrawerOpened}
			onClose={props.closeBulkDeleteDrawer}
			exerciseToDelete={props.exerciseToDelete}
		/>
		<ReorderDrawer
			exerciseToReorder={props.isReorderDrawerOpened}
			opened={props.isReorderDrawerOpened !== undefined}
			onClose={() => props.setIsReorderDrawerOpened(undefined)}
			key={props.currentWorkoutExercises?.map((e) => e.identifier).join(",")}
		/>
		<TimerAndStopwatchDrawer
			stopTimer={props.stopTimer}
			startTimer={props.startTimer}
			opened={props.timerDrawerOpened}
			onClose={props.closeTimerDrawer}
			pauseOrResumeTimer={props.pauseOrResumeTimer}
		/>
	</>
);

export function useWorkoutModals() {
	const userDetails = useUserDetails();
	const [assetsModalOpened, setAssetsModalOpened] = useState<
		string | null | undefined
	>(undefined);
	const [
		timerDrawerOpened,
		{
			open: openTimerDrawer,
			close: closeTimerDrawer,
			toggle: toggleTimerDrawer,
		},
	] = useDisclosure(false);
	const [exerciseToDelete, setExerciseToDelete] = useState<string | null>();
	const [isReorderDrawerOpened, setIsReorderDrawerOpened] = useState<
		string | null
	>();
	const [supersetWithExerciseIdentifier, setSupersetModalOpened] = useState<
		string | null
	>(null);
	const [hasAskedForNotificationPermission] = useLocalStorage(
		`HasAskedForNotificationPermission-${userDetails.id}`,
		false,
	);
	const [notificationModalOpened, setNotificationModalOpened] = useState(false);

	useEffect(() => {
		if (
			!hasAskedForNotificationPermission &&
			typeof Notification !== "undefined" &&
			Notification.permission !== "granted"
		) {
			setNotificationModalOpened(true);
		}
	}, [hasAskedForNotificationPermission]);

	const openBulkDeleteDrawer = (exerciseIdentifier: string | null) => {
		setExerciseToDelete(exerciseIdentifier);
		if (!exerciseIdentifier) return;
		setTimeout(() => {
			setExerciseToDelete((val) => (val === undefined ? undefined : null));
		}, 4000);
	};

	const closeBulkDeleteDrawer = () => {
		setExerciseToDelete(undefined);
	};

	const openReorderDrawer = (exerciseIdentifier: string | null) => {
		setIsReorderDrawerOpened(exerciseIdentifier);
		if (!exerciseIdentifier) return;
		setTimeout(() => {
			setIsReorderDrawerOpened((val) => (val === undefined ? undefined : null));
		}, 4000);
	};

	const closeNotificationModal = () => {
		setNotificationModalOpened(false);
	};

	return {
		openTimerDrawer,
		closeTimerDrawer,
		exerciseToDelete,
		toggleTimerDrawer,
		assetsModalOpened,
		timerDrawerOpened,
		openReorderDrawer,
		setAssetsModalOpened,
		openBulkDeleteDrawer,
		closeBulkDeleteDrawer,
		isReorderDrawerOpened,
		setSupersetModalOpened,
		closeNotificationModal,
		notificationModalOpened,
		setIsReorderDrawerOpened,
		supersetWithExerciseIdentifier,
		bulkDeleteDrawerOpened: exerciseToDelete !== undefined,
	};
}
