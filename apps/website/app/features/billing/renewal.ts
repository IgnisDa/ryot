import dayjs, { type Dayjs } from "dayjs";
import { match } from "ts-pattern";

import type { TPlanTypes } from "~/drizzle/schema.server";

export const gracePeriodDays = 7;

export const formatDateToNaiveDate = (date: Date | Dayjs) => dayjs(date).format("YYYY-MM-DD");

export const calculateRenewalDate = (planType: TPlanTypes, baseDate: Date | Dayjs) => {
	const date = dayjs(baseDate);
	return match(planType)
		.with("free", "lifetime", () => null)
		.with("yearly", () => date.add(1, "year"))
		.with("monthly", () => date.add(1, "month"))
		.exhaustive();
};
