use sea_orm::EntityTrait;
use sea_orm_migration::prelude::*;

use crate::entities::{import_report, prelude::ImportReport};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230726_000020_rename_table"
    }
}

struct ReplaceFunction;

impl Iden for ReplaceFunction {
    fn unquoted(&self, s: &mut dyn Write) {
        write!(s, "REPLACE").unwrap();
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_table("media_import_report").await? {
            manager
                .rename_table(
                    Table::rename()
                        .table(
                            Alias::new("media_import_report"),
                            Alias::new("import_report"),
                        )
                        .to_owned(),
                )
                .await?;
        }
        let db = manager.get_connection();
        ImportReport::update_many()
            .col_expr(
                import_report::Column::Details,
                Func::cast_as(
                    Func::cust(ReplaceFunction).args([
                        Func::cast_as(Expr::col(Alias::new("details")), Alias::new("text")).into(),
                        Expr::val("ReviewTransformation").into(),
                        Expr::val("ReviewConversion").into(),
                    ]),
                    Alias::new("json"),
                )
                .into(),
            )
            .exec(db)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
