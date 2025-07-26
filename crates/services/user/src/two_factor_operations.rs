use std::{
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use aes_gcm::{
    Aes256Gcm, Key, Nonce,
    aead::{Aead, AeadCore, KeyInit, OsRng as AeadOsRng},
};
use anyhow::{Result, anyhow, bail};
use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use chrono::Utc;
use common_models::UserLevelCacheKey;
use common_utils::TWO_FACTOR_BACKUP_CODES_COUNT;
use data_encoding::{BASE32, BASE64};
use database_utils::user_by_id;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, EmptyCacheValue, ExpireCacheKeyInput,
    UserTwoFactorSetupCacheValue,
};
use media_models::{
    ApiKeyResponse, UserTwoFactorBackupCodesResponse, UserTwoFactorInitiateResponse,
    UserTwoFactorSetupInput, UserTwoFactorVerifyInput, UserTwoFactorVerifyMethod,
    VerifyTwoFactorError, VerifyTwoFactorErrorVariant, VerifyTwoFactorResult,
};
use rand::TryRngCore;
use sea_orm::{ActiveModelTrait, ActiveValue, IntoActiveModel};
use subtle::ConstantTimeEq;
use supporting_service::SupportingService;
use tokio::time::sleep;
use totp_lite::{DEFAULT_STEP, Sha1, totp_custom};
use user_models::{UserTwoFactorInformation, UserTwoFactorInformationBackupCode};

use crate::authentication_operations::generate_auth_token;

const TOTP_CODE_DIGITS: u32 = 6;
const BACKUP_CODE_LENGTH: usize = 8;
const TOTP_SECRET_LENGTH: usize = 20;
const TOTP_TIME_STEP_SECONDS: i64 = 30;
const TOTP_VERIFICATION_MIN_MS: u64 = 500;
const SETUP_VERIFICATION_MIN_MS: u64 = 300;
const BACKUP_CODE_VERIFICATION_MIN_MS: u64 = 1200;

async fn verify_with_minimum_time<F, T>(min_duration: Duration, operation: F) -> T
where
    F: FnOnce() -> T,
{
    let start = Instant::now();
    let result = operation();
    let elapsed = start.elapsed();

    if elapsed < min_duration {
        let sleep_time = min_duration - elapsed;
        sleep(sleep_time).await;
    }

    result
}

