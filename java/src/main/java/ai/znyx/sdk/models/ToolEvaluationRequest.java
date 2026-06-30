package ai.znyx.sdk.models;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class ToolEvaluationRequest {

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

    @JsonProperty("tool_name")
    public String toolName;

    @JsonProperty("tool_args")
    public Map<String, Object> toolArgs;

    @JsonProperty("metadata")
    public Map<String, Object> metadata;

    @JsonProperty("trace_id")
    public String traceId;

    @JsonProperty("session_id")
    public String sessionId;

    public ToolEvaluationRequest() {}

    public ToolEvaluationRequest(String tenantId, String appId, String toolName, Map<String, Object> toolArgs) {
        this.tenantId = tenantId;
        this.appId = appId;
        this.toolName = toolName;
        this.toolArgs = toolArgs;
    }

    public ToolEvaluationRequest traceId(String traceId) { this.traceId = traceId; return this; }
    public ToolEvaluationRequest sessionId(String sessionId) { this.sessionId = sessionId; return this; }
    public ToolEvaluationRequest agentId(String agentId) { this.agentId = agentId; return this; }
}
