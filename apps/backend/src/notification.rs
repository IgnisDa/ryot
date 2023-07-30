use anyhow::{anyhow, Result};
use convert_case::{Case, Casing};

use crate::{
    users::UserNotificationSetting,
    utils::{AVATAR_URL, PROJECT_NAME},
};

impl UserNotificationSetting {
    // TODO: Allow formatting messages
    pub async fn send_message(&self, msg: &str) -> Result<()> {
        let project_name = PROJECT_NAME.to_case(Case::Title);
        match self {
            Self::Discord { url } => {
                surf::post(url)
                    .body_json(&serde_json::json!({
                        "content": msg,
                        "username": project_name,
                        "avatar_url": AVATAR_URL
                    }))
                    .unwrap()
                    .await
                    .map_err(|e| anyhow!(e))?;
            }
            Self::Gotify {
                url,
                token,
                priority,
            } => {
                surf::post(format!("{}/message", url))
                    .header("X-Gotify-Key", token)
                    .body_json(&serde_json::json!({
                        "message": msg,
                        "title": project_name,
                        "priority": priority.unwrap_or(5),
                        "extras": {
                            "client::notification": {
                              "bigImageUrl": AVATAR_URL
                            }
                         }
                    }))
                    .unwrap()
                    .await
                    .map_err(|e| anyhow!(e))?;
            }
            Self::Ntfy {
                url,
                priority,
                topic,
            } => {
                surf::post(format!(
                    "{}/{}",
                    url.clone().unwrap_or_else(|| "https://ntfy.sh".to_owned()),
                    topic
                ))
                .header("Title", project_name)
                .header("Attach", AVATAR_URL)
                .header(
                    "Priority",
                    priority
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| "3".to_owned()),
                )
                .body_string(msg.to_owned())
                .await
                .map_err(|e| anyhow!(e))?;
            }
            Self::PushBullet { api_token } => {
                surf::post("https://api.pushbullet.com/v2/pushes")
                    .header("Access-Token", api_token)
                    .body_json(&serde_json::json!({
                        "body": msg,
                        "title": project_name,
                        "type": "note"
                    }))
                    .unwrap()
                    .await
                    .map_err(|e| anyhow!(e))?;
            }
            Self::PushOver { key } => {
                surf::post("https://api.pushover.net/1/messages.json")
                    .query(&serde_json::json!({
                        "token": "abd1semr21hv1i5j5kfkm23wf1kd4u",
                        "user": key,
                        "message": msg,
                        "title": project_name
                    }))
                    .unwrap()
                    .await
                    .map_err(|e| anyhow!(e))?;
            }
            Self::PushSafer { key } => {
                surf::post("https://www.pushsafer.com/api")
                    .query(&serde_json::json!({
                        "k": key,
                        "m": msg,
                        "t": project_name
                    }))
                    .unwrap()
                    .await
                    .map_err(|e| anyhow!(e))?;
            }
        }
        Ok(())
    }
}
