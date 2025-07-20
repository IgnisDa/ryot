use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use database_models::{notification_platform, prelude::NotificationPlatform};
use enum_models::{NotificationPlatformLot, UserNotificationContent};
use media_models::{CreateUserNotificationPlatformInput, UpdateUserNotificationPlatformInput};
use notification_service::send_notification;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, Iterable, ModelTrait, QueryFilter,
};
use supporting_service::SupportingService;
use user_models::NotificationPlatformSpecifics;

pub async fn update_user_notification_platform(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UpdateUserNotificationPlatformInput,
) -> Result<bool> {
    let db_notification = NotificationPlatform::find_by_id(input.notification_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("Notification platform with the given id does not exist"))?;
    if db_notification.user_id != user_id {
        bail!("Notification platform does not belong to the user",);
    }
    let mut db_notification: notification_platform::ActiveModel = db_notification.into();
    if let Some(s) = input.is_disabled {
        db_notification.is_disabled = ActiveValue::Set(Some(s));
    }
    if let Some(e) = input.configured_events {
        db_notification.configured_events = ActiveValue::Set(e);
    }
    db_notification.update(&ss.db).await?;
    Ok(true)
}

pub async fn delete_user_notification_platform(
    ss: &Arc<SupportingService>,
    user_id: String,
    notification_id: String,
) -> Result<bool> {
    let notification = NotificationPlatform::find_by_id(notification_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("Notification platform with the given id does not exist"))?;
    if notification.user_id != user_id {
        bail!("Notification platform does not belong to the user",);
    }
    notification.delete(&ss.db).await?;
    Ok(true)
}

pub async fn test_user_notification_platforms(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<bool> {
    let notifications = NotificationPlatform::find()
        .filter(notification_platform::Column::UserId.eq(user_id))
        .filter(
            notification_platform::Column::IsDisabled
                .is_null()
                .or(notification_platform::Column::IsDisabled.eq(false)),
        )
        .all(&ss.db)
        .await?;
    for platform in notifications {
        let msg = format!("This is a test notification for platform: {}", platform.lot);
        send_notification(platform.platform_specifics, &msg).await?;
    }
    Ok(true)
}

pub async fn create_user_notification_platform(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: CreateUserNotificationPlatformInput,
) -> Result<String> {
    let specifics = match input.lot {
        NotificationPlatformLot::Apprise => NotificationPlatformSpecifics::Apprise {
            url: input.base_url.unwrap(),
            key: input.api_token.unwrap(),
        },
        NotificationPlatformLot::Discord => NotificationPlatformSpecifics::Discord {
            url: input.base_url.unwrap(),
        },
        NotificationPlatformLot::Gotify => NotificationPlatformSpecifics::Gotify {
            url: input.base_url.unwrap(),
            token: input.api_token.unwrap(),
            priority: input.priority,
        },
        NotificationPlatformLot::Ntfy => NotificationPlatformSpecifics::Ntfy {
            url: input.base_url,
            topic: input.api_token.unwrap(),
            priority: input.priority,
            auth_header: input.auth_header,
        },
        NotificationPlatformLot::PushBullet => NotificationPlatformSpecifics::PushBullet {
            api_token: input.api_token.unwrap(),
        },
        NotificationPlatformLot::PushOver => NotificationPlatformSpecifics::PushOver {
            key: input.api_token.unwrap(),
            app_key: input.auth_header,
        },
        NotificationPlatformLot::PushSafer => NotificationPlatformSpecifics::PushSafer {
            key: input.api_token.unwrap(),
        },
        NotificationPlatformLot::Telegram => NotificationPlatformSpecifics::Telegram {
            bot_token: input.api_token.unwrap(),
            chat_id: input.chat_id.unwrap(),
        },
    };
    let description = match &specifics {
        NotificationPlatformSpecifics::Apprise { url, key } => {
            format!("URL: {}, Key: {}", url, key)
        }
        NotificationPlatformSpecifics::Discord { url } => {
            format!("Webhook: {}", url)
        }
        NotificationPlatformSpecifics::Gotify { url, token, .. } => {
            format!("URL: {}, Token: {}", url, token)
        }
        NotificationPlatformSpecifics::Ntfy { url, topic, .. } => {
            format!("URL: {:?}, Topic: {}", url, topic)
        }
        NotificationPlatformSpecifics::PushBullet { api_token } => {
            format!("API Token: {}", api_token)
        }
        NotificationPlatformSpecifics::PushOver { key, app_key } => {
            format!("Key: {}, App Key: {:?}", key, app_key)
        }
        NotificationPlatformSpecifics::PushSafer { key } => {
            format!("Key: {}", key)
        }
        NotificationPlatformSpecifics::Telegram { chat_id, .. } => {
            format!("Chat ID: {}", chat_id)
        }
    };
    let notification = notification_platform::ActiveModel {
        lot: ActiveValue::Set(input.lot),
        user_id: ActiveValue::Set(user_id),
        description: ActiveValue::Set(description),
        platform_specifics: ActiveValue::Set(specifics),
        configured_events: ActiveValue::Set(UserNotificationContent::iter().collect()),
        ..Default::default()
    };
    let new_notification_id = notification.insert(&ss.db).await?.id;
    Ok(new_notification_id)
}
