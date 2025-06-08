use std::sync::Arc;

use async_graphql::{Error, Result};
use database_models::{notification_platform, prelude::NotificationPlatform};
use media_models::UpdateUserNotificationPlatformInput;
use notification_service::send_notification;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, ModelTrait, QueryFilter};
use supporting_service::SupportingService;

pub async fn update_user_notification_platform(
    supporting_service: &Arc<SupportingService>,
    user_id: String,
    input: UpdateUserNotificationPlatformInput,
) -> Result<bool> {
    let db_notification = NotificationPlatform::find_by_id(input.notification_id)
        .one(&supporting_service.db)
        .await?
        .ok_or_else(|| Error::new("Notification platform with the given id does not exist"))?;
    if db_notification.user_id != user_id {
        return Err(Error::new(
            "Notification platform does not belong to the user",
        ));
    }
    let mut db_notification: notification_platform::ActiveModel = db_notification.into();
    if let Some(s) = input.is_disabled {
        db_notification.is_disabled = ActiveValue::Set(Some(s));
    }
    if let Some(e) = input.configured_events {
        db_notification.configured_events = ActiveValue::Set(e);
    }
    db_notification.update(&supporting_service.db).await?;
    Ok(true)
}

pub async fn delete_user_notification_platform(
    supporting_service: &Arc<SupportingService>,
    user_id: String,
    notification_id: String,
) -> Result<bool> {
    let notification = NotificationPlatform::find_by_id(notification_id)
        .one(&supporting_service.db)
        .await?
        .ok_or_else(|| Error::new("Notification platform with the given id does not exist"))?;
    if notification.user_id != user_id {
        return Err(Error::new(
            "Notification platform does not belong to the user",
        ));
    }
    notification.delete(&supporting_service.db).await?;
    Ok(true)
}

pub async fn test_user_notification_platforms(
    supporting_service: &Arc<SupportingService>,
    user_id: &String,
) -> Result<bool> {
    let notifications = NotificationPlatform::find()
        .filter(notification_platform::Column::UserId.eq(user_id))
        .all(&supporting_service.db)
        .await?;
    for platform in notifications {
        if platform.is_disabled.unwrap_or_default() {
            continue;
        }
        let msg = format!("This is a test notification for platform: {}", platform.lot);
        send_notification(platform.platform_specifics, &msg).await?;
    }
    Ok(true)
}
