DROP MATERIALIZED VIEW IF EXISTS "weekly_user_activity";
CREATE MATERIALIZED VIEW "weekly_user_activity" AS
WITH counted_lots AS (
    SELECT
        CAST(DATE_TRUNC('week', COALESCE(s."finished_on", s."last_updated_on")) AS DATE) AS "finished_week",
        s."user_id",
        m."lot",
        COUNT(DISTINCT s."metadata_id") AS "lot_count"
    FROM
        public."seen" s
    JOIN
        public."metadata" m ON s."metadata_id" = m."id"
    GROUP BY
        CAST(DATE_TRUNC('week', COALESCE(s."finished_on", s."last_updated_on")) AS DATE), s."user_id", m."lot"
),
reviews_count AS (
    SELECT
        CAST(DATE_TRUNC('week', r."posted_on") AS DATE) AS "review_week",
        r."user_id",
        COUNT(DISTINCT r."id") AS "review_count"
    FROM
        public."review" r
    GROUP BY
        CAST(DATE_TRUNC('week', r."posted_on") AS DATE), r."user_id"
),
measurements_count AS (
    SELECT
        CAST(DATE_TRUNC('week', m."timestamp") AS DATE) AS "measurement_week",
        m."user_id",
        COUNT(DISTINCT m."timestamp") AS "measurement_count"
    FROM
        public."user_measurement" m
    GROUP BY
        CAST(DATE_TRUNC('week', m."timestamp") AS DATE), m."user_id"
),
workouts_count AS (
    SELECT
        CAST(DATE_TRUNC('week', w."end_time") AS DATE) AS "workout_week",
        w."user_id",
        COUNT(DISTINCT w."id") AS "workout_count"
    FROM
        public."workout" w
    GROUP BY
        CAST(DATE_TRUNC('week', w."end_time") AS DATE), w."user_id"
)
SELECT
    cl."finished_week",
    cl."user_id",
    jsonb_object_agg(cl."lot", cl."lot_count") AS "metadata_counts",
    COALESCE(rc."review_count", 0) AS "review_count",
    COALESCE(mc."measurement_count", 0) AS "measurement_count",
    COALESCE(wc."workout_count", 0) AS "workout_count",
    (COALESCE(SUM(cl."lot_count"), 0) +
     COALESCE(rc."review_count", 0) +
     COALESCE(mc."measurement_count", 0) +
     COALESCE(wc."workout_count", 0)) AS "total_count"
FROM
    counted_lots cl
LEFT JOIN
    reviews_count rc ON cl."finished_week" = rc."review_week" AND cl."user_id" = rc."user_id"
LEFT JOIN
    measurements_count mc ON cl."finished_week" = mc."measurement_week" AND cl."user_id" = mc."user_id"
LEFT JOIN
    workouts_count wc ON cl."finished_week" = wc."workout_week" AND cl."user_id" = wc."user_id"
GROUP BY
    cl."finished_week", cl."user_id", rc."review_count", mc."measurement_count", wc."workout_count"
ORDER BY
    cl."finished_week", cl."user_id";

DROP INDEX IF EXISTS "weekly_user_activity_unique";
CREATE UNIQUE INDEX "weekly_user_activity_unique" ON "weekly_user_activity" ("finished_week", "user_id");

DROP INDEX IF EXISTS "weekly_user_activity_user_id";
CREATE INDEX "weekly_user_activity_user_id" ON "weekly_user_activity" ("user_id");
