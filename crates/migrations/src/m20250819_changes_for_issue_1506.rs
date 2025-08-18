use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        if manager.has_table("metadata_to_person").await? {
            db.execute_unprepared("INSERT INTO entity_to_entity (from_metadata_id, to_person_id, relation, role, character_name, index_position) SELECT metadata_id, person_id, role, role, character, index FROM metadata_to_person;").await?;
            db.execute_unprepared("DROP TABLE metadata_to_person;")
                .await?;
        }

        if manager.has_table("metadata_to_genre").await? {
            db.execute_unprepared("INSERT INTO entity_to_entity (from_metadata_id, to_genre_id, relation) SELECT metadata_id, genre_id, 'genre' FROM metadata_to_genre;").await?;
            db.execute_unprepared("DROP TABLE metadata_to_genre;")
                .await?;
        }

        if manager.has_table("metadata_to_metadata").await? {
            db.execute_unprepared("INSERT INTO entity_to_entity (from_metadata_id, to_metadata_id, relation) SELECT from_metadata_id, to_metadata_id, relation FROM metadata_to_metadata;").await?;
            db.execute_unprepared("DROP TABLE metadata_to_metadata;")
                .await?;
        }

        if manager.has_table("metadata_to_metadata_group").await? {
            db.execute_unprepared("INSERT INTO entity_to_entity (from_metadata_id, to_metadata_group_id, relation, part) SELECT metadata_id, metadata_group_id, 'member', part FROM metadata_to_metadata_group;").await?;
            db.execute_unprepared("DROP TABLE metadata_to_metadata_group;")
                .await?;
        }

        if manager.has_table("metadata_group_to_person").await? {
            db.execute_unprepared("INSERT INTO entity_to_entity (from_metadata_group_id, to_person_id, relation, role, index_position) SELECT metadata_group_id, person_id, role, role, index FROM metadata_group_to_person;").await?;
            db.execute_unprepared("DROP TABLE metadata_group_to_person;")
                .await?;
        }

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
