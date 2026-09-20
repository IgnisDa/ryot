import { notifications } from "@mantine/notifications";

export const showEntitySuccess = (
	entityName: string,
	action: "created" | "updated" | "deleted",
) => {
	notifications.show({
		color: "green",
		title: "Success",
		message: `${entityName} ${action}`,
	});
};

export const showEntityError = (
	entityName: string,
	action: "create" | "update" | "delete",
	customMessage?: string,
) => {
	notifications.show({
		color: "red",
		title: "Error",
		message: customMessage || `Failed to ${action} ${entityName}`,
	});
};
