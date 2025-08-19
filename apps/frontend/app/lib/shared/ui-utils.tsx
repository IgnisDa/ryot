import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { PresignedPutS3UrlDocument } from "@ryot/generated/graphql/backend/graphql";
import { startCase } from "@ryot/ts-utils";
import { $path } from "safe-routes";
import { clientGqlService } from "./react-query";

export const generateColor = (seed: number) => {
	const color = Math.floor(Math.abs(Math.sin(seed) * 16777215));
	let newColor = color.toString(16);
	while (newColor.length < 6) newColor = `0${color}`;
	return `#${newColor}`;
};

export const getStringAsciiValue = (input: string) => {
	let total = 0;
	for (let i = 0; i < input.length; i++) total += input.charCodeAt(i);
	return total;
};

export function selectRandomElement<T>(array: T[], input: string): T {
	return array[(getStringAsciiValue(input) + array.length) % array.length];
}

export function getSurroundingElements<T>(
	array: Array<T>,
	elementIndex: number,
): Array<number> {
	if (array.length === 1) return [0];
	const lastIndex = array.length - 1;
	if (elementIndex === 0) return [lastIndex, elementIndex, elementIndex + 1];
	if (elementIndex === lastIndex) return [elementIndex - 1, elementIndex, 0];
	return [elementIndex - 1, elementIndex, elementIndex + 1];
}

export const openConfirmationModal = (title: string, onConfirm: () => void) =>
	modals.openConfirmModal({
		title: "Confirmation",
		onConfirm: onConfirm,
		children: <Text size="sm">{title}</Text>,
		labels: { confirm: "Confirm", cancel: "Cancel" },
	});

export const clientSideFileUpload = async (file: File, prefix: string) => {
	const body = await file.arrayBuffer();
	const { presignedPutS3Url } = await clientGqlService.request(
		PresignedPutS3UrlDocument,
		{ input: { fileName: file.name, prefix } },
	);
	await fetch(presignedPutS3Url.uploadUrl, {
		body,
		method: "PUT",
		headers: { "Content-Type": file.type },
	});
	return presignedPutS3Url.key;
};

export const convertEnumToSelectData = (value: {
	[id: number]: string;
}) =>
	Object.values(value).map((v) => ({
		value: v,
		label: startCase(v.toString().toLowerCase()),
	}));

export const forcedDashboardPath = $path("/", { ignoreLandingPath: "true" });
