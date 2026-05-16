import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { type PaginationState, type Row, useTable } from "@tanstack/react-table";
import { AsyncResult } from "effect/unstable/reactivity";
import { type Dispatch, type SetStateAction, useEffect, useEffectEvent, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import {
	deleteUserAtom,
	GOD_MODE_USERS_PAGE_SIZE,
	godModeUsersPageAtom,
	resetUserAtom,
	resetUserPasswordAtom,
	setUserDisabledAtom,
	type GodModeUser,
} from "@/modules/god-mode/atoms";
import { isUnauthorizedCause } from "@/modules/god-mode/errors";
import { GOD_MODE_INVALID_TOKEN, useGodModeSession } from "@/modules/god-mode/session";
import { GodModeUserRow } from "@/modules/god-mode/user-row";
import {
	godModeUserTableColumns,
	godModeUserTableFeatures,
} from "@/modules/god-mode/user-table-model";
import { AppIcon } from "@/modules/icons";
import { AppButton } from "@/modules/ui/button";
import { AppLoadMore } from "@/modules/ui/pagination";
import { AppSearchField } from "@/modules/ui/search-field";
import { AppStatusState } from "@/modules/ui/status-state";
import { AppTableHeader } from "@/modules/ui/table";
import { useDebouncedSearch } from "@/modules/ui/use-debounced-search";

const emptyUsers: GodModeUser[] = [];
const initialPagination: PaginationState = {
	pageIndex: 0,
	pageSize: GOD_MODE_USERS_PAGE_SIZE,
};

function UserRow(props: {
	readonly onUnauthorized: () => void;
	readonly row: Row<typeof godModeUserTableFeatures, GodModeUser>;
}) {
	const { scope } = useGodModeSession();
	const request = { ...scope, userId: props.row.original.id };
	const resetUser = useAtomSet(resetUserAtom(request), { mode: "promiseExit" });
	const deleteUser = useAtomSet(deleteUserAtom(request), { mode: "promiseExit" });
	const setDisabled = useAtomSet(setUserDisabledAtom(request), { mode: "promiseExit" });
	const resetPassword = useAtomSet(resetUserPasswordAtom(request), { mode: "promiseExit" });

	return (
		<GodModeUserRow
			row={props.row}
			onUnauthorized={props.onUnauthorized}
			actions={{ deleteUser, resetUser, resetPassword, setDisabled }}
		/>
	);
}

function UsersPage(props: {
	readonly query: string;
	readonly isLast: boolean;
	readonly globalFilter: string;
	readonly pagination: PaginationState;
	readonly onPaginationChange: Dispatch<SetStateAction<PaginationState>>;
}) {
	const { lock, scope } = useGodModeSession();
	const offset = props.pagination.pageIndex * props.pagination.pageSize;
	const pageAtom = godModeUsersPageAtom({ ...scope, offset, search: props.query });
	const page = useAtomValue(pageAtom);
	const refresh = useAtomRefresh(pageAtom);
	const unauthorized = AsyncResult.isFailure(page) && isUnauthorizedCause(page.cause);
	const escalate = useEffectEvent(() => lock(GOD_MODE_INVALID_TOKEN));
	const table = useTable({
		manualFiltering: true,
		manualPagination: true,
		getRowId: (user) => user.id,
		columns: godModeUserTableColumns,
		features: godModeUserTableFeatures,
		onPaginationChange: props.onPaginationChange,
		state: { globalFilter: props.globalFilter, pagination: props.pagination },
		data: AsyncResult.isSuccess(page) ? page.value.users : emptyUsers,
		rowCount: AsyncResult.isSuccess(page) ? page.value.total : undefined,
	});

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
		return offset === 0 ? (
			<AppStatusState
				className="py-12"
				detail="Loading users..."
				icon={<ActivityIndicator accessibilityLabel="Loading users" />}
			/>
		) : (
			<AppLoadMore hasMore isLoading name="users" loaded={offset} onLoadMore={() => {}} />
		);
	}

	const { users } = page.value;

	if (offset === 0 && users.length === 0) {
		return (
			<AppStatusState
				className="py-12"
				title="No users found"
				icon={<AppIcon className="text-text-subtle" name="search-x" size={36} />}
				detail={
					props.query === ""
						? "This server has no user accounts yet."
						: `No user email matches “${props.query}”.`
				}
			/>
		);
	}

	return (
		<>
			{table.getRowModel().rows.map((row) => (
				<UserRow key={row.id} row={row} onUnauthorized={escalate} />
			))}
			{props.isLast ? (
				<AppLoadMore
					name="users"
					isLoading={page.waiting}
					loaded={offset + users.length}
					hasMore={table.getCanNextPage()}
					onLoadMore={() => table.nextPage()}
				/>
			) : null}
		</>
	);
}

export function GodModeUserTable() {
	const search = useDebouncedSearch();
	const [paginationState, setPaginationState] = useState({
		query: "",
		pagination: initialPagination,
	});
	const pagination =
		paginationState.query === search.query ? paginationState.pagination : initialPagination;
	const setPagination: Dispatch<SetStateAction<PaginationState>> = (updater) =>
		setPaginationState((current) => {
			const currentPagination =
				current.query === search.query ? current.pagination : initialPagination;
			return {
				query: search.query,
				pagination: typeof updater === "function" ? updater(currentPagination) : updater,
			};
		});
	const headerTable = useTable({
		data: emptyUsers,
		manualFiltering: true,
		manualPagination: true,
		getRowId: (user) => user.id,
		columns: godModeUserTableColumns,
		onPaginationChange: setPagination,
		features: godModeUserTableFeatures,
		state: { globalFilter: search.value, pagination },
		onGlobalFilterChange: (updater) =>
			search.onChange(typeof updater === "function" ? updater(search.value) : updater),
	});
	const pages = Array.from({ length: pagination.pageIndex + 1 }, (_, pageIndex) => ({
		pageIndex,
		pageSize: pagination.pageSize,
	}));

	return (
		<View className="gap-5">
			<AppSearchField
				name="users by email"
				className="w-full md:w-80"
				search={{
					query: search.query,
					value: search.value,
					onClear: search.onClear,
					onSubmit: search.onSubmit,
					onChange: (value) => headerTable.setGlobalFilter(value),
					isSearching: search.value.trim() !== search.query,
				}}
			/>
			<View className="w-full">
				<AppTableHeader table={headerTable} />
				{pages.map((pagePagination, index) => (
					<UsersPage
						query={search.query}
						pagination={pagePagination}
						globalFilter={search.value}
						key={pagePagination.pageIndex}
						onPaginationChange={setPagination}
						isLast={index === pages.length - 1}
					/>
				))}
			</View>
		</View>
	);
}
