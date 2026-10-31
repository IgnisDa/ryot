import type { ReportingPeriod } from "@ryot-app/contract/modules/analytics/reporting";
import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/language";
import { and, castDate, gte, literal, lt } from "@ryot-app/ryotql";

export const withinPeriod = (
	at: ScalarExpression,
	period: null | Pick<ReportingPeriod, "endAt" | "startAt">,
) =>
	period === null
		? and()
		: and(gte(at, castDate(literal(period.startAt))), lt(at, castDate(literal(period.endAt))));
