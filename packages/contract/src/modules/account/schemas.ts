import { Schema } from "effect";

import { UserPreferencesPatch } from "../../schema/user-preferences";
import { strictStruct } from "../../schema/utils";
import { ReportingTimeZone } from "../analytics/reporting";

export const UpdateUserPreferencesBody = strictStruct({
	...UserPreferencesPatch.fields,
	initializeReportingTimeZone: Schema.optional(ReportingTimeZone),
}).check(
	Schema.makeFilter(
		(body) =>
			body.initializeReportingTimeZone === undefined ||
			Object.keys(body).length === 1 ||
			"Reporting time zone initialization cannot include other preference updates",
	),
);

export type UpdateUserPreferencesBody = typeof UpdateUserPreferencesBody.Type;

export const TwoFactorStatus = Schema.Struct({
	enabled: Schema.Boolean,
	available: Schema.Boolean,
});

export type TwoFactorStatus = typeof TwoFactorStatus.Type;
