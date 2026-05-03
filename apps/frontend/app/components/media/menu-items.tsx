import { Menu } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	type EntityLot,
	MarkEntityAsPartialDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { IconSearch } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import {
	useAddEntitiesToCollectionMutation,
	useRemoveEntitiesFromCollectionMutation,
	useUserDetails,
} from "~/lib/shared/hooks";
import {
	clientGqlService,
	refreshEntityDetails,
} from "~/lib/shared/react-query";
import { openConfirmationModal } from "~/lib/shared/ui-utils";

export const ToggleMediaMonitorMenuItem = (props: {
	formValue: string;
	entityLot: EntityLot;
	inCollections: Array<string>;
}) => {
	const isMonitored = props.inCollections.includes("Monitoring");
	const userDetails = useUserDetails();
	const addEntitiesToCollection = useAddEntitiesToCollectionMutation();
	const removeEntitiesFromCollection =
		useRemoveEntitiesFromCollectionMutation();

	const handleToggleMonitoring = () => {
		const entityData = {
			entityId: props.formValue,
			entityLot: props.entityLot,
		};

		if (isMonitored) {
			openConfirmationModal("Are you sure you want to stop monitoring?", () => {
				removeEntitiesFromCollection.mutate({
					collectionName: "Monitoring",
					creatorUserId: userDetails.id,
					entities: [entityData],
				});
			});
		} else {
			addEntitiesToCollection.mutate({
				collectionName: "Monitoring",
				creatorUserId: userDetails.id,
				entities: [entityData],
			});
		}
	};

	return (
		<Menu.Item
			onClick={handleToggleMonitoring}
			disabled={
				addEntitiesToCollection.isPending ||
				removeEntitiesFromCollection.isPending
			}
		>
			{isMonitored ? "Stop" : "Start"} monitoring
		</Menu.Item>
	);
};

export const WebSearchMenuItem = (props: { title: string }) => {
	return (
		<Menu.Item
			component="a"
			target="_blank"
			rel="noopener noreferrer"
			leftSection={<IconSearch size={14} />}
			href={`https://www.google.com/search?q=${encodeURIComponent(props.title)}`}
		>
			Search web
		</Menu.Item>
	);
};

export const MarkEntityAsPartialMenuItem = (props: {
	entityId: string;
	entityLot: EntityLot;
}) => {
	const mutation = useMutation({
		mutationFn: async (input: { entityId: string; entityLot: EntityLot }) =>
			clientGqlService.request(MarkEntityAsPartialDocument, { input }),
		onSuccess: () => {
			refreshEntityDetails(props.entityId);
			notifications.show({
				color: "green",
				title: "Success",
				message: "Entity will be updated in the background",
			});
		},
	});

	return (
		<Menu.Item
			disabled={mutation.isPending}
			onClick={() => {
				mutation.mutate({
					entityId: props.entityId,
					entityLot: props.entityLot,
				});
			}}
		>
			Update details
		</Menu.Item>
	);
};
