use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // 1. Update rows where stats is an object, transforming it into an array
        //    of {name, value} pairs, flattening the 'custom' object if present.
        db.execute_unprepared(r#"
            UPDATE user_measurement
            SET stats = aggregated_stats.new_stats_array
            FROM (
                SELECT
                    user_id,
                    timestamp,
                    jsonb_agg(stat_object ORDER BY stat_object ->> 'name') AS new_stats_array
                FROM (
                    -- Process non-custom top-level keys
                    SELECT
                        t.user_id,
                        t.timestamp,
                        jsonb_build_object('name', kv.key, 'value', kv.value #>> '{}') AS stat_object
                    FROM user_measurement t, jsonb_each(t.stats) AS kv
                    WHERE jsonb_typeof(t.stats) = 'object' AND kv.key <> 'custom'

                    UNION ALL

                    -- Process keys within the 'custom' object, if it's an object
                    SELECT
                        t.user_id,
                        t.timestamp,
                        jsonb_build_object('name', custom_kv.key, 'value', custom_kv.value #>> '{}') AS stat_object
                    FROM user_measurement t, jsonb_each(t.stats -> 'custom') AS custom_kv
                    WHERE jsonb_typeof(t.stats) = 'object' AND jsonb_typeof(t.stats -> 'custom') = 'object'
                ) AS combined_stats
                GROUP BY user_id, timestamp
            ) AS aggregated_stats
            WHERE
                user_measurement.user_id = aggregated_stats.user_id
                AND user_measurement.timestamp = aggregated_stats.timestamp
                AND jsonb_typeof(user_measurement.stats) = 'object';
        "#).await?;

        // 2a. Dynamically build the statistics array in preferences for users WITH measurements.
        db.execute_unprepared(
            r#"
            WITH UserMeasurementNames AS (
                -- Extract all unique measurement names for each user from the updated stats arrays
                SELECT DISTINCT
                    um.user_id,
                    stat_element ->> 'name' AS measurement_name
                FROM
                    user_measurement um,
                    jsonb_array_elements(um.stats) AS stat_element
                WHERE
                    jsonb_typeof(um.stats) = 'array' -- Process only rows that now have arrays
            ),
            UserStatisticsArray AS (
                -- Aggregate names into the desired JSON array format for each user
                SELECT
                    user_id,
                    jsonb_agg(
                        jsonb_build_object('name', measurement_name, 'dataType', 'DECIMAL')
                        ORDER BY measurement_name -- Order alphabetically for consistency
                    ) AS statistics_array
                FROM
                    UserMeasurementNames
                GROUP BY
                    user_id
            )
            -- Update the user preferences table for users found in UserStatisticsArray
            UPDATE public.user u
            SET preferences = jsonb_set(
                u.preferences,
                '{fitness,measurements,statistics}', -- Path to update/create
                usa.statistics_array,
                true -- Create the path if it doesn't exist
            )
            FROM UserStatisticsArray usa
            WHERE u.id = usa.user_id;
        "#,
        )
        .await?;

        // 2b. Set default statistics array in preferences for users WITHOUT any measurements.
        db.execute_unprepared(r#"
            UPDATE public.user u
            SET preferences = jsonb_set(
                u.preferences,
                '{fitness,measurements,statistics}',
                '[{"name": "weight", "dataType": "DECIMAL"}, {"name": "sugar_level", "dataType": "DECIMAL"}]'::jsonb, -- Default array
                true -- Create the path if it doesn't exist
            )
            WHERE NOT EXISTS ( -- Only update users who DON'T have measurement entries processed in step 1/2a
                SELECT 1
                FROM user_measurement um
                WHERE um.user_id = u.id AND jsonb_typeof(um.stats) = 'array'
            );
        "#).await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
