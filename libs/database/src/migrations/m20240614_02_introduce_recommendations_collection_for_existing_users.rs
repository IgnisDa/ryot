use nanoid::nanoid;
use sea_orm::entity::prelude::*;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

mod user {
    use super::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "user")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let users = user::Entity::find().all(db).await?;
        for user in users {
            let collection_id = format!("col_{}", nanoid!(12));
            db.execute_unprepared(&format!(
                r#"
    INSERT INTO collection (name, description, user_id, created_on, last_updated_on, id)
    VALUES (
            'Recommendations', 'Items that are recommended to me based on my consumption.',
            '{user_id}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{collection_id}'
        )
    ON CONFLICT DO NOTHING;

    INSERT INTO user_to_collection (user_id, collection_id)
    VALUES ('{user_id}', '{collection_id}');
            "#,
                user_id = user.id,
                collection_id = collection_id,
            ))
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
