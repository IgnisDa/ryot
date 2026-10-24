# Analytics

Open **Analytics** from **Saved Views** or the **Analytics** link on **Home**. Use the global
controls to choose a date range, grouping, and comparison period. The reporting time zone comes from
account preferences. It starts with your device time zone and stays fixed when you travel.

Choose **Collection reviews**, **Media**, or a Fitness section. The date range, grouping, comparison,
and reporting time zone apply across sections. Report choices stay in the URL; use browser Back to
return to an earlier selection.

## Collection reviews

**Collection reviews** and **Reviews** in Media include rating-only entries. A rating of `0` is valid
and counts as rated. These are separate reports.

## Media

The summary separates **Title completion occurrences**, **Episode / item completion occurrences**,
and **Distinct completed titles**. Quantity totals keep pages, episodes, chapters, volumes, and
minutes separate. Each quantity shows known coverage plus recorded, estimated, and missing amounts;
**Unknown** is not zero. A `≥` amount is a lower bound, not a complete total.

A numbered anime or manga item counts as one item occurrence. Its episode, chapter, or volume
position is not the amount consumed. A partial source marker is evidence about source progress, not
the total amount consumed.

Progress and time entries are cumulative within a consumption run. For example, readings of 40, 70,
then 100 count as 100 total, not 210. A lower new reading adds nothing. Use **Edit** to correct
history.

Title completions and episode occurrences are counted separately. Analytics distinguishes recorded
amounts from estimates; estimates keep the metadata used when they were recorded. Synced list state
does not count as consumption, but actual history records do.

Records without a date count in all-time totals, not dated charts or comparisons. Date-only records
stay on their recorded day; they do not create hourly activity.

Use **Charts** to compare values by date and unit. Chart labels and tooltips show exact values and
dates. For long ranges, use the bounded, labelled window and **Older periods** / **Newer periods** or
**Older days** / **Newer days** to move through it. In **Rankings** or Charts, use **View contributing
records** or **View records** to inspect source facts and recorded or estimated quantities.

Ranking previews show loaded rows only. **Show more rankings**, **Show more records**, and similar
load-more buttons fetch another page; a preview is not a report total.

If media history repair is pending or failed, affected consumption figures can be Unknown or partial.
Do not read them as empty or zero. **Retry report** or **Retry breakdowns** reloads report data; it
does not manually repair history.

## Fitness

Use the **Workouts**, **Rankings**, and **Measurements** tabs. Target rankings use **Weighted sets**,
not raw recorded sets: primary or untyped target sets count as 1, secondary as 0.5, and stabilizer
as 0. In **Rankings**, **View workouts** lists contributing workouts; select a workout name to open it.

Workout duration uses recorded active time. Set duration and **Planned rest** are separate and are not
added to workout duration. Missing active time stays unknown.

Fitness stores canonical values such as kg, km, seconds, and kcal, then converts them for display using
your unit preferences. Missing measurement readings appear as gaps, not zeroes. A measurement chart
uses one unit; if a metric has mixed units, the chart is hidden and exact readings remain available.
Choose a metric in **Measurements** to see its bucket-average trend, not individual readings.
Smoothing is optional and off by default; it does not fill missing buckets. The exact-readings table
keeps each raw value, date, and unit, including custom units; `0` is a reading, not a gap. **Load more
readings** fetches another page.
