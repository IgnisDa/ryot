use std::{env, sync::Arc};

use anyhow::{anyhow, Result};
use askama::Template;
use common_utils::{APPLICATION_JSON_HEADER, AVATAR_URL, PROJECT_NAME};
use config::AppConfig;
use convert_case::{Case, Casing};
use lettre::{
    message::{header, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};
use reqwest::{
    header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    Client,
};
use serde::{Deserialize, Serialize};
use user_models::NotificationPlatformSpecifics;

// TODO: Allow formatting messages
pub async fn send_notification(
    specifics: NotificationPlatformSpecifics,
    config: &Arc<AppConfig>,
    msg: &str,
) -> Result<()> {
    let project_name = PROJECT_NAME.to_case(Case::Title);
    let client = Client::new();
    if env::var("DISABLE_NOTIFICATIONS").is_ok() {
        tracing::warn!("Notification not sent. Body was: {:#?}", msg);
        return Ok(());
    }
    match specifics {
        NotificationPlatformSpecifics::Apprise { url, key } => {
            client
                .post(format!("{}/notify/{}", url, key))
                .header(CONTENT_TYPE, APPLICATION_JSON_HEADER.clone())
                .json(&serde_json::json!({
                    "body": msg,
                    "title": project_name,
                }))
                .send()
                .await
                .map_err(|e| anyhow!(e))?;
        }
        NotificationPlatformSpecifics::Discord { url } => {
            client
                .post(url)
                .json(&serde_json::json!({
                    "content": msg,
                    "username": project_name,
                    "avatar_url": AVATAR_URL
                }))
                .send()
                .await
                .map_err(|e| anyhow!(e))?;
        }
        NotificationPlatformSpecifics::Gotify {
            url,
            token,
            priority,
        } => {
            client
                .post(format!("{}/message", url))
                .header("X-Gotify-Key", HeaderValue::from_str(&token).unwrap())
                .json(&serde_json::json!({
                    "message": msg,
                    "title": project_name,
                    "priority": priority.unwrap_or(5),
                    "extras": {
                        "client::notification": {
                          "bigImageUrl": AVATAR_URL
                        }
                     }
                }))
                .send()
                .await
                .map_err(|e| anyhow!(e))?;
        }
        NotificationPlatformSpecifics::Ntfy {
            url,
            priority,
            topic,
            auth_header,
        } => {
            let mut request = client
                .post(format!(
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
                );
            if let Some(token) = auth_header {
                request = request.header(
                    AUTHORIZATION,
                    HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
                );
            }
            request
                .body(msg.to_owned())
                .send()
                .await
                .map_err(|e| anyhow!(e))?;
        }
        NotificationPlatformSpecifics::PushBullet { api_token } => {
            client
                .post("https://api.pushbullet.com/v2/pushes")
                .header("Access-Token", api_token)
                .json(&serde_json::json!({
                    "body": msg,
                    "title": project_name,
                    "type": "note"
                }))
                .send()
                .await
                .map_err(|e| anyhow!(e))?;
        }
        NotificationPlatformSpecifics::PushOver { key, app_key } => {
            client.post("https://api.pushover.net/1/messages.json")
                    .query(&serde_json::json!({
                        "token":  app_key.clone().unwrap_or_else(|| "abd1semr21hv1i5j5kfkm23wf1kd4u".to_owned()),
                        "user": key,
                        "message": msg,
                        "title": project_name
                    }))
                    .send()
                    .await
                    .map_err(|e| anyhow!(e))?;
        }
        NotificationPlatformSpecifics::PushSafer { key } => {
            client
                .post("https://www.pushsafer.com/api")
                .query(&serde_json::json!({
                    "k": key,
                    "m": msg,
                    "t": project_name
                }))
                .send()
                .await
                .map_err(|e| anyhow!(e))?;
        }
        NotificationPlatformSpecifics::Email { email } => {
            #[derive(Template, Serialize, Deserialize, Debug, Clone)]
            #[template(path = "Generic.html")]
            pub struct GenericHtml {
                pub generic_message: String,
            }

            let body = GenericHtml {
                generic_message: msg.to_owned(),
            }
            .render()?;

            let credentials = Credentials::new(
                config.server.smtp.user.to_owned(),
                config.server.smtp.password.to_owned(),
            );

            let mailer = SmtpTransport::relay(&config.server.smtp.server)
                .unwrap()
                .credentials(credentials)
                .build();

            let mailbox = config.server.smtp.mailbox.parse().unwrap();
            let email = Message::builder()
                .from(mailbox)
                .to(email.parse().unwrap())
                .subject(format!("{} notification", project_name))
                .multipart(
                    MultiPart::mixed().singlepart(
                        SinglePart::builder()
                            .header(header::ContentType::TEXT_HTML)
                            .body(body),
                    ),
                )
                .unwrap();
            mailer.send(&email).map_err(|e| anyhow!(e))?;
        }
        NotificationPlatformSpecifics::Telegram { bot_token, chat_id } => {
            client
                .post(format!(
                    "https://api.telegram.org/bot{}/sendMessage",
                    bot_token
                ))
                .json(&serde_json::json!({
                    "chat_id": chat_id,
                    "text": msg,
                    "parse_mode": "Markdown"
                }))
                .send()
                .await
                .map_err(|e| anyhow!(e))?;
        }
    }
    Ok(())
}
