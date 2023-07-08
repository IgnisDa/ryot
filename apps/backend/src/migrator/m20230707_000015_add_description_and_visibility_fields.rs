use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter};
use sea_orm_migration::prelude::*;

use crate::{
    entities::{collection, prelude::Collection as CollectionModel},
    migrator::m20230507_000007_create_collection::Collection,
    miscellaneous::DEFAULT_COLLECTIONS,
    models::media::Visibility,
};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230707_000015_add_description_and_visibility_fields"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Collection::Table)
                    .add_column_if_not_exists(ColumnDef::new(Collection::Description).string())
                    .add_column_if_not_exists(
                        ColumnDef::new(Collection::Visibility)
                            .string_len(2)
                            .not_null()
                            .default(Visibility::Private),
                    )
                    .to_owned(),
            )
            .await
            .ok();
        let db = manager.get_connection();
        for (name, description) in DEFAULT_COLLECTIONS {
            let cols = CollectionModel::find()
                .filter(collection::Column::Name.eq(name))
                .all(db)
                .await?;
            for col in cols {
                let mut col: collection::ActiveModel = col.into();
                col.description = ActiveValue::Set(Some(description.to_owned()));
                col.update(db).await?;
            }
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
