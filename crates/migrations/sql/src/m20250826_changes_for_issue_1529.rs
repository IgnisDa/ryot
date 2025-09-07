use migrations_utils::create_trigram_index_if_required;
use sea_orm_migration::prelude::*;

use super::{
    m20230404_create_user::USER_NAME_TRIGRAM_INDEX,
    m20230410_create_metadata::{METADATA_DESCRIPTION_TRIGRAM_INDEX, METADATA_TITLE_TRIGRAM_INDEX},
    m20230411_create_metadata_group::{
        METADATA_GROUP_DESCRIPTION_TRIGRAM_INDEX, METADATA_GROUP_TITLE_TRIGRAM_INDEX,
    },
    m20230413_create_person::{PERSON_DESCRIPTION_TRIGRAM_INDEX, PERSON_NAME_TRIGRAM_INDEX},
    m20230502_create_genre::GENRE_NAME_TRIGRAM_INDEX,
    m20230504_create_collection::COLLECTION_NAME_TRIGRAM_INDEX,
    m20230505_create_exercise::{
        EXERCISE_AGGREGATED_INSTRUCTIONS_TRIGRAM_INDEX, EXERCISE_NAME_TRIGRAM_INDEX, Exercise,
    },
    m20230508_create_review::REVIEW_USER_ENTITY_INDEX,
    m20230510_create_seen::SEEN_USER_METADATA_INDEX,
    m20231017_create_user_to_entity::{ENTITY_ID_SQL, ENTITY_LOT_SQL, UserToEntity},
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

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

        db.execute_unprepared(
            r#"
CREATE OR REPLACE FUNCTION array_to_string_immutable(text[], text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$ SELECT array_to_string($1, $2) $$;
        "#,
        )
        .await?;

        if !manager
            .has_column("exercise", "aggregated_instructions")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(Exercise::Table)
                        .add_column(
                            ColumnDef::new(Exercise::AggregatedInstructions)
                                .text()
                                .not_null()
                                .extra("GENERATED ALWAYS AS (array_to_string_immutable(instructions, E'\\n')) STORED")
                        )
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

        if manager
            .has_index("metadata", "metadata__title__index")
            .await?
        {
            db.execute_unprepared("DROP INDEX metadata__title__index")
                .await?;
        }

        if manager
            .has_index("exercise", "exercise__name__index")
            .await?
        {
            db.execute_unprepared("DROP INDEX exercise__name__index")
                .await?;
        }

        if manager.has_index("user", "user__name__index").await? {
            db.execute_unprepared("DROP INDEX user__name__index")
                .await?;
        }

        if manager.has_index("genre", "genre_name_index").await? {
            db.execute_unprepared("DROP INDEX genre_name_index").await?;
        }

        create_trigram_index_if_required(
            manager,
            "metadata",
            "title",
            METADATA_TITLE_TRIGRAM_INDEX,
        )
        .await?;

        create_trigram_index_if_required(
            manager,
            "metadata",
            "description",
            METADATA_DESCRIPTION_TRIGRAM_INDEX,
        )
        .await?;

        create_trigram_index_if_required(manager, "person", "name", PERSON_NAME_TRIGRAM_INDEX)
            .await?;

        create_trigram_index_if_required(
            manager,
            "person",
            "description",
            PERSON_DESCRIPTION_TRIGRAM_INDEX,
        )
        .await?;

        create_trigram_index_if_required(
            manager,
            "metadata_group",
            "title",
            METADATA_GROUP_TITLE_TRIGRAM_INDEX,
        )
        .await?;

        create_trigram_index_if_required(
            manager,
            "metadata_group",
            "description",
            METADATA_GROUP_DESCRIPTION_TRIGRAM_INDEX,
        )
        .await?;

        create_trigram_index_if_required(manager, "genre", "name", GENRE_NAME_TRIGRAM_INDEX)
            .await?;

        create_trigram_index_if_required(manager, "user", "name", USER_NAME_TRIGRAM_INDEX).await?;

        create_trigram_index_if_required(
            manager,
            "collection",
            "name",
            COLLECTION_NAME_TRIGRAM_INDEX,
        )
        .await?;

        create_trigram_index_if_required(manager, "exercise", "name", EXERCISE_NAME_TRIGRAM_INDEX)
            .await?;

        create_trigram_index_if_required(
            manager,
            "exercise",
            "aggregated_instructions",
            EXERCISE_AGGREGATED_INSTRUCTIONS_TRIGRAM_INDEX,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
