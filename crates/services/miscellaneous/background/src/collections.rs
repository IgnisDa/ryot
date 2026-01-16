use std::sync::Arc;

use anyhow::Result;
use sea_orm::{ConnectionTrait, Statement};
use supporting_service::SupportingService;

pub async fn rebalance_collection_ranks(ss: &Arc<SupportingService>) -> Result<()> {
    let detect_fragmented_collections_query = r#"
        SELECT DISTINCT collection_id, COUNT(*) as item_count
        FROM collection_to_entity
        WHERE collection_id IN (
            SELECT collection_id
            FROM collection_to_entity
            WHERE (
                -- Ranks with more than 3 decimal places (fragmented)
                SCALE(rank) > 3
                OR
                -- Collections with negative ranks
                rank <= 0
                OR
                -- Collections with many fractional ranks (> 10% of items)
                collection_id IN (
                    SELECT collection_id
                    FROM collection_to_entity
                    WHERE rank != TRUNC(rank)
                    GROUP BY collection_id
                    HAVING COUNT(*) * 10 > (
                        SELECT COUNT(*)
                        FROM collection_to_entity cte2
                        WHERE cte2.collection_id = collection_to_entity.collection_id
                    )
                )
            )
        )
        GROUP BY collection_id
        HAVING COUNT(*) > 1
    "#;

    let fragmented_collections: Vec<(String, i64)> = ss
        .db
        .query_all(Statement::from_string(
            ss.db.get_database_backend(),
            detect_fragmented_collections_query,
        ))
        .await?
        .into_iter()
        .map(|row| {
            let collection_id: String = row.try_get("", "collection_id").unwrap_or_default();
            let item_count: i64 = row.try_get("", "item_count").unwrap_or_default();
            (collection_id, item_count)
        })
        .collect();

    if fragmented_collections.is_empty() {
        tracing::debug!("No fragmented collection ranks found to rebalance");
        return Ok(());
    }

    let collections_count = fragmented_collections.len();
    tracing::debug!(
        "Found {} collections with fragmented ranks to rebalance",
        collections_count
    );

    for (collection_id, item_count) in fragmented_collections {
        let rebalance_query = r#"
            UPDATE collection_to_entity
            SET rank = ranked_data.new_rank
            FROM (
                SELECT id,
                       ROW_NUMBER() OVER (ORDER BY rank ASC) as new_rank
                FROM collection_to_entity
                WHERE collection_id = $1
            ) ranked_data
            WHERE collection_to_entity.id = ranked_data.id
        "#;

        let result = ss
            .db
            .execute(Statement::from_sql_and_values(
                ss.db.get_database_backend(),
                rebalance_query,
                [collection_id.clone().into()],
            ))
            .await?;

        tracing::debug!(
            "Rebalanced {} items in collection {} (affected: {})",
            item_count,
            collection_id,
            result.rows_affected()
        );
    }

    tracing::debug!(
        "Completed rebalancing ranks for {} collections",
        collections_count
    );
    Ok(())
}
