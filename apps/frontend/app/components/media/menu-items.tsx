import { Menu } from "@mantine/core";
import type { EntityLot } from "@ryot/generated/graphql/backend/graphql";
import { Form } from "react-router";
import { $path } from "safe-routes";
import { withQuery } from "ufo";
import {
	useAddEntitiesToCollection,
	useConfirmSubmit,
	useRemoveEntitiesFromCollection,
	useUserDetails,
} from "~/lib/shared/hooks";
import { openConfirmationModal } from "~/lib/shared/ui-utils";

export const ToggleMediaMonitorMenuItem = (props: {
	formValue: string;
	entityLot: EntityLot;
	inCollections: Array<string>;
}) => {
	const isMonitored = props.inCollections.includes("Monitoring");
	const userDetails = useUserDetails();
	const addEntitiesToCollection = useAddEntitiesToCollection();
	const removeEntitiesFromCollection = useRemoveEntitiesFromCollection();

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

export const MarkEntityAsPartialMenuItem = (props: {
	entityId: string;
	entityLot: EntityLot;
}) => {
	const submit = useConfirmSubmit();

	return (
		<Form
			replace
			method="POST"
			onSubmit={(e) => submit(e)}
			action={withQuery($path("/actions"), {
				intent: "markEntityAsPartial",
			})}
		>
			<input hidden name="entityId" defaultValue={props.entityId} />
			<input hidden name="entityLot" defaultValue={props.entityLot} />
			<Menu.Item type="submit">Update details</Menu.Item>
		</Form>
	);
};
