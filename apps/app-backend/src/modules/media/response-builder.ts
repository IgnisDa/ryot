import { match } from "ts-pattern";
import type { ImageSchemaType } from "~/lib/db/schema";
import type { BuiltinMediaEntitySchemaSlug } from "~/lib/media/constants";
import {
	compareContinueItems,
	compareRateTheseItems,
	compareUpNextItems,
	resolveBuiltInMediaLifecycleState,
	resolveBuiltInMediaRateTheseMembership,
} from "./classification";
import type { BuiltInMediaOverviewResponse } from "./schemas";

export type BuiltInMediaOverviewSourceItem = {
	id: string;
	title: string;
	reviewAt: Date | null;
	backlogAt: Date | null;
	progressAt: Date | null;
	completeAt: Date | null;
	completedOn: Date | null;
	publishYear: number | null;
	totalUnits: number | null;
	reviewRating: number | null;
	image: ImageSchemaType | null;
	progressPercent: number | null;
	entitySchemaSlug: BuiltinMediaEntitySchemaSlug;
};

type ContinueSourceItem = BuiltInMediaOverviewSourceItem & { progressAt: Date };
type UpNextSourceItem = BuiltInMediaOverviewSourceItem & { backlogAt: Date };
type RateTheseSourceItem = BuiltInMediaOverviewSourceItem & {
	completeAt: Date;
};

const resolveContinueProgressAt = (item: ContinueSourceItem) => item.progressAt;

const resolveUpNextBacklogAt = (item: UpNextSourceItem) => item.backlogAt;

const resolveRateTheseCompletedAt = (item: RateTheseSourceItem) =>
	item.completedOn ?? item.completeAt;

const isContinueSourceItem = (
	item: BuiltInMediaOverviewSourceItem,
): item is ContinueSourceItem =>
	resolveBuiltInMediaLifecycleState(item) === "continue" &&
	item.progressAt !== null;

const isUpNextSourceItem = (
	item: BuiltInMediaOverviewSourceItem,
): item is UpNextSourceItem =>
	resolveBuiltInMediaLifecycleState(item) === "upNext" &&
	item.backlogAt !== null;

const isRateTheseSourceItem = (
	item: BuiltInMediaOverviewSourceItem,
): item is RateTheseSourceItem =>
	resolveBuiltInMediaRateTheseMembership(item) && item.completeAt !== null;

const compareContinueSourceItems = (
	left: BuiltInMediaOverviewSourceItem,
	right: BuiltInMediaOverviewSourceItem,
) =>
	compareContinueItems(
		{ entityId: left.id, progressAt: left.progressAt },
		{ entityId: right.id, progressAt: right.progressAt },
	);

const compareUpNextSourceItems = (
	left: BuiltInMediaOverviewSourceItem,
	right: BuiltInMediaOverviewSourceItem,
) =>
	compareUpNextItems(
		{ entityId: left.id, backlogAt: left.backlogAt },
		{ entityId: right.id, backlogAt: right.backlogAt },
	);

const compareRateTheseSourceItems = (
	left: BuiltInMediaOverviewSourceItem,
	right: BuiltInMediaOverviewSourceItem,
) =>
	compareRateTheseItems(
		{
			entityId: left.id,
			completeAt: left.completeAt,
			completedOn: left.completedOn,
		},
		{
			entityId: right.id,
			completeAt: right.completeAt,
			completedOn: right.completedOn,
		},
	);

const formatNumber = (value: number) => {
	if (Number.isInteger(value)) {
		return value.toString();
	}

	return value
		.toFixed(2)
		.replace(/\.0+$/, "")
		.replace(/(\.\d*[1-9])0+$/, "$1");
};

const roundToTwoDecimals = (value: number) =>
	Math.round((value + Number.EPSILON) * 100) / 100;

