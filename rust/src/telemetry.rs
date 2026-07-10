//! Anonymous install telemetry for the ZNYX Rust SDK.
//!
//! Sends a single fire-and-forget ping when a client is first constructed, then
//! at most one "heartbeat" ping per 24h. Non-sensitive metadata only:
//! install_id (random UUID, persisted to `~/.znyx/sdk-state.json`), SDK version,
//! source (`"rust-sdk"`), OS / arch / crate version, run_count.
//!
//! No PII, no request content, no tenant data. Opt out with `ZNYX_TELEMETRY=false`
//! (on by default). Disclosed once to stderr on the first run. Every operation is
//! best-effort — telemetry must never slow down, block, or break the calling
//! application. See TELEMETRY.md.

use std::env;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

const HEARTBEAT_INTERVAL_SECONDS: u64 = 86_400; // 24h
const SOURCE: &str = "rust-sdk";

const DISCLOSURE: &str = "[znyx-sdk] Anonymous usage telemetry is on (install id, SDK version, OS - \
no PII, no request content). Opt out with ZNYX_TELEMETRY=false.";

// Only attempt once per process, no matter how many clients are constructed.
static ATTEMPTED: AtomicBool = AtomicBool::new(false);

/// Telemetry endpoint. Defaults to the ZNYX production receiver so anonymous
/// install telemetry is on out of the box (opt-out, fully transparent). Override
/// with `ZNYX_TELEMETRY_URL` (or `ZNYX_HEARTBEAT_URL`), or opt out with
/// `ZNYX_TELEMETRY=false`.
fn endpoint() -> String {
    env::var("ZNYX_TELEMETRY_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| env::var("ZNYX_HEARTBEAT_URL").ok().filter(|s| !s.is_empty()))
        .unwrap_or_else(|| "https://cp.znyx.ai/v1/install-telemetry".to_string())
}

fn enabled() -> bool {
    let val = env::var("ZNYX_TELEMETRY")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| env::var("GUARDRAILS_TELEMETRY").ok().filter(|s| !s.is_empty()))
        .unwrap_or_else(|| "true".to_string())
        .to_lowercase();
    val != "false" && val != "0" && val != "no"
}

fn state_file() -> Option<PathBuf> {
    // Resolve the home directory without pulling in an extra crate.
    let home = env::var("HOME")
        .ok()
        .or_else(|| env::var("USERPROFILE").ok())?;
    Some(PathBuf::from(home).join(".znyx").join("sdk-state.json"))
}

fn load_state(path: &PathBuf) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .filter(|v| v.is_object())
        .unwrap_or_else(|| json!({}))
}

fn save_state(path: &PathBuf, state: &Value) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(s) = serde_json::to_string_pretty(state) {
        let _ = std::fs::write(path, s);
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Format seconds-since-epoch as a minimal ISO-8601 UTC timestamp.
fn iso8601(secs: u64) -> String {
    // Days since epoch → civil date via the algorithm from Howard Hinnant's
    // chrono paper (avoids a chrono/time dependency).
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d, h, mi, s
    )
}

fn parse_iso8601_secs(ts: &str) -> Option<u64> {
    // Expect "YYYY-MM-DDTHH:MM:SS[.fff]Z" (or "+00:00"). Parse the fields we need.
    let bytes = ts.as_bytes();
    if ts.len() < 19 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let num = |a: usize, b: usize| ts.get(a..b)?.parse::<i64>().ok();
    let (year, month, day) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (hour, min, sec) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);

    // Civil date → days since epoch (inverse of the algorithm above).
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;

    let total = days * 86_400 + hour * 3600 + min * 60 + sec;
    u64::try_from(total).ok()
}

fn sdk_version() -> String {
    option_env!("CARGO_PKG_VERSION")
        .unwrap_or("unknown")
        .to_string()
}

