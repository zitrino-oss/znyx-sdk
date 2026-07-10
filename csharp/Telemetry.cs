using System.Net.Http.Json;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace Znyx.Sdk;

/// <summary>
/// Anonymous install telemetry for the ZNYX .NET SDK.
///
/// Sends a single fire-and-forget ping when a client is first constructed, then
/// at most one "heartbeat" ping per 24h. Non-sensitive metadata only:
/// install_id (random UUID, persisted to ~/.znyx/sdk-state.json), SDK version,
/// source ("dotnet-sdk"), OS / arch / .NET version, run_count.
///
/// No PII, no request content, no tenant data. Opt out with ZNYX_TELEMETRY=false
/// (on by default). Disclosed once to stderr on the first run. Every operation is
/// best-effort — telemetry must never slow down, block, or break the calling
/// application. See TELEMETRY.md.
/// </summary>
internal static class Telemetry
{
    // Telemetry endpoint. Defaults to the ZNYX production receiver so anonymous
    // install telemetry is on out of the box (opt-out, fully transparent).
    // Override with ZNYX_TELEMETRY_URL (or ZNYX_HEARTBEAT_URL), or opt out with
    // ZNYX_TELEMETRY=false.
    private static readonly string Endpoint = ResolveEndpoint();

    private static readonly string StateFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".znyx", "sdk-state.json");

    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromHours(24);
    private const string Source = "dotnet-sdk";

    private const string Disclosure =
        "[znyx-sdk] Anonymous usage telemetry is on (install id, SDK version, OS - " +
        "no PII, no request content). Opt out with ZNYX_TELEMETRY=false.";

    // Only attempt once per process, no matter how many clients are constructed.
    private static int _attempted;

    private static string ResolveEndpoint()
    {
        var url = Environment.GetEnvironmentVariable("ZNYX_TELEMETRY_URL");
        if (string.IsNullOrEmpty(url))
            url = Environment.GetEnvironmentVariable("ZNYX_HEARTBEAT_URL");
        if (string.IsNullOrEmpty(url))
            url = "https://cp.znyx.ai/v1/install-telemetry";
        return url;
    }

    private static bool Enabled()
    {
        var val = Environment.GetEnvironmentVariable("ZNYX_TELEMETRY");
        if (string.IsNullOrEmpty(val))
            val = Environment.GetEnvironmentVariable("GUARDRAILS_TELEMETRY");
        if (string.IsNullOrEmpty(val))
            val = "true";
        val = val.ToLowerInvariant();
        return val != "false" && val != "0" && val != "no";
    }

    private static string SdkVersion()
    {
        try
        {
            var v = typeof(ZnyxClient).Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                ?? typeof(ZnyxClient).Assembly.GetName().Version?.ToString();
            return string.IsNullOrEmpty(v) ? "unknown" : v!;
        }
        catch
        {
            return "unknown";
        }
    }

    /// <summary>Send an anonymous install ping, throttled to once per 24h. Fire-and-forget.</summary>
    public static void MaybeSendInstallPing()
    {
        if (Interlocked.Exchange(ref _attempted, 1) == 1)
            return;

        try
        {
            if (string.IsNullOrEmpty(Endpoint) || !Enabled())
                return;

            var state = LoadState();

            string eventType;
            if (!state.TryGetValue("last_ping_at", out var lastPingObj) || lastPingObj is null)
            {
                eventType = "first_run";
            }
            else
            {
                TimeSpan elapsed;
                try
                {
                    elapsed = DateTimeOffset.UtcNow - DateTimeOffset.Parse(lastPingObj.ToString()!);
                }
                catch
                {
                    elapsed = HeartbeatInterval; // unparseable -> treat as due
                }
                if (elapsed < HeartbeatInterval)
                    return; // throttled
                eventType = "heartbeat";
            }

            var installId = state.TryGetValue("install_id", out var idObj) && idObj is not null
                ? idObj.ToString()!
                : Guid.NewGuid().ToString();
            var runCount = (state.TryGetValue("run_count", out var rcObj) && rcObj is not null
                && long.TryParse(rcObj.ToString(), out var rc) ? rc : 0) + 1;
            var nowIso = DateTimeOffset.UtcNow.ToString("o");

            state["install_id"] = installId;
            if (!state.ContainsKey("first_seen_at")) state["first_seen_at"] = nowIso;
            state["last_ping_at"] = nowIso;
            state["run_count"] = runCount;
            SaveState(state);

            if (eventType == "first_run")
            {
                try { Console.Error.WriteLine(Disclosure); }
                catch { /* ignore */ }
            }

            var payload = new Dictionary<string, object>
            {
                ["install_id"] = installId,
                ["version"] = SdkVersion(),
                ["event_type"] = eventType,
                ["source"] = Source,
                ["os"] = RuntimeInformation.OSDescription,
                ["os_version"] = Environment.OSVersion.Version.ToString(),
                ["arch"] = RuntimeInformation.OSArchitecture.ToString(),
                ["dotnet_version"] = RuntimeInformation.FrameworkDescription,
                ["run_count"] = runCount,
                ["timestamp"] = nowIso,
            };

            // Fire-and-forget — do not await; swallow every error.
            _ = Task.Run(() => Post(payload));
        }
        catch
        {
            // Telemetry must never break client construction.
        }
    }

    private static async Task Post(Dictionary<string, object> payload)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            using var resp = await http.PostAsJsonAsync(Endpoint, payload);
        }
        catch
        {
            // never fail the app because of telemetry
        }
    }

    private static Dictionary<string, object> LoadState()
    {
        try
        {
            if (File.Exists(StateFile))
            {
                var json = File.ReadAllText(StateFile);
                return JsonSerializer.Deserialize<Dictionary<string, object>>(json)
                       ?? new Dictionary<string, object>();
            }
        }
        catch
        {
            // fall through to empty state
        }
        return new Dictionary<string, object>();
    }

    private static void SaveState(Dictionary<string, object> state)
    {
        try
        {
            var dir = Path.GetDirectoryName(StateFile);
            if (!string.IsNullOrEmpty(dir))
                Directory.CreateDirectory(dir);
            File.WriteAllText(StateFile,
                JsonSerializer.Serialize(state, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch
        {
            // best-effort; never raise
        }
    }
}
