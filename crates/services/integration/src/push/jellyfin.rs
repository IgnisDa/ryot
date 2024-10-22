use enums::MediaLot;
use external_utils::jellyfin::{get_authenticated_client, ItemsResponse};

pub(crate) struct JellyfinPushIntegration {
    base_url: String,
    username: String,
    password: String,
    metadata_lot: MediaLot,
    metadata_title: String,
}

impl JellyfinPushIntegration {
    pub const fn new(
        base_url: String,
        username: String,
        password: String,
        metadata_lot: MediaLot,
        metadata_title: String,
    ) -> Self {
        Self {
            base_url,
            username,
            password,
            metadata_lot,
            metadata_title,
        }
    }

    pub async fn push_progress(&self) -> anyhow::Result<()> {
        let (client, user_id) =
            get_authenticated_client(&self.base_url, &self.username, &self.password).await?;
        let items = client
            .get(format!("{}/Items", &self.base_url))
            .query(&serde_json::json!({
               "NameStartsWith": self.metadata_title, "HasTmdbId": true,
               "IsMovie": self.metadata_lot == MediaLot::Movie,
               "IsSeries": self.metadata_lot == MediaLot::Show,
            }))
            .send()
            .await?
            .json::<ItemsResponse>()
            .await?;
        dbg!(&items);
        Ok(())
    }
}
