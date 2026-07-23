use anyhow::Result;
use common_utils::{get_base_http_client, ryot_log};
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};

use crate::models::{Editions, Response, URL, get_isbn_body};

pub struct HardcoverService {
    pub client: Client,
}

impl HardcoverService {
    pub async fn new(config: &config_definition::HardcoverConfig) -> Result<Self> {
        let client = get_base_http_client(Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&config.api_key)?,
        )]));
        Ok(Self { client })
    }

    pub async fn id_from_isbn(&self, isbn: &str) -> Option<String> {
        for isbn_type in ["10", "13"] {
            let body = get_isbn_body(isbn_type, isbn);
            let rsp = match self
                .client
                .post(URL)
                .json(&serde_json::json!({ "query": body }))
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    ryot_log!(warn, error = %e, "Hardcover ISBN request failed");
                    return None;
                }
            };
            let rsp: Response<Editions> = match rsp.json().await {
                Ok(r) => r,
                Err(e) => {
                    ryot_log!(warn, error = %e, "Hardcover ISBN response parse failed");
                    return None;
                }
            };
            if let Some(edition) = rsp.data.editions.first() {
                return Some(edition.book_id.to_string());
            }
        }
        None
    }
}
