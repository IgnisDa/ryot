import { dayjs } from "@ryot/ts-utils";
import { match } from "ts-pattern";
import type { ImageSchemaType } from "~/lib/db/schema";
import type {
	BuiltinMediaEntitySchemaSlug,
	BuiltinMediaEventSchemaSlug,
} from "~/lib/media/constants";
import {
	compareContinueItems,
	compareRateTheseItems,
	compareUpNextItems,
} from "./classification";
import type {
	BuiltInMediaOverviewContinueResponse,
	BuiltInMediaOverviewRateTheseResponse,
	BuiltInMediaOverviewRecentActivityResponse,
	BuiltInMediaOverviewResponse,
	BuiltInMediaOverviewUpNextResponse,
	BuiltInMediaOverviewWeekActivityResponse,
} from "./schemas";

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

export type ContinueSourceItem = BuiltInMediaOverviewSourceItem & {
	progressAt: Date;
};
export type UpNextSourceItem = BuiltInMediaOverviewSourceItem & {
	backlogAt: Date;
};
export type RateTheseSourceItem = BuiltInMediaOverviewSourceItem & {
	completeAt: Date;
};

export type RecentActivitySourceItem = {
	id: string;
	entityId: string;
	occurredAt: Date;
	rating: number | null;
	eventSchemaSlug: BuiltinMediaEventSchemaSlug;
	entity: {
		name: string;
		image: ImageSchemaType | null;
		entitySchemaSlug: BuiltinMediaEntitySchemaSlug;
	};
};

export type WeekActivitySourceItem = {
	date: Date;
	count: number;
};

const resolveContinueProgressAt = (item: ContinueSourceItem) => item.progressAt;

const resolveUpNextBacklogAt = (item: UpNextSourceItem) => item.backlogAt;

const resolveRateTheseCompletedAt = (item: RateTheseSourceItem) =>
	item.completedOn ?? item.completeAt;

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
		.with("audiobook", () => "minutes")
		.exhaustive();

const resolveContinueCta = (
	entitySchemaSlug: BuiltInMediaOverviewSourceItem["entitySchemaSlug"],
) =>
	match(entitySchemaSlug)
		.with("anime", () => "Next Episode")
		.with("book", "manga", "audiobook", () => "Log Progress")
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

const compareContinueSourceItems = (
	left: ContinueSourceItem,
	right: ContinueSourceItem,
) =>
	compareContinueItems(
		{ entityId: left.id, progressAt: left.progressAt },
		{ entityId: right.id, progressAt: right.progressAt },
	);

const compareUpNextSourceItems = (
	left: UpNextSourceItem,
	right: UpNextSourceItem,
) =>
	compareUpNextItems(
		{ entityId: left.id, backlogAt: left.backlogAt },
		{ entityId: right.id, backlogAt: right.backlogAt },
	);

const compareRateTheseSourceItems = (
	left: RateTheseSourceItem,
	right: RateTheseSourceItem,
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

export const buildBuiltInMediaOverviewResponse = (input: {
	upNextItems: UpNextSourceItem[];
	continueItems: ContinueSourceItem[];
	rateTheseItems: RateTheseSourceItem[];
}): BuiltInMediaOverviewResponse => {
	return {
		upNext: buildUpNextSectionResponse(input.upNextItems),
		continue: buildContinueSectionResponse(input.continueItems),
		rateThese: buildRateTheseSectionResponse(input.rateTheseItems),
	};
};

export const buildUpNextSectionResponse = (
	items: UpNextSourceItem[],
): BuiltInMediaOverviewUpNextResponse => {
	const upNextItems = items.sort(compareUpNextSourceItems).map((item) => ({
		id: item.id,
		title: item.title,
		image: item.image,
		labels: { cta: "Start" as const },
		backlogAt: resolveUpNextBacklogAt(item),
		entitySchemaSlug: item.entitySchemaSlug,
		subtitle: buildSubtitle(item.publishYear),
	}));

	return { items: upNextItems, count: upNextItems.length };
};

export const buildContinueSectionResponse = (
	items: ContinueSourceItem[],
): BuiltInMediaOverviewContinueResponse => {
	const continueItems = items.sort(compareContinueSourceItems).map((item) => {
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

	return { items: continueItems, count: continueItems.length };
};

export const buildRateTheseSectionResponse = (
	items: RateTheseSourceItem[],
): BuiltInMediaOverviewRateTheseResponse => {
	const rateTheseItems = items
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

	return { items: rateTheseItems, count: rateTheseItems.length };
};

export const buildRecentActivitySectionResponse = (
	items: RecentActivitySourceItem[],
): BuiltInMediaOverviewRecentActivityResponse => {
	const activityItems = [...items]
		.sort((left, right) => {
			const occurredAtDiff =
				dayjs(right.occurredAt).valueOf() - dayjs(left.occurredAt).valueOf();
			if (occurredAtDiff !== 0) {
				return occurredAtDiff;
			}

			return right.id.localeCompare(left.id);
		})
		.map((item) => ({
			id: item.id,
			entity: item.entity,
			rating: item.rating,
			entityId: item.entityId,
			occurredAt: item.occurredAt,
			eventSchemaSlug: item.eventSchemaSlug,
		}));

	return { items: activityItems, count: activityItems.length };
};

export const buildWeekActivitySectionResponse = (input: {
	items: WeekActivitySourceItem[];
}): BuiltInMediaOverviewWeekActivityResponse => {
	const weekItems = [...input.items]
		.sort(
			(left, right) => dayjs(left.date).valueOf() - dayjs(right.date).valueOf(),
		)
		.map((item) => ({
			count: item.count,
			dayLabel: dayjs.utc(item.date).format("ddd"),
		}));

	return { items: weekItems, count: weekItems.length };
};
