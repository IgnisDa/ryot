use anyhow::{anyhow, Result};
use convert_case::{Case, Casing};

use crate::{
    users::UserNotificationSetting,
    utils::{AVATAR_URL, PROJECT_NAME},
};

impl UserNotificationSetting {
    // TODO: Allow formatting messages
    pub async fn send_message(&self, msg: String) -> Result<()> {
        match self {
            Self::Discord { url } => {
                surf::post(url)
                    .body_json(&serde_json::json!({
                        "content": msg,
                        "username": PROJECT_NAME.to_case(Case::Title),
                        "avatar_url": AVATAR_URL
                    }))
                    .unwrap()
                    .await
                    .map_err(|e| anyhow!(e))?;
            }
            _ => todo!(),
        }
        Ok(())
    }
}
