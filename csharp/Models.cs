using System.Text.Json.Serialization;

namespace Znyx.Sdk;

public enum Decision
{
    [JsonPropertyName("ALLOW")]    Allow,
    [JsonPropertyName("BLOCK")]    Block,
    [JsonPropertyName("REDACT")]   Redact,
    [JsonPropertyName("WARN")]     Warn,
    [JsonPropertyName("TRANSFORM")]Transform,
}

public sealed class EvaluationRequest
{
    [JsonPropertyName("request_id")]  public string? RequestId  { get; set; }
    [JsonPropertyName("tenant_id")]   public string  TenantId   { get; set; } = "default";
    [JsonPropertyName("app_id")]      public string  AppId      { get; set; } = "default";
    [JsonPropertyName("agent_id")]    public string  AgentId    { get; set; } = "default";
    [JsonPropertyName("env")]         public string  Env        { get; set; } = "prod";
    [JsonPropertyName("text")]        public string  Text       { get; set; } = string.Empty;
    [JsonPropertyName("metadata")]    public Dictionary<string, object>? Metadata { get; set; }
    [JsonPropertyName("trace_id")]    public string? TraceId    { get; set; }
    [JsonPropertyName("session_id")]  public string? SessionId  { get; set; }
    [JsonPropertyName("span_id")]     public string? SpanId     { get; set; }
}

public sealed class ToolEvaluationRequest
{
    [JsonPropertyName("request_id")]  public string? RequestId  { get; set; }
    [JsonPropertyName("tenant_id")]   public string  TenantId   { get; set; } = "default";
    [JsonPropertyName("app_id")]      public string  AppId      { get; set; } = "default";
    [JsonPropertyName("agent_id")]    public string  AgentId    { get; set; } = "default";
    [JsonPropertyName("env")]         public string  Env        { get; set; } = "prod";
    [JsonPropertyName("tool_name")]   public string  ToolName   { get; set; } = string.Empty;
    [JsonPropertyName("tool_args")]   public Dictionary<string, object> ToolArgs { get; set; } = new();
    [JsonPropertyName("metadata")]    public Dictionary<string, object>? Metadata { get; set; }
    [JsonPropertyName("trace_id")]    public string? TraceId    { get; set; }
    [JsonPropertyName("session_id")]  public string? SessionId  { get; set; }
}

public sealed class RuleHit
{
    [JsonPropertyName("rule_id")]   public string RuleId   { get; set; } = string.Empty;
    [JsonPropertyName("severity")]  public string Severity { get; set; } = string.Empty;
    [JsonPropertyName("message")]   public string Message  { get; set; } = string.Empty;
}

public sealed class DetectorResult
{
    [JsonPropertyName("detector_name")] public string       DetectorName { get; set; } = string.Empty;
    [JsonPropertyName("decision")]      public string       Decision     { get; set; } = string.Empty;
    [JsonPropertyName("risk_score")]    public int          RiskScore    { get; set; }
    [JsonPropertyName("latency_ms")]    public int          LatencyMs    { get; set; }
    [JsonPropertyName("rule_hits")]     public List<RuleHit> RuleHits   { get; set; } = new();
}

public sealed class EvaluationResponse
{
    [JsonPropertyName("request_id")]       public string            RequestId        { get; set; } = string.Empty;
    [JsonPropertyName("decision")]         public Decision          Decision         { get; set; }
    [JsonPropertyName("risk_score")]       public int               RiskScore        { get; set; }
    [JsonPropertyName("policy_version")]   public string            PolicyVersion    { get; set; } = string.Empty;
    [JsonPropertyName("rule_hits")]        public List<RuleHit>     RuleHits         { get; set; } = new();
    [JsonPropertyName("sanitized_text")]   public string?           SanitizedText    { get; set; }
    [JsonPropertyName("user_message")]     public string?           UserMessage      { get; set; }
    [JsonPropertyName("developer_message")]public string?           DeveloperMessage { get; set; }
    [JsonPropertyName("latency_ms")]       public int               LatencyMs        { get; set; }
    [JsonPropertyName("trace_id")]         public string?           TraceId          { get; set; }
    [JsonPropertyName("session_id")]       public string?           SessionId        { get; set; }
    [JsonPropertyName("detector_results")] public List<DetectorResult> DetectorResults { get; set; } = new();

    public bool IsBlocked  => Decision == Decision.Block;
    public bool IsRedacted => Decision == Decision.Redact;

    /// <summary>Returns the sanitized text if available, otherwise the original.</summary>
    public string SafeText(string original) =>
        string.IsNullOrEmpty(SanitizedText) ? original : SanitizedText;
}
