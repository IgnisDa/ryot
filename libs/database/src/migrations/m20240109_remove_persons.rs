use sea_orm::{
    ActiveModelBehavior, ColumnTrait, DeriveEntityModel, DerivePrimaryKey, DeriveRelation,
    EntityTrait, EnumIter, PrimaryKeyTrait, QueryFilter, QuerySelect,
};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(DeriveMigrationName)]
pub struct Migration;

mod re {
    use super::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
    #[sea_orm(table_name = "review")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i32,
        pub person_id: Option<i32>,
    }
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}
    impl ActiveModelBehavior for ActiveModel {}
}

mod ce {
    use super::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
    #[sea_orm(table_name = "collection_to_entity")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i32,
        pub person_id: Option<i32>,
    }
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}
    impl ActiveModelBehavior for ActiveModel {}
}

mod pe {
    use super::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
    #[sea_orm(table_name = "person")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i32,
    }
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}
    impl ActiveModelBehavior for ActiveModel {}
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let reviewed_persons = re::Entity::find()
            .select_only()
            .column(re::Column::PersonId)
            .filter(re::Column::PersonId.is_not_null())
            .into_tuple::<i32>()
            .all(db)
            .await?;
        let collections_persons = ce::Entity::find()
            .select_only()
            .column(ce::Column::PersonId)
            .filter(ce::Column::PersonId.is_not_null())
            .into_tuple::<i32>()
            .all(db)
            .await?;
        let persons_to_not_delete = reviewed_persons
            .into_iter()
            .chain(collections_persons)
            .collect::<Vec<_>>();
        pe::Entity::delete_many()
            .filter(pe::Column::Id.is_not_in(persons_to_not_delete))
            .exec(db)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
