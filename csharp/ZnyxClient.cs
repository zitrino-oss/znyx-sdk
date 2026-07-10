using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Znyx.Sdk;

/// <summary>
/// Official .NET SDK for the ZNYX Runtime guardrails API.
/// </summary>
/// <example>
/// <code>
/// var client = new ZnyxClient("http://localhost:8080");
///
/// var result = await client.EvaluateInputAsync(new EvaluationRequest
/// {
///     TenantId = "my-org",
///     AppId    = "my-app",
///     Text     = userMessage,
/// });
///
/// if (result.IsBlocked)
///     return Results.BadRequest(result.UserMessage);
/// </code>
/// </example>
public sealed class ZnyxClient : IDisposable
{
    private readonly HttpClient _http;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() },
    };

    public ZnyxClient(string baseUrl, string? apiKey = null)
    {
        _http = new HttpClient { BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/") };
        _http.Timeout = TimeSpan.FromSeconds(10);
        if (!string.IsNullOrEmpty(apiKey))
            _http.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");

        // Anonymous, opt-out install telemetry (ZNYX_TELEMETRY=false to disable).
        try
        {
            Telemetry.MaybeSendInstallPing();
        }
        catch
        {
            // telemetry must never break client construction
        }
    }

    /// <summary>Evaluates a user prompt before sending it to the LLM.</summary>
    public Task<EvaluationResponse> EvaluateInputAsync(
        EvaluationRequest request, CancellationToken ct = default)
    {
        ApplyDefaults(request);
        return PostAsync<EvaluationResponse>("v1/evaluate/input", request, ct);
    }

    /// <summary>Evaluates an LLM response before returning it to the user.</summary>
    public Task<EvaluationResponse> EvaluateOutputAsync(
        EvaluationRequest request, CancellationToken ct = default)
    {
        ApplyDefaults(request);
        return PostAsync<EvaluationResponse>("v1/evaluate/output", request, ct);
    }

    /// <summary>Evaluates a tool call before executing it.</summary>
    public Task<EvaluationResponse> EvaluateToolAsync(
        ToolEvaluationRequest request, CancellationToken ct = default)
    {
        ApplyToolDefaults(request);
        return PostAsync<EvaluationResponse>("v1/evaluate/tool", request, ct);
    }

    private async Task<T> PostAsync<T>(string path, object body, CancellationToken ct)
    {
        using var response = await _http.PostAsJsonAsync(path, body, JsonOptions, ct);

        if (!response.IsSuccessStatusCode)
        {
            var error = await response.Content.ReadAsStringAsync(ct);
            throw new ZnyxException(
                $"ZNYX Runtime returned {(int)response.StatusCode}: {error}",
                (int)response.StatusCode);
        }

        var result = await response.Content.ReadFromJsonAsync<T>(JsonOptions, ct);
        return result ?? throw new ZnyxException("Empty response from ZNYX Runtime");
    }

    private static void ApplyDefaults(EvaluationRequest req)
    {
        req.RequestId ??= NewRequestId();
        req.AgentId   ??= "default";
        req.Env       ??= "prod";
    }

    private static void ApplyToolDefaults(ToolEvaluationRequest req)
    {
        req.RequestId ??= NewRequestId();
        req.AgentId   ??= "default";
        req.Env       ??= "prod";
    }

    private static string NewRequestId() =>
        $"req_{Convert.ToHexString(Guid.NewGuid().ToByteArray())[..8].ToLower()}";

    public void Dispose() => _http.Dispose();
}

public sealed class ZnyxException : Exception
{
    public int StatusCode { get; }

    public ZnyxException(string message) : base(message) { }

    public ZnyxException(string message, int statusCode) : base(message)
        => StatusCode = statusCode;
}
