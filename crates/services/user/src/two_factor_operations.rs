use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Result, bail};
use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use chrono::Utc;
use common_models::UserLevelCacheKey;
use data_encoding::BASE64;
use database_utils::user_by_id;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, ExpireCacheKeyInput, UserTwoFactorSetupCacheValue,
};
use media_models::{
    LoginError, LoginErrorVariant, LoginResponse, LoginResult, UserTwoFactorBackupCodesResponse,
    UserTwoFactorInitiateResponse, UserTwoFactorSetupInput, UserTwoFactorSetupResponse,
    UserTwoFactorVerifyInput,
};
use rand::Rng;
use sea_orm::{ActiveModelTrait, ActiveValue, IntoActiveModel};
use supporting_service::SupportingService;
use totp_lite::{Sha1, totp};
use user_models::{UserTwoFactorInformation, UserTwoFactorInformationBackupCode};

use crate::authentication_operations::generate_auth_token;

pub async fn verify_two_factor(
    ss: &Arc<SupportingService>,
    input: UserTwoFactorVerifyInput,
) -> Result<LoginResult> {
    let (user_id, code, is_backup_code) = match input {
        UserTwoFactorVerifyInput::Totp(totp_input) => (totp_input.user_id, totp_input.code, false),
        UserTwoFactorVerifyInput::BackupCode(backup_input) => {
            (backup_input.user_id, backup_input.code, true)
        }
    };

    let user = user_by_id(&user_id, ss).await?;
    let Some(two_factor_info) = &user.two_factor_information else {
        return Ok(LoginResult::Error(LoginError {
            error: LoginErrorVariant::TwoFactorInvalid,
        }));
    };

    let verification_result = if is_backup_code {
        verify_backup_code_against_user(two_factor_info, &code)
    } else {
        let decrypted_secret =
            decrypt_totp_secret(&two_factor_info.secret, &ss.config.users.jwt_secret)?;
        verify_totp_code(&code, &decrypted_secret)
    };

    if !verification_result {
        return Ok(LoginResult::Error(LoginError {
            error: LoginErrorVariant::TwoFactorInvalid,
        }));
    }

    if is_backup_code {
        mark_backup_code_as_used(&user_id, &code, ss).await?;
    }

    let jwt_key = generate_auth_token(ss, user_id.clone()).await?;
    let mut user = user.into_active_model();
    user.last_login_on = ActiveValue::Set(Some(Utc::now()));
    user.update(&ss.db).await?;

    Ok(LoginResult::Ok(LoginResponse { api_key: jwt_key }))
}

pub async fn initiate_two_factor_setup(
    ss: &Arc<SupportingService>,
    user_id: String,
) -> Result<UserTwoFactorInitiateResponse> {
    let user = user_by_id(&user_id, ss).await?;

    if user.two_factor_information.is_some() {
        bail!("Two-factor authentication is already enabled");
    }

    let secret = generate_totp_secret();
    let qr_code_url = format!(
        "otpauth://totp/Ryot:{}?secret={}&issuer=Ryot",
        user.name, secret
    );

    let cache_key = ApplicationCacheKey::UserTwoFactorSetup(UserLevelCacheKey {
        input: (),
        user_id: user_id.clone(),
    });
    let cache_value = ApplicationCacheValue::UserTwoFactorSetup(UserTwoFactorSetupCacheValue {
        secret: encrypt_totp_secret(&secret, &ss.config.users.jwt_secret)?,
    });
    ss.cache_service.set_key(cache_key, cache_value).await?;

    Ok(UserTwoFactorInitiateResponse {
        secret,
        qr_code_url,
    })
}

pub async fn complete_two_factor_setup(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UserTwoFactorSetupInput,
) -> Result<UserTwoFactorSetupResponse> {
    let cache_key = ApplicationCacheKey::UserTwoFactorSetup(UserLevelCacheKey {
        input: (),
        user_id: user_id.clone(),
    });

    let Some((cache_id, setup_data)) = ss
        .cache_service
        .get_value::<UserTwoFactorSetupCacheValue>(cache_key.clone())
        .await
    else {
        bail!("Two-factor setup not initiated or expired");
    };

    let decrypted_secret = decrypt_totp_secret(&setup_data.secret, &ss.config.users.jwt_secret)?;
    if !verify_totp_code(&input.totp_code, &decrypted_secret) {
        bail!("Invalid TOTP code");
    }

    let (backup_codes, hashed_backup_codes) = generate_hashed_backup_codes(10);

    let user = user_by_id(&user_id, ss).await?;
    let completed_information = UserTwoFactorInformation {
        secret: setup_data.secret,
        backup_codes: hashed_backup_codes,
    };

    let mut user_active = user.into_active_model();
    user_active.two_factor_information = ActiveValue::Set(Some(completed_information));
    user_active.update(&ss.db).await?;

    ss.cache_service
        .expire_key(ExpireCacheKeyInput::ById(cache_id))
        .await?;

    Ok(UserTwoFactorSetupResponse { backup_codes })
}

