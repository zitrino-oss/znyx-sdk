package ai.znyx.sdk.models;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class EvaluationRequest {

    @JsonProperty("request_id")
    public String requestId;

    @JsonProperty("tenant_id")
    public String tenantId;

    @JsonProperty("app_id")
    public String appId;

    @JsonProperty("agent_id")
    public String agentId = "default";

    @JsonProperty("env")
    public String env = "prod";

    @JsonProperty("text")
    public String text;

    @JsonProperty("metadata")
    public Map<String, Object> metadata;

    @JsonProperty("trace_id")
    public String traceId;

    @JsonProperty("session_id")
    public String sessionId;

    @JsonProperty("span_id")
    public String spanId;

    public EvaluationRequest() {}

    public EvaluationRequest(String tenantId, String appId, String text) {
        this.tenantId = tenantId;
        this.appId = appId;
        this.text = text;
    }

    // Fluent setters for optional fields
    public EvaluationRequest traceId(String traceId) { this.traceId = traceId; return this; }
    public EvaluationRequest sessionId(String sessionId) { this.sessionId = sessionId; return this; }
    public EvaluationRequest agentId(String agentId) { this.agentId = agentId; return this; }
    public EvaluationRequest env(String env) { this.env = env; return this; }
    public EvaluationRequest metadata(Map<String, Object> metadata) { this.metadata = metadata; return this; }
}
