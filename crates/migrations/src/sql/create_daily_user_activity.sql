CREATE OR REPLACE FUNCTION get_hour_of_day(time_input TIMESTAMPTZ)
RETURNS INT AS $$
BEGIN
    RETURN EXTRACT(HOUR FROM time_input AT TIME ZONE 'UTC');
END;
$$ LANGUAGE plpgsql;

DROP MATERIALIZED VIEW IF EXISTS "daily_user_activity";

CREATE MATERIALIZED VIEW "daily_user_activity" AS
WITH counted_lots AS (
    SELECT
        CAST(s."finished_on" AS DATE) AS "date",
        s."user_id",
        get_hour_of_day(s."last_updated_on") AS "hour_of_day",
        m."lot",
        CAST(COUNT(s."metadata_id") AS BIGINT) AS "lot_count"
    FROM
        public."seen" s
    JOIN
        public."metadata" m ON s."metadata_id" = m."id"
    WHERE
        s."finished_on" IS NOT NULL
    GROUP BY
        CAST(s."finished_on" AS DATE), s."user_id", m."lot", "hour_of_day"
),
summed_metadata AS (
    SELECT
        cl."date",
        cl."user_id",
        cl."lot",
        SUM(cl."lot_count") AS "total_lot_count"
    FROM
        counted_lots cl
    GROUP BY
        cl."date", cl."user_id", cl."lot"
),
reviews_count AS (
    SELECT
        CAST(r."posted_on" AS DATE) AS "review_day",
        r."user_id",
        get_hour_of_day(r."posted_on") AS "hour_of_day",
        CAST(COUNT(DISTINCT r."id") AS BIGINT) AS "review_counts"
    FROM
        public."review" r
    GROUP BY
        CAST(r."posted_on" AS DATE), r."user_id", "hour_of_day"
),
measurements_count AS (
    SELECT
        CAST(m."timestamp" AS DATE) AS "measurement_day",
        m."user_id",
        get_hour_of_day(m."timestamp") AS "hour_of_day",
        CAST(COUNT(DISTINCT m."timestamp") AS BIGINT) AS "measurement_counts"
    FROM
        public."user_measurement" m
    GROUP BY
        CAST(m."timestamp" AS DATE), m."user_id", "hour_of_day"
),
workouts_count AS (
    SELECT
        CAST(w."end_time" AS DATE) AS "workout_day",
        w."user_id",
        get_hour_of_day(w."end_time") AS "hour_of_day",
        CAST(COUNT(DISTINCT w."id") AS BIGINT) AS "workout_counts"
    FROM
        public."workout" w
    GROUP BY
        CAST(w."end_time" AS DATE), w."user_id", "hour_of_day"
),
aggregated_times AS (
    SELECT
        COALESCE(cl."date", rc."review_day", mc."measurement_day", wc."workout_day") AS "date",
        COALESCE(cl."user_id", rc."user_id", mc."user_id", wc."user_id") AS "user_id",
        COALESCE(cl."hour_of_day", rc."hour_of_day", mc."hour_of_day", wc."hour_of_day") AS "hour_of_day",
        CAST(
            SUM(
                COALESCE(cl."lot_count", 0) +
                COALESCE(rc."review_counts", 0) +
                COALESCE(mc."measurement_counts", 0) +
                COALESCE(wc."workout_counts", 0)
            ) AS BIGINT
        ) AS "hour_of_day_count"
    FROM
        counted_lots cl
    FULL JOIN
        reviews_count rc ON cl."date" = rc."review_day" AND cl."user_id" = rc."user_id" AND cl."hour_of_day" = rc."hour_of_day"
    FULL JOIN
        measurements_count mc ON cl."date" = mc."measurement_day" AND cl."user_id" = mc."user_id" AND cl."hour_of_day" = mc."hour_of_day"
    FULL JOIN
        workouts_count wc ON cl."date" = wc."workout_day" AND cl."user_id" = wc."user_id" AND cl."hour_of_day" = wc."hour_of_day"
    GROUP BY
        COALESCE(cl."date", rc."review_day", mc."measurement_day", wc."workout_day"),
        COALESCE(cl."user_id", rc."user_id", mc."user_id", wc."user_id"),
        COALESCE(cl."hour_of_day", rc."hour_of_day", mc."hour_of_day", wc."hour_of_day")
),
distinct_hour_counts AS (
    SELECT
        at."date",
        at."user_id",
        at."hour_of_day",
        SUM(at."hour_of_day_count") AS "total_hour_count"
    FROM
        aggregated_times at
    GROUP BY
        at."date", at."user_id", at."hour_of_day"
)
SELECT
    at."date",
    at."user_id",
    COALESCE(
        (SELECT
            jsonb_agg(
                jsonb_build_object(
                    'lot', sm."lot",
                    'count', sm."total_lot_count"
                )
            )
        FROM
            summed_metadata sm
        WHERE
            sm."date" = at."date" AND sm."user_id" = at."user_id"
        ), '[]'::jsonb
    ) AS "metadata_counts",
    -- Use the distinct_hour_counts to avoid duplicate hour entries
    (SELECT
        jsonb_agg(
            jsonb_build_object(
                'hour', dhc."hour_of_day",
                'count', dhc."total_hour_count"
            )
        )
    FROM
        distinct_hour_counts dhc
    WHERE
        dhc."date" = at."date" AND dhc."user_id" = at."user_id"
    ) AS "hour_counts",
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
