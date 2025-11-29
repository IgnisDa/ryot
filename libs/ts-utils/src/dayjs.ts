import dayjs, { type Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import isoWeek from "dayjs/plugin/isoWeek";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(isoWeek);
dayjs.extend(customParseFormat);

export type { Dayjs };
export { dayjs };