/// Best-effort OS release string, for parity with the other SDKs. Rust has no
/// portable stdlib API for this, so shell out to `uname -r` on unix; elsewhere
/// (e.g. Windows) return None, which serializes to JSON null.
fn os_version() -> Option<String> {
    if cfg!(unix) {
        std::process::Command::new("uname")
            .arg("-r")
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
    } else {
        None
    }
}

/// Send an anonymous install ping, throttled to once per 24h. Fire-and-forget.
pub(crate) fn maybe_send_install_ping() {
    if ATTEMPTED.swap(true, Ordering::SeqCst) {
        return;
    }

    // Everything is wrapped so telemetry can never panic into client construction.
    let result = std::panic::catch_unwind(|| {
        if !enabled() {
            return;
        }
        let endpoint = endpoint();
        if endpoint.is_empty() {
            return;
        }
        let path = match state_file() {
            Some(p) => p,
            None => return,
        };

        let mut state = load_state(&path);
        let now = now_secs();

        let event_type = match state.get("last_ping_at").and_then(|v| v.as_str()) {
            None => "first_run",
            Some(last) => {
                let elapsed = match parse_iso8601_secs(last) {
                    Some(then) => now.saturating_sub(then),
                    None => HEARTBEAT_INTERVAL_SECONDS, // unparseable -> treat as due
                };
                if elapsed < HEARTBEAT_INTERVAL_SECONDS {
                    return; // throttled
                }
                "heartbeat"
            }
        };

        let install_id = state
            .get("install_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let run_count = state.get("run_count").and_then(|v| v.as_u64()).unwrap_or(0) + 1;
        let now_iso = iso8601(now);

        if let Value::Object(map) = &mut state {
            map.insert("install_id".into(), json!(install_id));
            map.entry("first_seen_at")
                .or_insert_with(|| json!(now_iso));
            map.insert("last_ping_at".into(), json!(now_iso));
            map.insert("run_count".into(), json!(run_count));
        }
        save_state(&path, &state);

        if event_type == "first_run" {
            eprintln!("{}", DISCLOSURE);
        }

        let payload = json!({
            "install_id": install_id,
            "version": sdk_version(),
            "event_type": event_type,
            "source": SOURCE,
            "os": std::env::consts::OS,
            "os_version": os_version(),
            "arch": std::env::consts::ARCH,
            "run_count": run_count,
            "timestamp": now_iso,
        });

        // Fire-and-forget on a detached thread with a blocking client, so we do
        // not depend on an ambient async runtime and never block the caller.
        std::thread::Builder::new()
            .name("znyx-telemetry".into())
            .spawn(move || {
                let _ = post(&endpoint, &payload);
            })
            .ok();
    });
    let _ = result;
}

fn post(endpoint: &str, payload: &Value) -> Result<(), reqwest::Error> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()?;
    // Swallow the response; telemetry must never fail the app.
    let _ = client.post(endpoint).json(payload).send();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso8601_matches_known_utc_instants() {
        assert_eq!(iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso8601(1_752_192_000), "2025-07-11T00:00:00Z");
    }

    #[test]
    fn parse_inverts_format_exactly() {
        for &s in &[0u64, 1, 59, 86_400, 1_700_000_000, 1_752_192_000] {
            assert_eq!(parse_iso8601_secs(&iso8601(s)), Some(s), "round-trip {s}");
        }
    }

    #[test]
    fn parse_accepts_both_offset_and_z_and_fractions() {
        // Formats emitted by the sibling SDKs that share ~/.znyx/sdk-state.json.
        assert_eq!(parse_iso8601_secs("1970-01-01T00:00:00Z"), Some(0)); // Java/TS/Rust
        assert_eq!(parse_iso8601_secs("1970-01-01T00:00:00+00:00"), Some(0)); // Python/Ruby/.NET
        assert_eq!(
            parse_iso8601_secs("2023-11-14T22:13:20.123456+00:00"),
            Some(1_700_000_000)
        );
    }

    #[test]
    fn parse_rejects_garbage() {
        assert_eq!(parse_iso8601_secs("not-a-timestamp"), None);
        assert_eq!(parse_iso8601_secs(""), None);
    }
}
