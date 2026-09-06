use indoc::indoc;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static COLLECTION_ENTITY_MEMBERSHIP_VIEW_CREATION_SQL: &str = indoc! { r#"
    CREATE VIEW collection_entity_membership AS
    SELECT
        ute."user_id",
        cte."entity_id",
        cte."entity_lot",
        c."name" AS "collection_name",
        cte."id" AS "collection_to_entity_id",
        cte."rank" AS "collection_to_entity_rank",
        cte."collection_id" AS "origin_collection_id",
        cte."created_on" AS "collection_to_entity_created_on",
        cte."information" AS "collection_to_entity_information",
        cte."last_updated_on" AS "collection_to_entity_last_updated_on"
    FROM
        "collection_to_entity" cte
    JOIN
        "collection" c ON cte."collection_id" = c."id"
    JOIN
        "user_to_entity" ute ON cte."collection_id" = ute."collection_id"
    JOIN
        "user" u ON ute."user_id" = u."id"
    WHERE
        (u."is_disabled" IS NULL OR u."is_disabled" = false)
"# };

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(COLLECTION_ENTITY_MEMBERSHIP_VIEW_CREATION_SQL)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
