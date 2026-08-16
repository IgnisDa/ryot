import { type Dayjs, dayjs } from "./dayjs";

/**
 * Format a `Date` into a Rust `NaiveDate`
 */
export const formatDateToNaiveDate = (t: Date | Dayjs) => dayjs(t).format("YYYY-MM-DD");