pub async fn verify_two_factor(
    ss: &Arc<SupportingService>,
    input: UserTwoFactorVerifyInput,
) -> Result<VerifyTwoFactorResult> {
    let rate_limit_key = ApplicationCacheKey::UserTwoFactorRateLimit(UserLevelCacheKey {
        input: (),
        user_id: input.user_id.clone(),
    });

    if ss
        .cache_service
        .get_value::<EmptyCacheValue>(rate_limit_key.clone())
        .await
        .is_some()
    {
        return Ok(VerifyTwoFactorResult::Error(VerifyTwoFactorError {
            error: VerifyTwoFactorErrorVariant::RateLimited,
        }));
    }

    ss.cache_service
        .set_key(
            rate_limit_key,
            ApplicationCacheValue::UserTwoFactorRateLimit(EmptyCacheValue { _empty: () }),
        )
        .await?;

    let is_backup_code = matches!(input.method, UserTwoFactorVerifyMethod::BackupCode);

    let user = user_by_id(&input.user_id, ss).await?;
    let Some(two_factor_info) = &user.two_factor_information else {
        return Ok(VerifyTwoFactorResult::Error(VerifyTwoFactorError {
            error: VerifyTwoFactorErrorVariant::Invalid,
        }));
    };

    let min_duration = if is_backup_code {
        Duration::from_millis(BACKUP_CODE_VERIFICATION_MIN_MS)
    } else {
        Duration::from_millis(TOTP_VERIFICATION_MIN_MS)
    };

    let verification_result = verify_with_minimum_time(min_duration, || -> Result<bool> {
        if is_backup_code {
            return Ok(verify_backup_code_against_user(
                two_factor_info,
                &input.code,
            ));
        }
        let decrypted_secret = decrypt_totp_secret(
            &two_factor_info.secret,
            &ss.config.server.admin_access_token,
        )?;
        Ok(verify_totp_code(&input.code, &decrypted_secret))
    })
    .await?;

    if !verification_result {
        return Ok(VerifyTwoFactorResult::Error(VerifyTwoFactorError {
            error: VerifyTwoFactorErrorVariant::Invalid,
        }));
    }

    if is_backup_code {
        mark_backup_code_as_used(&input.user_id, &input.code, ss).await?;
    }

    let session_id = generate_auth_token(ss, input.user_id.clone()).await?;
    let mut user = user.into_active_model();
    user.last_login_on = ActiveValue::Set(Some(Utc::now()));
    user.update(&ss.db).await?;

    Ok(VerifyTwoFactorResult::Ok(ApiKeyResponse {
        api_key: session_id,
    }))
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
        secret: encrypt_totp_secret(&secret, &ss.config.server.admin_access_token)?,
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
) -> Result<UserTwoFactorBackupCodesResponse> {
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

    let decrypted_secret =
        decrypt_totp_secret(&setup_data.secret, &ss.config.server.admin_access_token)?;

    let is_valid =
        verify_with_minimum_time(Duration::from_millis(SETUP_VERIFICATION_MIN_MS), || {
            verify_totp_code(&input.totp_code, &decrypted_secret)
        })
        .await;

    if !is_valid {
        bail!("Invalid TOTP code");
    }

    let (backup_codes, hashed_backup_codes) =
        generate_hashed_backup_codes(TWO_FACTOR_BACKUP_CODES_COUNT);

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

    Ok(UserTwoFactorBackupCodesResponse { backup_codes })
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

pub async fn regenerate_two_factor_backup_codes(
    ss: &Arc<SupportingService>,
    user_id: String,
) -> Result<UserTwoFactorBackupCodesResponse> {
    let user = user_by_id(&user_id, ss).await?;

    let Some(mut two_factor_info) = user.two_factor_information.clone() else {
        bail!("Two-factor authentication is not enabled");
    };

    let (backup_codes, hashed_backup_codes) =
        generate_hashed_backup_codes(TWO_FACTOR_BACKUP_CODES_COUNT);
    two_factor_info.backup_codes = hashed_backup_codes;

    let mut user_active = user.into_active_model();
    user_active.two_factor_information = ActiveValue::Set(Some(two_factor_info));
    user_active.update(&ss.db).await?;

    Ok(UserTwoFactorBackupCodesResponse { backup_codes })
}

fn generate_totp_secret() -> String {
    let mut secret_bytes = vec![0u8; TOTP_SECRET_LENGTH];
    let mut rng = OsRng;
    rng.try_fill_bytes(&mut secret_bytes)
        .expect("Failed to generate random bytes");
    BASE32.encode(&secret_bytes)
}

fn verify_totp_code(code: &str, secret: &str) -> bool {
    let secret_bytes = match BASE32.decode(secret.as_bytes()) {
        Ok(bytes) => bytes,
        Err(_) => vec![0; TOTP_SECRET_LENGTH],
    };

    let current_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let mut verification_result = false;

    for time_step in [-1, 0, 1] {
        let adjusted_time = (current_time as i64 + (time_step * TOTP_TIME_STEP_SECONDS)) as u64;
        let expected_code =
            totp_custom::<Sha1>(DEFAULT_STEP, TOTP_CODE_DIGITS, &secret_bytes, adjusted_time);

        let is_equal: bool = expected_code.as_bytes().ct_eq(code.as_bytes()).into();
        verification_result |= is_equal;
    }

    verification_result
}

fn generate_backup_codes(count: u8) -> Vec<String> {
    let mut rng = OsRng;
    (0..count)
        .map(|_| {
            (0..BACKUP_CODE_LENGTH)
                .map(|_| {
                    let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
                    let mut random_byte = [0u8; 1];
                    rng.try_fill_bytes(&mut random_byte)
                        .expect("Failed to generate random byte");
                    let idx = (random_byte[0] as usize) % chars.len();
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
            used_at: None,
        })
        .collect();
    (backup_codes, hashed_backup_codes)
}

fn encrypt_totp_secret(secret: &str, key: &str) -> Result<String> {
    let key_hash = ring::digest::digest(&ring::digest::SHA256, key.as_bytes());
    let cipher_key = Key::<Aes256Gcm>::from_slice(key_hash.as_ref());
    let cipher = Aes256Gcm::new(cipher_key);

    let nonce = Aes256Gcm::generate_nonce(&mut AeadOsRng);

    let ciphertext = cipher
        .encrypt(&nonce, secret.as_bytes())
        .map_err(|e| anyhow!("Encryption failed: {}", e))?;

    let mut result = nonce.to_vec();
    result.extend_from_slice(&ciphertext);
    Ok(BASE64.encode(&result))
}

fn decrypt_totp_secret(encrypted_secret: &str, key: &str) -> Result<String> {
    let encrypted_bytes = BASE64.decode(encrypted_secret.as_bytes())?;

    if encrypted_bytes.len() < 12 {
        bail!("Invalid encrypted data: too short");
    }

    let key_hash = ring::digest::digest(&ring::digest::SHA256, key.as_bytes());
    let cipher_key = Key::<Aes256Gcm>::from_slice(key_hash.as_ref());
    let cipher = Aes256Gcm::new(cipher_key);

    let (nonce_bytes, cipher_text) = encrypted_bytes.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, cipher_text)
        .map_err(|e| anyhow!("Decryption failed: {}", e))?;

    String::from_utf8(plaintext).map_err(|e| anyhow!("Invalid UTF-8: {}", e))
}

fn hash_backup_code(code: &str) -> String {
    let salt = SaltString::try_from_rng(&mut OsRng).unwrap();
    Argon2::default()
        .hash_password(code.as_bytes(), &salt)
        .unwrap()
        .to_string()
}

fn verify_backup_code_against_user(two_factor_info: &UserTwoFactorInformation, code: &str) -> bool {
    let mut verification_result = false;

    for backup_code in &two_factor_info.backup_codes {
        let is_unused = backup_code.used_at.is_none();
        let code_matches = verify_backup_code(code, &backup_code.code);

        verification_result |= is_unused && code_matches;
    }

    verification_result
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
    let Some(mut two_factor_info) = user.two_factor_information.clone() else {
        bail!("Two-factor authentication is not enabled");
    };

    for backup_code in &mut two_factor_info.backup_codes {
        if backup_code.used_at.is_none() && verify_backup_code(code, &backup_code.code) {
            backup_code.used_at = Some(Utc::now());
            break;
        }
    }

    let mut user_active = user.into_active_model();
    user_active.two_factor_information = ActiveValue::Set(Some(two_factor_info));
    user_active.update(&ss.db).await?;

    Ok(())
}
