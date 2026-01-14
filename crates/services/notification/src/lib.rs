use std::{env, time::Duration};

use anyhow::Result;
use askama::Template;
use common_utils::{APPLICATION_JSON_HEADER, AVATAR_URL, PROJECT_NAME, ryot_log};
use config_definition::AppConfig;
use convert_case::{Case, Casing};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{MultiPart, SinglePart, header},
    transport::smtp::authentication::Credentials,
};
use reqwest::{
    Client,
    header::{AUTHORIZATION, CONTENT_TYPE, HeaderValue},
};
use serde::{Deserialize, Serialize};
use user_models::NotificationPlatformSpecifics;

pub async fn send_notification(
    msg: &str,
    config: &AppConfig,
    specifics: NotificationPlatformSpecifics,
) -> Result<()> {
    let project_name = PROJECT_NAME.to_case(Case::Title);
    let client = Client::new();
    if env::var("DISABLE_NOTIFICATIONS").is_ok() {
        ryot_log!(warn, "Notification not sent. Body was: {:#?}", msg);
        return Ok(());
    }
    match specifics {
        NotificationPlatformSpecifics::Apprise { url, key } => {
            client
                .post(format!("{url}/notify/{key}"))
                .header(CONTENT_TYPE, APPLICATION_JSON_HEADER.clone())
                .json(&serde_json::json!({
                    "body": msg,
                    "title": project_name,
                }))
                .send()
                .await?;
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
                .await?;
        }
        NotificationPlatformSpecifics::Gotify {
            url,
            token,
            priority,
        } => {
            client
                .post(format!("{url}/message"))
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
                .await?;
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
                    HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
                );
            }
            request.body(msg.to_owned()).send().await?;
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
                .await?;
        }
        NotificationPlatformSpecifics::PushOver { key, app_key } => {
            client
                .post("https://api.pushover.net/1/messages.json")
                .query(&[
                    ("user", &key),
                    ("title", &project_name),
                    ("message", &msg.to_string()),
                    (
                        "token",
                        &app_key.unwrap_or_else(|| "abd1semr21hv1i5j5kfkm23wf1kd4u".to_string()),
                    ),
                ])
                .send()
                .await?;
        }
        NotificationPlatformSpecifics::PushSafer { key } => {
            client
                .post("https://www.pushsafer.com/api")
                .query(&[("k", &key), ("m", &msg.to_string()), ("t", &project_name)])
                .send()
                .await?;
        }
        NotificationPlatformSpecifics::Telegram { bot_token, chat_id } => {
            client
                .post(format!(
                    "https://api.telegram.org/bot{bot_token}/sendMessage"
                ))
                .json(&serde_json::json!({
                    "chat_id": chat_id,
                    "text": msg,
                    "parse_mode": "Markdown"
                }))
                .send()
                .await?;
        }
        NotificationPlatformSpecifics::Email { email } => {
            #[derive(Template, Serialize, Deserialize, Debug, Clone)]
            #[template(path = "generic.html")]
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

            let mailer_builder = match config.server.smtp.tls_mode.to_lowercase().as_str() {
                "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(&config.server.smtp.server)?
                    .port(config.server.smtp.port),
                "none" => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(
                    &config.server.smtp.server,
                )
                .port(config.server.smtp.port),
                _ => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(
                    &config.server.smtp.server,
                )?
                .port(config.server.smtp.port),
            };

            let mailer = mailer_builder
                .timeout(Some(Duration::from_secs(30)))
                .credentials(credentials)
                .build();

            let mailbox = config.server.smtp.mailbox.parse()?;
            let email_msg = Message::builder()
                .from(mailbox)
                .to(email.parse()?)
                .subject(format!("{} notification", project_name))
                .multipart(
                    MultiPart::mixed().singlepart(
                        SinglePart::builder()
                            .header(header::ContentType::TEXT_HTML)
                            .body(body),
                    ),
                )?;
            mailer.send(email_msg).await?;
        }
    }
    Ok(())
}
