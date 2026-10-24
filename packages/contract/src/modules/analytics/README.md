# Reporting selections

`reporting.ts` supplies environment-neutral account reporting contracts. A `ReportingSelection`
contains a range, comparison mode, and automatic or explicit day/week/month/year grouping.

- Rolling ranges include today and the preceding calendar days in the reporting timezone.
- Calendar ranges select the whole current or preceding Monday-start week, month, or year.
- Custom `startDate` and `endDate` are inclusive calendar dates.
- All time has no instant bounds and no previous-period comparison.

`resolveReportingSelection(selection, { now, timeZone })` resolves dates from the supplied clock.
Finite `current` and `previous` periods have half-open UTC `startAt`/`endAt` boundaries and inclusive
local `startDate`/`endDate` labels. Previous calendar periods use calendar arithmetic, so months and
years can have different lengths. Rolling/custom comparisons contain the same number of local days;
their elapsed hours can differ across daylight-saving transitions.

Automatic grouping uses days for up to 90 days, weeks for up to 730 days, months for up to 3,653 days,
and years for longer or unbounded ranges. Recipes must still handle grouped-result `hasMore`,
especially when combining multiple series or using explicit fine grouping.

`reportingSelectionSearch` and `parseReportingSelection` encode the selection in the `reporting` URL
parameter. Missing or malformed input selects the default: rolling 30 days, previous-period
comparison, automatic grouping. `reportingSelectionKey` contains only the selection and timezone;
query execution resolves its moving boundaries from the schedule clock.

The account stores a validated nullable IANA `reportingTimeZone`. Null means uninitialized, while
effective reporting uses UTC. An authenticated device initializes it through the normal preference
write. Backup and migration preserve null instead of guessing a device zone. Date-only source
evidence stays on its recorded date and must not be converted into hourly activity.
