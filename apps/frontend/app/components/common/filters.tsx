import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Button,
	Group,
	Modal,
	Select,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import {
	randomId,
	useDebouncedValue,
	useDidUpdate,
	useListState,
} from "@mantine/hooks";
import {
	type MediaCollectionFilter,
	MediaCollectionPresenceFilter,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconFilterOff,
	IconPlus,
	IconSearch,
	IconX,
} from "@tabler/icons-react";
import { produce } from "immer";
import Cookies from "js-cookie";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import {
	useAppSearchParam,
	useCoreDetails,
	useNonHiddenUserCollections,
} from "~/lib/shared/hooks";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import type { OnboardingTourStepTargets } from "~/lib/state/onboarding-tour";
import { ProRequiredAlert } from ".";

export const FiltersModal = (props: {
	title?: string;
	opened: boolean;
	cookieName: string;
	children: ReactNode;
	resetFilters?: () => void;
	closeFiltersModal: () => void;
}) => {
	const navigate = useNavigate();

	return (
		<Modal
			centered
			opened={props.opened}
			withCloseButton={false}
			onClose={props.closeFiltersModal}
		>
			<Stack>
				<Group justify="space-between">
					<Title order={3}>{props.title || "Filters"}</Title>
					<ActionIcon
						onClick={() => {
							props.resetFilters?.();
							navigate(".");
							props.closeFiltersModal();
							Cookies.remove(props.cookieName);
						}}
					>
						<IconFilterOff size={24} />
					</ActionIcon>
				</Group>
				{props.children}
			</Stack>
		</Modal>
	);
};

export const CollectionsFilter = (props: {
	cookieName: string;
	applied: MediaCollectionFilter[];
}) => {
	const coreDetails = useCoreDetails();
	const collections = useNonHiddenUserCollections();
	const [parent] = useAutoAnimate();
	const [_p, { setP }] = useAppSearchParam(props.cookieName);
	const [filters, filtersHandlers] = useListState<
		MediaCollectionFilter & { id: string }
	>((props.applied || []).map((a) => ({ ...a, id: randomId() })));

	useDidUpdate(() => {
		const applicableFilters = coreDetails.isServerKeyValidated
			? filters
			: filters.slice(0, 1);
		const final = applicableFilters
			.filter((f) => f.collectionId)
			.map((a) => `${a.collectionId}:${a.presence}`)
			.join(",");
		setP("collections", final);
	}, [filters]);

	return (
		<Stack gap="xs">
			<Group wrap="nowrap" justify="space-between">
				<Text size="sm" c="dimmed">
					Collection filters
				</Text>
				<Button
					size="compact-xs"
					variant="transparent"
					leftSection={<IconPlus size={14} />}
					onClick={() => {
						filtersHandlers.append({
							id: randomId(),
							collectionId: "",
							presence: MediaCollectionPresenceFilter.PresentIn,
						});
					}}
				>
					Add
				</Button>
			</Group>
			{filters.length > 0 ? (
				<Stack gap="xs" px={{ md: "xs" }} ref={parent}>
					{filters.map((f, idx) => (
						<Group key={f.id} justify="space-between" wrap="nowrap">
							{idx !== 0 ? (
								<Text size="xs" c="dimmed">
									OR
								</Text>
							) : null}
							<Select
								size="xs"
								value={f.presence}
								allowDeselect={false}
								data={convertEnumToSelectData(MediaCollectionPresenceFilter)}
								onChange={(v) =>
									filtersHandlers.setItem(
										idx,
										produce(f, (d) => {
											d.presence = v as MediaCollectionPresenceFilter;
										}),
									)
								}
							/>
							<Select
								size="xs"
								searchable
								allowDeselect={false}
								value={f.collectionId}
								placeholder="Select a collection"
								data={collections.map((c) => ({
									label: c.name,
									value: c.id.toString(),
								}))}
								onChange={(v) =>
									filtersHandlers.setItem(
										idx,
										produce(f, (d) => {
											d.collectionId = v || "";
										}),
									)
								}
							/>
							<ActionIcon
								size="xs"
								color="red"
								onClick={() => filtersHandlers.remove(idx)}
							>
								<IconX />
							</ActionIcon>
						</Group>
					))}
					{filters.length > 1 && !coreDetails.isServerKeyValidated ? (
						<ProRequiredAlert tooltipLabel="Only the first filter will be applied" />
					) : null}
				</Stack>
			) : null}
		</Stack>
	);
};

export const DebouncedSearchInput = (props: {
	queryParam?: string;
	placeholder?: string;
	initialValue?: string;
	enhancedQueryParams?: string;
	onChange?: (query: string) => void;
	tourControl?: {
		target: OnboardingTourStepTargets;
		onQueryChange: (query: string) => void;
	};
}) => {
	const [query, setQuery] = useState(props.initialValue || "");
	const [debounced] = useDebouncedValue(query, 1000);
	const [_e, { setP }] = useAppSearchParam(
		props.enhancedQueryParams || "query",
	);

	useDidUpdate(() => {
		const query = debounced.trim().toLowerCase();
		if (props.onChange) {
			props.onChange(query);
			return;
		}
		setP(props.queryParam || "query", query);
		props.tourControl?.onQueryChange(query);
	}, [debounced]);

	return (
		<TextInput
			name="query"
			value={query}
			autoComplete="off"
			autoCapitalize="none"
			style={{ flexGrow: 1 }}
			leftSection={<IconSearch />}
			className={props.tourControl?.target}
			placeholder={props.placeholder || "Search..."}
			onChange={(e) => setQuery(e.currentTarget.value)}
			rightSection={
				query ? (
					<ActionIcon onClick={() => setQuery("")}>
						<IconX size={16} />
					</ActionIcon>
				) : null
			}
		/>
	);
};
