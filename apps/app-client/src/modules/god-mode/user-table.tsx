import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import clsx from "clsx";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useEffectEvent, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import {
	deleteUserAtom,
	godModeUsersPageAtom,
	resetUserAtom,
	resetUserPasswordAtom,
	setUserDisabledAtom,
	type GodModeUser,
} from "@/modules/god-mode/atoms";
import { isUnauthorizedCause } from "@/modules/god-mode/errors";
import { godModePageOffsets, hasMoreGodModeUsers } from "@/modules/god-mode/pagination";
import { GOD_MODE_INVALID_TOKEN, useGodModeSession } from "@/modules/god-mode/session";
import { godModeUserColumns } from "@/modules/god-mode/user-columns";
import { GodModeUserRow } from "@/modules/god-mode/user-row";
import { AppIcon } from "@/modules/icons";
import { AppButton } from "@/modules/ui/button";
import { AppLoadMore } from "@/modules/ui/pagination";
import { AppStatusState } from "@/modules/ui/status-state";

const headers = [
	{ label: "Email", className: godModeUserColumns.email },
	{ label: "Name", className: godModeUserColumns.name },
	{ label: "Auth", className: godModeUserColumns.auth },
	{ label: "Status", className: godModeUserColumns.status },
	{ label: "Created", className: godModeUserColumns.created },
	{ label: "", className: godModeUserColumns.actions },
] as const;

function UserRow(props: { readonly user: GodModeUser; readonly onUnauthorized: () => void }) {
	const { scope } = useGodModeSession();
	const request = { ...scope, userId: props.user.id };
	const resetUser = useAtomSet(resetUserAtom(request), { mode: "promiseExit" });
	const deleteUser = useAtomSet(deleteUserAtom(request), { mode: "promiseExit" });
	const setDisabled = useAtomSet(setUserDisabledAtom(request), { mode: "promiseExit" });
	const resetPassword = useAtomSet(resetUserPasswordAtom(request), { mode: "promiseExit" });

	return (
		<GodModeUserRow
			user={props.user}
			onUnauthorized={props.onUnauthorized}
			actions={{ deleteUser, resetUser, resetPassword, setDisabled }}
		/>
	);
}

function UsersPage(props: {
	readonly offset: number;
	readonly search: string;
	readonly isLast: boolean;
	readonly onLoadMore: () => void;
}) {
	const { lock, scope } = useGodModeSession();
	const pageAtom = godModeUsersPageAtom({ ...scope, offset: props.offset, search: props.search });
	const page = useAtomValue(pageAtom);
	const refresh = useAtomRefresh(pageAtom);
	const unauthorized = AsyncResult.isFailure(page) && isUnauthorizedCause(page.cause);
	const escalate = useEffectEvent(() => lock(GOD_MODE_INVALID_TOKEN));

	useEffect(() => {
		if (unauthorized) {
			escalate();
		}
	}, [unauthorized]);

	if (unauthorized) {
		return null;
	}

	if (AsyncResult.isFailure(page)) {
		return (
			<AppStatusState
				className="py-10"
				detailTone="danger"
				action={<AppButton label="Retry" onPress={refresh} />}
				detail="Could not load users. Check the server and try again."
			/>
		);
	}

	if (!AsyncResult.isSuccess(page)) {
		return props.offset === 0 ? (
			<AppStatusState
				className="py-12"
				detail="Loading users..."
				icon={<ActivityIndicator accessibilityLabel="Loading users" />}
			/>
		) : (
			<AppLoadMore hasMore isLoading name="users" loaded={props.offset} onLoadMore={() => {}} />
		);
	}

	const { total, users } = page.value;

	if (props.offset === 0 && users.length === 0) {
		return (
			<AppStatusState
				className="py-12"
				title="No users found"
				icon={<AppIcon className="text-text-subtle" name="search-x" size={36} />}
				detail={
					props.search === ""
						? "This server has no user accounts yet."
						: `No user email matches “${props.search}”.`
				}
			/>
		);
	}

	return (
		<>
			{users.map((user) => (
				<UserRow key={user.id} user={user} onUnauthorized={escalate} />
			))}
			{props.isLast ? (
				<AppLoadMore
					name="users"
					isLoading={page.waiting}
					onLoadMore={props.onLoadMore}
					loaded={props.offset + users.length}
					hasMore={hasMoreGodModeUsers({ total, offset: props.offset, loaded: users.length })}
				/>
			) : null}
		</>
	);
}

export function GodModeUserTable(props: { readonly search: string }) {
	const [pageCount, setPageCount] = useState(1);
	const offsets = godModePageOffsets(pageCount);

	return (
		<View className="w-full">
			<View className="h-8.5 flex-row items-center gap-3 border-b border-border md:gap-4">
				{headers.map((header) => (
					<View key={header.label} className={clsx(header.className, "justify-center")}>
						<Text
							numberOfLines={1}
							className="font-ui-semibold text-[11.5px] uppercase tracking-[0.6px] text-text-subtle"
						>
							{header.label}
						</Text>
					</View>
				))}
			</View>
			{offsets.map((offset, index) => (
				<UsersPage
					key={offset}
					offset={offset}
					search={props.search}
					isLast={index === offsets.length - 1}
					onLoadMore={() => setPageCount((current) => current + 1)}
				/>
			))}
		</View>
	);
}
