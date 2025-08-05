use anyhow::Result;
use common_utils::ryot_log;
use enum_models::MediaLot;
use external_utils::jellyfin::{ItemsResponse, get_authenticated_client};
use media_models::SeenShowExtraInformation;
use serde_json::json;
use traits::TraceOk;

pub async fn push_progress(
    base_url: String,
    username: String,
    password: Option<String>,
    metadata_lot: &MediaLot,
    metadata_title: &String,
    show_extra_information: &Option<SeenShowExtraInformation>,
) -> Result<()> {
    match *metadata_lot {
        MediaLot::Movie | MediaLot::Show => {}
        _ => {
            ryot_log!(
                debug,
                "Not pushing {:#?} progress for jellyfin push integration",
                metadata_lot
            );
            return Ok(());
        }
    }
    let (client, user_id) = get_authenticated_client(&base_url, &username, &password).await?;
    let json = json!({ "Recursive": true, "SearchTerm": metadata_title, "HasTmdbId": true });
    let items = client
        .get(format!("{base_url}/Users/{user_id}/Items"))
        .query(&json)
        .send()
        .await?
        .json::<ItemsResponse>()
        .await?;
    if let Some(selected_item) = items.items.first() {
        let id = match show_extra_information {
            Some(extra_information) => {
                let mut return_id = None;
                let id = selected_item.id.clone();
                let season = client
                    .get(format!("{base_url}/Shows/{id}/Seasons"))
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
                        .get(format!("{base_url}/Shows/{id}/Episodes"))
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
                .post(format!("{base_url}/Users/{user_id}/PlayedItems/{id}"))
                .send()
                .await?
                .json::<serde_json::Value>()
                .await
                .trace_ok();
        }
    }
    Ok(())
}
