use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait};
use sea_orm_migration::prelude::*;

use crate::{
    entities::{import_report, prelude::ImportReport},
    importer::ImportResultResponse,
};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230726_000020_rename_table"
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
        let reports = ImportReport::find().all(db).await?;
        for report in reports {
            if let Some(details) = report.clone().details {
                let data = serde_json::to_string(&details).unwrap();
                let data = data.replace("ReviewTransformation", "ReviewConversion");
                let data: ImportResultResponse = serde_json::from_str(&data).unwrap();
                let mut rp: import_report::ActiveModel = report.into();
                rp.details = ActiveValue::Set(Some(data));
                rp.save(db).await?;
            }
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
