CREATE OR REPLACE FUNCTION get_time_of_day(time_input TIMESTAMPTZ)
RETURNS TEXT AS $$
BEGIN
    RETURN CASE
        WHEN EXTRACT(HOUR FROM time_input) BETWEEN 5 AND 11 THEN 'Morning'
        WHEN EXTRACT(HOUR FROM time_input) BETWEEN 12 AND 16 THEN 'Afternoon'
        WHEN EXTRACT(HOUR FROM time_input) BETWEEN 17 AND 20 THEN 'Evening'
        ELSE 'Night'
    END;
END;
$$ LANGUAGE plpgsql;

DROP MATERIALIZED VIEW IF EXISTS "daily_user_activity";

CREATE MATERIALIZED VIEW "daily_user_activity" AS
WITH counted_lots AS (
    SELECT
        CAST(s."finished_on" AS DATE) AS "date",
        s."user_id",
        get_time_of_day(s."last_updated_on") AS "time_of_day",
        m."lot",
        CAST(COUNT(DISTINCT s."metadata_id") AS BIGINT) AS "lot_count"
    FROM
        public."seen" s
    JOIN
        public."metadata" m ON s."metadata_id" = m."id"
    WHERE
        s."finished_on" IS NOT NULL
    GROUP BY
        CAST(s."finished_on" AS DATE), s."user_id", m."lot", "time_of_day"
),
reviews_count AS (
    SELECT
        CAST(r."posted_on" AS DATE) AS "review_day",
        r."user_id",
        get_time_of_day(r."posted_on") AS "time_of_day",
        CAST(COUNT(DISTINCT r."id") AS BIGINT) AS "review_counts"
    FROM
        public."review" r
    GROUP BY
        CAST(r."posted_on" AS DATE), r."user_id", "time_of_day"
),
measurements_count AS (
    SELECT
        CAST(m."timestamp" AS DATE) AS "measurement_day",
        m."user_id",
        get_time_of_day(m."timestamp") AS "time_of_day",
        CAST(COUNT(DISTINCT m."timestamp") AS BIGINT) AS "measurement_counts"
    FROM
        public."user_measurement" m
    GROUP BY
        CAST(m."timestamp" AS DATE), m."user_id", "time_of_day"
),
workouts_count AS (
    SELECT
        CAST(w."end_time" AS DATE) AS "workout_day",
        w."user_id",
        get_time_of_day(w."end_time") AS "time_of_day",
        CAST(COUNT(DISTINCT w."id") AS BIGINT) AS "workout_counts"
    FROM
        public."workout" w
    GROUP BY
        CAST(w."end_time" AS DATE), w."user_id", "time_of_day"
),
aggregated_times AS (
    SELECT
        COALESCE(cl."date", rc."review_day", mc."measurement_day", wc."workout_day") AS "date",
        COALESCE(cl."user_id", rc."user_id", mc."user_id", wc."user_id") AS "user_id",
        COALESCE(cl."time_of_day", rc."time_of_day", mc."time_of_day", wc."time_of_day") AS "time_of_day",
        CAST(
            SUM(
                COALESCE(cl."lot_count", 0) +
                COALESCE(rc."review_counts", 0) +
                COALESCE(mc."measurement_counts", 0) +
                COALESCE(wc."workout_counts", 0)
            ) AS BIGINT
        ) AS "time_of_day_count"
    FROM
        counted_lots cl
    FULL JOIN
        reviews_count rc ON cl."date" = rc."review_day" AND cl."user_id" = rc."user_id" AND cl."time_of_day" = rc."time_of_day"
    FULL JOIN
        measurements_count mc ON cl."date" = mc."measurement_day" AND cl."user_id" = mc."user_id" AND cl."time_of_day" = mc."time_of_day"
    FULL JOIN
        workouts_count wc ON cl."date" = wc."workout_day" AND cl."user_id" = wc."user_id" AND cl."time_of_day" = wc."time_of_day"
    GROUP BY
        COALESCE(cl."date", rc."review_day", mc."measurement_day", wc."workout_day"),
        COALESCE(cl."user_id", rc."user_id", mc."user_id", wc."user_id"),
        COALESCE(cl."time_of_day", rc."time_of_day", mc."time_of_day", wc."time_of_day")
)
SELECT
    at."date",
    at."user_id",
    COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'lot', cl."lot",
                'count', CAST(cl."lot_count" AS BIGINT)
            )
        ) FILTER (WHERE cl."lot" IS NOT NULL), '[]'::jsonb
    ) AS "metadata_counts",
    jsonb_agg(
        jsonb_build_object(
            'time', at."time_of_day",
            'count', at."time_of_day_count"
        )
    ) AS "time_of_day_counts",
    CAST(SUM(COALESCE(rc."review_counts", 0)) AS BIGINT) AS "review_counts",
    CAST(SUM(COALESCE(mc."measurement_counts", 0)) AS BIGINT) AS "measurement_counts",
    CAST(SUM(COALESCE(wc."workout_counts", 0)) AS BIGINT) AS "workout_counts",
    CAST(
        (
            COALESCE(SUM(cl."lot_count"), 0) +
            COALESCE(SUM(rc."review_counts"), 0) +
            COALESCE(SUM(mc."measurement_counts"), 0) +
            COALESCE(SUM(wc."workout_counts"), 0)
        ) AS BIGINT
    ) AS "total_counts"
FROM
    aggregated_times at
LEFT JOIN
    counted_lots cl ON at."date" = cl."date" AND at."user_id" = cl."user_id"
LEFT JOIN
    reviews_count rc ON at."date" = rc."review_day" AND at."user_id" = rc."user_id"
LEFT JOIN
    measurements_count mc ON at."date" = mc."measurement_day" AND at."user_id" = mc."user_id"
LEFT JOIN
    workouts_count wc ON at."date" = wc."workout_day" AND at."user_id" = wc."user_id"
GROUP BY
    at."date", at."user_id"
ORDER BY
    at."date", at."user_id";

DROP INDEX IF EXISTS "daily_user_activity_unique";
CREATE UNIQUE INDEX "daily_user_activity_unique" ON "daily_user_activity" ("date", "user_id");

DROP INDEX IF EXISTS "daily_user_activity_user_id";
CREATE INDEX "daily_user_activity_user_id" ON "daily_user_activity" ("user_id");
