import {
	columnFilteringFeature,
	createColumnHelper,
	globalFilteringFeature,
	metaHelper,
	rowPaginationFeature,
	tableFeatures,
} from "@tanstack/react-table";
import clsx from "clsx";
import { Text, View } from "react-native";

import type { GodModeUser } from "@/modules/god-mode/atoms";
import { formatLocalDateLabel } from "@/modules/ui/date";
import type { AppTableColumnMeta } from "@/modules/ui/table";

const authBadges = {
	oidc: { label: "OIDC", box: "bg-info-soft", text: "text-info" },
	none: { label: "None", box: "bg-surface-2", text: "text-text-subtle" },
	mixed: { label: "Mixed", box: "bg-accent-soft", text: "text-accent-text" },
	credential: { label: "Password", box: "bg-surface-2", text: "text-text-muted" },
} satisfies Record<GodModeUser["authState"], { box: string; text: string; label: string }>;

function UserEmailCell(props: { readonly user: GodModeUser }) {
	const isDisabled = props.user.disabledAt !== null;

	return (
		<View className="gap-0.5">
			<Text
				numberOfLines={1}
				className={clsx(
					"font-ui-medium text-[15px]",
					isDisabled ? "text-text-muted line-through" : "text-text",
				)}
			>
				{props.user.email}
			</Text>
			<Text numberOfLines={1} className="font-ui text-[13px] text-text-muted md:hidden">
				{props.user.name}
			</Text>
			{props.user.disabledAt && (
				<Text className="font-ui text-xs text-text-subtle">
					Disabled since {formatLocalDateLabel(props.user.disabledAt)}
				</Text>
			)}
		</View>
	);
}

function UserNameCell(props: { readonly name: string }) {
	return (
		<Text numberOfLines={1} className="font-ui text-sm text-text-muted">
			{props.name}
		</Text>
	);
}

function UserAuthCell(props: { readonly state: GodModeUser["authState"] }) {
	const badge = authBadges[props.state];

	return (
		<View className={clsx("self-start rounded-pill px-2.5 py-0.5", badge.box)}>
			<Text className={clsx("font-ui-medium text-xs", badge.text)}>{badge.label}</Text>
		</View>
	);
}

function UserStatusCell(props: { readonly disabledAt: string | null }) {
	const isDisabled = props.disabledAt !== null;

	return (
		<View
			className={clsx(
				"self-start rounded-pill px-2.5 py-0.5",
				isDisabled ? "bg-surface-2" : "bg-success-soft",
			)}
		>
			<Text className={clsx("font-ui-medium text-xs", isDisabled ? "text-danger" : "text-success")}>
				{isDisabled ? "Disabled" : "Enabled"}
			</Text>
		</View>
	);
}

function UserCreatedCell(props: { readonly createdAt: string }) {
	return (
		<Text numberOfLines={1} className="font-ui text-sm text-text-muted">
			{formatLocalDateLabel(props.createdAt)}
		</Text>
	);
}

export const godModeUserTableFeatures = tableFeatures({
	rowPaginationFeature,
	columnFilteringFeature,
	globalFilteringFeature,
	columnMeta: metaHelper<AppTableColumnMeta>(),
});

const columnHelper = createColumnHelper<typeof godModeUserTableFeatures, GodModeUser>();

export const godModeUserTableColumns = columnHelper.columns([
	columnHelper.accessor("email", {
		header: "Email",
		meta: { className: "min-w-0 flex-1" },
		cell: (info) => <UserEmailCell user={info.row.original} />,
	}),
	columnHelper.accessor("name", {
		header: "Name",
		meta: { className: "hidden w-40 shrink-0 md:flex" },
		cell: (info) => <UserNameCell name={info.getValue()} />,
	}),
	columnHelper.accessor("authState", {
		header: "Auth",
		meta: { className: "hidden w-24 shrink-0 md:flex" },
		cell: (info) => <UserAuthCell state={info.getValue()} />,
	}),
	columnHelper.accessor("disabledAt", {
		header: "Status",
		meta: { className: "w-24 shrink-0" },
		cell: (info) => <UserStatusCell disabledAt={info.getValue()} />,
	}),
	columnHelper.accessor("createdAt", {
		header: "Created",
		meta: { className: "hidden w-28 shrink-0 lg:flex" },
		cell: (info) => <UserCreatedCell createdAt={info.getValue()} />,
	}),
	columnHelper.display({
		header: "",
		id: "actions",
		meta: { className: "w-11 shrink-0 items-end" },
	}),
]);
