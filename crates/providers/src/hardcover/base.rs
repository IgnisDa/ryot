use anyhow::Result;
use application_utils::get_base_http_client;
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};

use crate::hardcover::models::{Editions, Response, URL, get_isbn_body};

pub struct HardcoverService {
    pub client: Client,
}

impl HardcoverService {
    pub async fn new(config: &config::HardcoverConfig) -> Result<Self> {
        let client = get_base_http_client(Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&config.api_key)?,
        )]));
        Ok(Self { client })
    }

    pub async fn id_from_isbn(&self, isbn: &str) -> Option<String> {
        for isbn_type in ["10", "13"] {
            let body = get_isbn_body(isbn_type, isbn);
            let rsp = self
                .client
                .post(URL)
                .json(&serde_json::json!({ "query": body }))
                .send()
                .await
                .ok()?
                .json::<Response<Editions>>()
                .await
                .ok()?;
            if let Some(edition) = rsp.data.editions.first() {
                return Some(edition.book_id.to_string());
            }
        }
        None
    }
}
