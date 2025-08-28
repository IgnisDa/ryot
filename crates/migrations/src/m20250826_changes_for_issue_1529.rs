use sea_orm_migration::prelude::*;

use super::{
    m20230505_create_exercise::Exercise,
    m20230508_create_review::REVIEW_USER_ENTITY_INDEX,
    m20230510_create_seen::SEEN_USER_METADATA_INDEX,
    m20231017_create_user_to_entity::{ENTITY_ID_SQL, ENTITY_LOT_SQL, UserToEntity},
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("user_to_entity", "entity_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(UserToEntity::Table)
                        .add_column(
                            ColumnDef::new(UserToEntity::EntityId)
                                .text()
                                .not_null()
                                .extra(ENTITY_ID_SQL),
                        )
                        .to_owned(),
                )
                .await?;
        }
        if !manager.has_column("user_to_entity", "entity_lot").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(UserToEntity::Table)
                        .add_column(
                            ColumnDef::new(UserToEntity::EntityLot)
                                .text()
                                .not_null()
                                .extra(ENTITY_LOT_SQL),
                        )
                        .to_owned(),
                )
                .await?;
        }
        if !manager.has_column("exercise", "assets").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Exercise::Table)
                        .add_column(ColumnDef::new(Exercise::Assets).json_binary())
                        .to_owned(),
                )
                .await?;
        }
        if !manager.has_column("exercise", "instructions").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Exercise::Table)
                        .add_column(
                            ColumnDef::new(Exercise::Instructions)
                                .array(ColumnType::Text)
                                .not_null()
                                .default("{}"),
                        )
                        .to_owned(),
                )
                .await?;
        }

        if manager.has_column("exercise", "attributes").await? {
            let db = manager.get_connection();
            db.execute_unprepared(
                r#"
UPDATE exercise SET assets = attributes->'assets' WHERE attributes IS NOT NULL;
UPDATE exercise SET assets = '{"s3_images":[],"s3_videos":[],"remote_images":[],"remote_videos":[]}'::jsonb WHERE assets IS NULL;

ALTER TABLE exercise ALTER COLUMN assets SET NOT NULL;
"#,
            )
            .await?;

            db.execute_unprepared(
                "UPDATE exercise SET instructions = CASE
                        WHEN jsonb_typeof(attributes->'instructions') = 'array'
                        THEN ARRAY(SELECT jsonb_array_elements_text(attributes->'instructions'))
                        ELSE '{}'
                     END
                     WHERE attributes IS NOT NULL",
            )
            .await?;

            manager
                .alter_table(
                    Table::alter()
                        .table(Exercise::Table)
                        .drop_column(Alias::new("attributes"))
                        .to_owned(),
                )
                .await?;
        }

        if !manager.has_index("seen", SEEN_USER_METADATA_INDEX).await? {
            manager
                .create_index(
                    Index::create()
                        .name(SEEN_USER_METADATA_INDEX)
                        .table(Alias::new("seen"))
                        .col(Alias::new("user_id"))
                        .col(Alias::new("metadata_id"))
                        .to_owned(),
                )
                .await?;
        }

        if !manager
            .has_index("review", REVIEW_USER_ENTITY_INDEX)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .name(REVIEW_USER_ENTITY_INDEX)
                        .table(Alias::new("review"))
                        .col(Alias::new("user_id"))
                        .col(Alias::new("entity_id"))
                        .col(Alias::new("entity_lot"))
                        .to_owned(),
                )
                .await?;
        }

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
