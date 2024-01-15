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
        if !persons_to_not_delete.is_empty() {
            return Err(DbErr::Custom(format!(
                "
Due to a major bug in the previous versions, all the persons in this database need to be
deleted. However, there are still persons that have been reviewed or are in a collection.
Please revert to an older version, and delete the reviews/disassociate collections for
persons with these IDs: {:?}. Then upgrade to this version again.
",
                persons_to_not_delete
            )));
        }
        let all_persons = pe::Entity::find()
            .select_only()
            .column(pe::Column::Id)
            .into_tuple::<i32>()
            .all(db)
            .await?;
        tracing::warn!("Total people to delete: {}", all_persons.len());
        db.execute_unprepared(
            r#"
alter table metadata_to_person drop constraint "fk-person-item_media-person_id";
alter table collection_to_entity drop constraint "collection_to_entity-fk3";
alter table review drop constraint "review_to_person_foreign_key";

delete from metadata_to_person;
truncate table person restart identity;

alter table metadata_to_person add constraint "fk-person-item_media-person_id" foreign key ("person_id") references "person" ("id") on update cascade on delete cascade;
alter table collection_to_entity add constraint "collection_to_entity-fk3" foreign key ("person_id") references "person" ("id") on update cascade on delete cascade;
alter table review add constraint "review_to_person_foreign_key" foreign key ("person_id") references "person" ("id") on update cascade on delete cascade;
        "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
