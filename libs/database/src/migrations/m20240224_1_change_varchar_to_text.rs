use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
alter table metadata
    alter column lot type text,
    alter column source type text,
    alter column title type text,
    alter column production_status type text,
    alter column original_language type text,
    alter column identifier type text
;

alter table person
    alter column source type text,
    alter column identifier type text,
    alter column name type text,
    alter column gender type text,
    alter column place type text,
    alter column website type text
;
alter table metadata_to_person
    alter column role type text,
    alter column character type text
;

alter table "user"
    alter column lot type text,
    alter column name type text,
    alter column email type text,
    alter column password type text
;

alter table seen alter column state type text;

alter table metadata_group
    alter column lot type text,
    alter column source type text,
    alter column identifier type text,
    alter column title type text,
    alter column description type text
;

alter table genre alter column name type text;

alter table collection
    alter column visibility type text,
    alter column name type text,
    alter column description type text
;

alter table review
    alter column visibility type text,
    alter column text type text
;

alter table import_report alter column source type text;

alter table exercise
    alter column lot type text,
    alter column level type text,
    alter column force type text,
    alter column mechanic type text,
    alter column equipment type text,
    alter column source type text,
    alter column id type text,
    alter column identifier type text
;

alter table user_measurement alter column name type text;

alter table workout
    alter column id type text,
    alter column name type text,
    alter column comment type text,
    alter column repeated_from type text
;

alter table collection_to_entity alter column exercise_id type text;

alter table user_to_entity alter column exercise_id type text;

alter table metadata_to_metadata alter column relation type text;
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