pub async fn disable_two_factor(ss: &Arc<SupportingService>, user_id: String) -> Result<bool> {
    let user = user_by_id(&user_id, ss).await?;

    if user.two_factor_information.is_none() {
        bail!("Two-factor authentication is not enabled");
    }

    let mut user_active = user.into_active_model();
    user_active.two_factor_information = ActiveValue::Set(None);
    user_active.update(&ss.db).await?;

    Ok(true)
}

pub async fn generate_new_backup_codes(
    ss: &Arc<SupportingService>,
    user_id: String,
) -> Result<UserTwoFactorBackupCodesResponse> {
    let user = user_by_id(&user_id, ss).await?;

    let Some(ref two_factor_info) = user.two_factor_information else {
        bail!("Two-factor authentication is not enabled");
    };

    let (backup_codes, hashed_backup_codes) = generate_hashed_backup_codes(10);

    let updated_information = UserTwoFactorInformation {
        secret: two_factor_info.secret.clone(),
        backup_codes: hashed_backup_codes,
    };

    let mut user_active = user.into_active_model();
    user_active.two_factor_information = ActiveValue::Set(Some(updated_information));
    user_active.update(&ss.db).await?;

    Ok(UserTwoFactorBackupCodesResponse { backup_codes })
}

fn generate_totp_secret() -> String {
    let charset = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut rng = rand::rng();
    (0..32)
        .map(|_| {
            let idx = rng.random_range(0..charset.len());
            charset[idx] as char
        })
        .collect()
}

fn verify_totp_code(code: &str, secret: &str) -> bool {
    let current_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    for time_step in [-1, 0, 1] {
        let adjusted_time = (current_time as i64 + (time_step * 30)) as u64;
        let expected_code = totp::<Sha1>(secret.as_bytes(), adjusted_time);
        if expected_code == code {
            return true;
        }
    }
    false
}

fn generate_backup_codes(count: u8) -> Vec<String> {
    let mut rng = rand::rng();
    (0..count)
        .map(|_| {
            (0..8)
                .map(|_| {
                    let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
                    let idx = rng.random_range(0..chars.len());
                    chars[idx] as char
                })
                .collect()
        })
        .collect()
}

fn generate_hashed_backup_codes(
    count: u8,
) -> (Vec<String>, Vec<UserTwoFactorInformationBackupCode>) {
    let backup_codes = generate_backup_codes(count);
    let hashed_backup_codes = backup_codes
        .iter()
        .map(|code| UserTwoFactorInformationBackupCode {
            code: hash_backup_code(code),
            used: false,
        })
        .collect();
    (backup_codes, hashed_backup_codes)
}

fn encrypt_totp_secret(secret: &str, key: &str) -> Result<String> {
    let key_bytes = key.as_bytes();
    let encrypted: Vec<u8> = secret
        .as_bytes()
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ key_bytes[i % key_bytes.len()])
        .collect();
    Ok(BASE64.encode(&encrypted))
}

fn decrypt_totp_secret(encrypted_secret: &str, key: &str) -> Result<String> {
    let encrypted_bytes = BASE64.decode(encrypted_secret.as_bytes())?;
    let key_bytes = key.as_bytes();
    let decrypted: Vec<u8> = encrypted_bytes
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ key_bytes[i % key_bytes.len()])
        .collect();
    Ok(String::from_utf8(decrypted)?)
}

fn hash_backup_code(code: &str) -> String {
    let salt = SaltString::try_from_rng(&mut OsRng).unwrap();
    Argon2::default()
        .hash_password(code.as_bytes(), &salt)
        .unwrap()
        .to_string()
}

fn verify_backup_code_against_user(two_factor_info: &UserTwoFactorInformation, code: &str) -> bool {
    two_factor_info
        .backup_codes
        .iter()
        .any(|backup_code| !backup_code.used && verify_backup_code(code, &backup_code.code))
}

fn verify_backup_code(code: &str, hash: &str) -> bool {
    if let Ok(parsed_hash) = PasswordHash::new(hash) {
        Argon2::default()
            .verify_password(code.as_bytes(), &parsed_hash)
            .is_ok()
    } else {
        false
    }
}

async fn mark_backup_code_as_used(
    user_id: &str,
    code: &str,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let user = user_by_id(&user_id.to_string(), ss).await?;
    let user_clone = user.clone();
    let Some(mut two_factor_info) = user_clone.two_factor_information else {
        bail!("Two-factor authentication is not enabled");
    };

    for backup_code in &mut two_factor_info.backup_codes {
        if !backup_code.used && verify_backup_code(code, &backup_code.code) {
            backup_code.used = true;
            break;
        }
    }

    let mut user_active = user.into_active_model();
    user_active.two_factor_information = ActiveValue::Set(Some(two_factor_info));
    user_active.update(&ss.db).await?;

    Ok(())
}
