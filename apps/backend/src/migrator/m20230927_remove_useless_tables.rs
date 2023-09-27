use std::env;

use sea_orm::{DatabaseBackend, Statement};
use sea_orm_migration::prelude::*;

use super::m20230412_create_creator::{Creator, MetadataToCreator};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum Review {
    Table,
    CreatorId,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("review", "creator_id").await? {
            let db = manager.get_connection();
            let stmt = Query::select()
                .expr(Func::count(Expr::col(Asterisk)))
                .from(Review::Table)
                .cond_where(Expr::col(Review::CreatorId).is_not_null())
                .to_owned();
            let (sql, values) = match manager.get_database_backend() {
                DatabaseBackend::MySql => stmt.build(MySqlQueryBuilder {}),
                DatabaseBackend::Postgres => stmt.build(PostgresQueryBuilder {}),
                DatabaseBackend::Sqlite => stmt.build(SqliteQueryBuilder {}),
            };
            let stmt = Statement::from_sql_and_values(manager.get_database_backend(), sql, values);
            let resp = db.query_one(stmt).await?.unwrap();
            let count = resp.try_get_by_index::<i64>(0)?;
            if count > 0 {
                let var_name = "MIGRATIONS_NO_CREATOR_CHECK";
                let message = format!("
This migration will delete all old creators (changes introduced in `v2.19.0`) and associated reviews.
You have reviews for {count} creator(s).
Please downgrade to the `v2.19.0`, follow instructions at https://github.com/IgnisDa/ryot/releases/tag/v2.19.0 to migrate this data, and then upgrade again.

If you want to skip this check, please set the environment variable `{var_name}=1`.");
                tracing::info!(message);
                if env::var(var_name).is_err() {
                    return Err(DbErr::Custom("Unable to continue".to_owned()));
                } else {
                    tracing::warn!("Deleting {} review(s) in 10 seconds.", count);
                    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                    let stmt = Query::delete()
                        .from_table(Review::Table)
                        .cond_where(Expr::col(Review::CreatorId).is_not_null())
                        .to_owned();
                    let (sql, values) = match manager.get_database_backend() {
                        DatabaseBackend::MySql => stmt.build(MySqlQueryBuilder {}),
                        DatabaseBackend::Postgres => stmt.build(PostgresQueryBuilder {}),
                        DatabaseBackend::Sqlite => stmt.build(SqliteQueryBuilder {}),
                    };
                    let stmt =
                        Statement::from_sql_and_values(manager.get_database_backend(), sql, values);
                    db.execute(stmt).await?;
                }
            }
            manager
                .alter_table(
                    Table::alter()
                        .table(Review::Table)
                        .drop_column(Review::CreatorId)
                        .to_owned(),
                )
                .await?;
        }
        if manager.has_table("metadata_to_creator").await? {
            manager
                .drop_table(Table::drop().table(MetadataToCreator::Table).to_owned())
                .await?;
        }
        if manager.has_table("creator").await? {
            manager
                .drop_table(Table::drop().table(Creator::Table).to_owned())
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
