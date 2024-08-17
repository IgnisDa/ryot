DROP MATERIALIZED VIEW IF EXISTS "daily_user_activity";
CREATE MATERIALIZED VIEW "daily_user_activity" AS
WITH counted_lots AS (
    SELECT
        CAST(s."finished_on" AS DATE) AS "date",
        s."user_id",
        m."lot",
        COUNT(DISTINCT s."metadata_id") AS "lot_count"
    FROM
        public."seen" s
    JOIN
        public."metadata" m ON s."metadata_id" = m."id"
    WHERE
        s."finished_on" IS NOT NULL
    GROUP BY
        CAST(s."finished_on" AS DATE), s."user_id", m."lot"
),
reviews_count AS (
    SELECT
        CAST(r."posted_on" AS DATE) AS "review_day",
        r."user_id",
        COUNT(DISTINCT r."id") AS "review_counts"
    FROM
        public."review" r
    GROUP BY
        CAST(r."posted_on" AS DATE), r."user_id"
),
measurements_count AS (
    SELECT
        CAST(m."timestamp" AS DATE) AS "measurement_day",
        m."user_id",
        COUNT(DISTINCT m."timestamp") AS "measurement_counts"
    FROM
        public."user_measurement" m
    GROUP BY
        CAST(m."timestamp" AS DATE), m."user_id"
),
workouts_count AS (
    SELECT
        CAST(w."end_time" AS DATE) AS "workout_day",
        w."user_id",
        COUNT(DISTINCT w."id") AS "workout_counts"
    FROM
        public."workout" w
    GROUP BY
        CAST(w."end_time" AS DATE), w."user_id"
)
SELECT
    cl."date",
    cl."user_id",
    jsonb_agg(
        jsonb_build_object(
            'lot', cl."lot",
            'count', cl."lot_count"
        )
    ) AS "metadata_counts",
    COALESCE(rc."review_counts", 0) AS "review_counts",
    COALESCE(mc."measurement_counts", 0) AS "measurement_counts",
    COALESCE(wc."workout_counts", 0) AS "workout_counts",
    CAST((COALESCE(SUM(cl."lot_count"), 0) +
     COALESCE(rc."review_counts", 0) +
     COALESCE(mc."measurement_counts", 0) +
     COALESCE(wc."workout_counts", 0)) AS BIGINT) AS "total_counts"
FROM
    counted_lots cl
LEFT JOIN
    reviews_count rc ON cl."date" = rc."review_day" AND cl."user_id" = rc."user_id"
LEFT JOIN
    measurements_count mc ON cl."date" = mc."measurement_day" AND cl."user_id" = mc."user_id"
LEFT JOIN
    workouts_count wc ON cl."date" = wc."workout_day" AND cl."user_id" = wc."user_id"
GROUP BY
    cl."date", cl."user_id", rc."review_counts", mc."measurement_counts", wc."workout_counts"
ORDER BY
    cl."date", cl."user_id";

DROP INDEX IF EXISTS "daily_user_activity_unique";
CREATE UNIQUE INDEX "daily_user_activity_unique" ON "daily_user_activity" ("date", "user_id");

DROP INDEX IF EXISTS "daily_user_activity_user_id";
CREATE INDEX "daily_user_activity_user_id" ON "daily_user_activity" ("user_id");
