use indoc::indoc;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum MonitoredEntity {
    Table,
    UserId,
    EntityId,
    EntityLot,
    OriginCollectionId,
}

pub static MONITORED_ENTITY_VIEW_CREATION_SQL: &str = indoc! { r#"
    CREATE VIEW monitored_entity AS
    SELECT
        ute."user_id",
        cte."entity_id",
        cte."entity_lot",
        cte."id" as "collection_to_entity_id",
        cte."collection_id" AS "origin_collection_id"
    FROM
        "collection_to_entity" cte
    JOIN
        "collection" c ON cte."collection_id" = c."id"
    JOIN
        "user_to_entity" ute ON cte."collection_id" = ute."collection_id"
    WHERE
        c."name" = 'Monitoring'
"# };

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(MONITORED_ENTITY_VIEW_CREATION_SQL)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
