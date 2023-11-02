use sea_orm::{
    ActiveModelBehavior, ActiveValue, ColumnTrait, DeriveEntityModel, DerivePrimaryKey,
    DeriveRelation, EntityTrait, EnumIter, PrimaryKeyTrait, QueryFilter,
};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use crate::migrations::m20230410_create_metadata::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

mod me {
    use super::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
    #[sea_orm(table_name = "metadata")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i32,
        pub production_status: Option<String>,
    }
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}
    impl ActiveModelBehavior for ActiveModel {}
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        manager
            .alter_table(
                Table::alter()
                    .table(Metadata::Table)
                    .modify_column(ColumnDef::new(Metadata::ProductionStatus).null())
                    .to_owned(),
            )
            .await?;
        me::Entity::update_many()
            .filter(me::Column::ProductionStatus.eq("Released"))
            .set(me::ActiveModel {
                production_status: ActiveValue::Set(None),
                ..Default::default()
            })
            .exec(db)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
