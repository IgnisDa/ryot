use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // Update rows where stats is an object, transforming it into an array
        // of {name, value} pairs, flattening the 'custom' object if present.
        db.execute_unprepared(r#"
            UPDATE user_measurement
            SET stats = aggregated_stats.new_stats_array
            FROM (
                SELECT
                    user_id,
                    timestamp,
                    jsonb_agg(stat_object ORDER BY stat_object ->> 'name') AS new_stats_array -- Order array elements alphabetically by name
                FROM (
                    -- Process non-custom top-level keys
                    SELECT
                        t.user_id,
                        t.timestamp,
                        jsonb_build_object('name', kv.key, 'value', kv.value #>> '{}') AS stat_object -- Convert value to text
                    FROM user_measurement t, jsonb_each(t.stats) AS kv
                    WHERE jsonb_typeof(t.stats) = 'object' AND kv.key <> 'custom'

                    UNION ALL

                    -- Process keys within the 'custom' object, if it's an object
                    SELECT
                        t.user_id,
                        t.timestamp,
                        jsonb_build_object('name', custom_kv.key, 'value', custom_kv.value #>> '{}') AS stat_object -- Convert value to text
                    FROM user_measurement t, jsonb_each(t.stats -> 'custom') AS custom_kv
                    WHERE jsonb_typeof(t.stats) = 'object' AND jsonb_typeof(t.stats -> 'custom') = 'object'
                ) AS combined_stats
                GROUP BY user_id, timestamp
            ) AS aggregated_stats
            WHERE
                user_measurement.user_id = aggregated_stats.user_id
                AND user_measurement.timestamp = aggregated_stats.timestamp
                AND jsonb_typeof(user_measurement.stats) = 'object'; -- Ensure we only update rows that were originally objects
        "#).await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