const resolveUnitLabel = (
	entitySchemaSlug: BuiltInMediaOverviewSourceItem["entitySchemaSlug"],
) =>
	match(entitySchemaSlug)
		.with("book", () => "pages")
		.with("anime", () => "episodes")
		.with("manga", () => "chapters")
		.exhaustive();

const resolveContinueCta = (
	entitySchemaSlug: BuiltInMediaOverviewSourceItem["entitySchemaSlug"],
) =>
	match(entitySchemaSlug)
		.with("anime", () => "Next Episode")
		.with("book", "manga", () => "Log Progress")
		.exhaustive();

const resolveCurrentUnits = (input: {
	totalUnits: number | null;
	progressPercent: number | null;
}) => {
	if (input.totalUnits === null || input.progressPercent === null) {
		return null;
	}

	const currentUnits = (input.totalUnits * input.progressPercent) / 100;
	return Number.isInteger(input.totalUnits)
		? Math.round(currentUnits)
		: roundToTwoDecimals(currentUnits);
};

const buildSubtitle = (publishYear: number | null) => ({
	raw: publishYear,
	label: publishYear === null ? null : publishYear.toString(),
});

const buildProgressLabel = (input: {
	totalUnits: number | null;
	currentUnits: number | null;
	progressPercent: number | null;
	entitySchemaSlug: BuiltInMediaOverviewSourceItem["entitySchemaSlug"];
}) => {
	if (input.currentUnits !== null && input.totalUnits !== null) {
		const unitLabel = resolveUnitLabel(input.entitySchemaSlug);
		return `${formatNumber(input.currentUnits)} / ${formatNumber(input.totalUnits)} ${unitLabel}`;
	}
	if (input.progressPercent !== null) {
		return `${formatNumber(input.progressPercent)}% complete`;
	}

	return "In progress";
};

export const buildBuiltInMediaOverviewResponse = (
	items: BuiltInMediaOverviewSourceItem[],
): BuiltInMediaOverviewResponse => {
	const continueItems = items
		.filter(isContinueSourceItem)
		.sort(compareContinueSourceItems)
		.map((item) => {
			const currentUnits = resolveCurrentUnits({
				totalUnits: item.totalUnits,
				progressPercent: item.progressPercent,
			});

			return {
				id: item.id,
				title: item.title,
				image: item.image,
				entitySchemaSlug: item.entitySchemaSlug,
				subtitle: buildSubtitle(item.publishYear),
				progressAt: resolveContinueProgressAt(item),
				progress: {
					currentUnits,
					totalUnits: item.totalUnits,
					progressPercent: item.progressPercent,
				},
				labels: {
					cta: resolveContinueCta(item.entitySchemaSlug),
					progress: buildProgressLabel({
						currentUnits,
						totalUnits: item.totalUnits,
						progressPercent: item.progressPercent,
						entitySchemaSlug: item.entitySchemaSlug,
					}),
				},
			};
		});

	const upNextItems = items
		.filter(isUpNextSourceItem)
		.sort(compareUpNextSourceItems)
		.map((item) => ({
			id: item.id,
			title: item.title,
			image: item.image,
			labels: { cta: "Start" as const },
			backlogAt: resolveUpNextBacklogAt(item),
			entitySchemaSlug: item.entitySchemaSlug,
			subtitle: buildSubtitle(item.publishYear),
		}));

	const rateTheseItems = items
		.filter(isRateTheseSourceItem)
		.sort(compareRateTheseSourceItems)
		.map((item) => ({
			id: item.id,
			title: item.title,
			image: item.image,
			reviewAt: item.reviewAt,
			rating: item.reviewRating,
			entitySchemaSlug: item.entitySchemaSlug,
			subtitle: buildSubtitle(item.publishYear),
			completedAt: resolveRateTheseCompletedAt(item),
		}));

	return {
		upNext: { items: upNextItems, count: upNextItems.length },
		continue: { items: continueItems, count: continueItems.length },
		rateThese: { items: rateTheseItems, count: rateTheseItems.length },
	};
};
