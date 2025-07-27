use std::{fs::File as StdFile, sync::Arc};

use anyhow::Result;
use common_utils::ryot_log;
use dependent_utils::user_collections_list;
use struson::writer::{JsonStreamWriter, JsonWriter};
use supporting_service::SupportingService;

pub async fn export_collections(
    ss: &Arc<SupportingService>,
    user_id: &String,
    writer: &mut JsonStreamWriter<StdFile>,
) -> Result<()> {
    ryot_log!(debug, "Getting collections list for user_id = {}", user_id);
    let collections_resp = user_collections_list(user_id, ss).await?;
    let collections = collections_resp.response;

    ryot_log!(debug, "Exporting {} collections", collections.len());
    for collection in collections {
        writer.serialize_value(&collection)?;
    }
    Ok(())
}
