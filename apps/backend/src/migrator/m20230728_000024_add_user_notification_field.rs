use sea_orm::{ActiveValue, EntityTrait};
use sea_orm_migration::prelude::*;

use crate::{
    entities::{prelude::User as UserModel, user},
    migrator::m20230417_000002_create_user::User,
    users::UserNotifications,
};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230728_000024_add_user_notification_field"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("user", "notifications").await? {
            let db = manager.get_connection();
            manager
                .alter_table(
                    Table::alter()
                        .table(User::Table)
                        .add_column_if_not_exists(ColumnDef::new(User::Notifications).json())
                        .to_owned(),
                )
                .await?;
            let mut user = user::ActiveModel {
                ..Default::default()
            };
            user.notifications = ActiveValue::Set(UserNotifications(vec![]));
            UserModel::update_many().set(user).exec(db).await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
