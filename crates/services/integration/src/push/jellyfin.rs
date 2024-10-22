use external_utils::jellyfin::{get_authenticated_client, ItemsResponse};
use media_models::SeenShowExtraInformation;
use serde_json::json;
use traits::TraceOk;

pub(crate) struct JellyfinPushIntegration<'a> {
    base_url: String,
    username: String,
    password: String,
    metadata_title: &'a String,
    show_extra_information: &'a Option<SeenShowExtraInformation>,
}

impl<'a> JellyfinPushIntegration<'a> {
    pub const fn new(
        base_url: String,
        username: String,
        password: String,
        metadata_title: &'a String,
        show_extra_information: &'a Option<SeenShowExtraInformation>,
    ) -> Self {
        Self {
            base_url,
            username,
            password,
            metadata_title,
            show_extra_information,
        }
    }

    pub async fn push_progress(&self) -> anyhow::Result<()> {
        let (client, user_id) =
            get_authenticated_client(&self.base_url, &self.username, &self.password).await?;
        let json =
            json!({ "Recursive": true, "SearchTerm": self.metadata_title, "HasTmdbId": true });
        let items = client
            .get(format!("{}/Users/{}/Items", &self.base_url, user_id))
            .query(&json)
            .send()
            .await?
            .json::<ItemsResponse>()
            .await?;
        if let Some(selected_item) = items.items.first() {
            let id = match self.show_extra_information {
                Some(extra_information) => {
                    let mut return_id = None;
                    let id = selected_item.id.clone();
                    let season = client
                        .get(format!("{}/Shows/{}/Seasons", self.base_url, id))
                        .query(&json!({ "UserId": user_id }))
                        .send()
                        .await?
                        .json::<ItemsResponse>()
                        .await?
                        .items
                        .into_iter()
                        .find(|s| s.index_number == Some(extra_information.season));
                    if let Some(season) = season {
                        let episode = client
                            .get(format!("{}/Shows/{}/Episodes", self.base_url, id))
                            .query(&json!({ "UserId": user_id, "SeasonId": season.id }))
                            .send()
                            .await?
                            .json::<ItemsResponse>()
                            .await?
                            .items
                            .into_iter()
                            .find(|e| e.index_number == Some(extra_information.episode));
                        return_id = episode.map(|e| e.id);
                    }
                    return_id
                }
                None => Some(selected_item.id.clone()),
            };
            if let Some(id) = id {
                client
                    .post(format!(
                        "{}/Users/{}/PlayedItems/{}",
                        self.base_url, user_id, id
                    ))
                    .send()
                    .await?
                    .json::<serde_json::Value>()
                    .await
                    .trace_ok();
            }
        }
        Ok(())
    }
}
