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
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
