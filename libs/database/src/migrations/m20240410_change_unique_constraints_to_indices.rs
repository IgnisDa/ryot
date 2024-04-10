use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
alter table "user" drop constraint if exists "user_name_key";
create unique index if not exists "user__name__index" on "user" (name);

alter table "user" drop constraint if exists "user_oidc_issuer_id_key";
create unique index if not exists "user__oidc_issuer_id__index" on "user" (oidc_issuer_id);

alter table "genre" drop constraint if exists "genre_name_key";
drop index if exists "genre_name_index";
create unique index if not exists "genre_name_index" on "genre" (name);

alter table "exercise" drop constraint if exists "exercise_identifier_key";
create unique index if not exists "exercise__identifier__index" on "exercise" (identifier);
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
