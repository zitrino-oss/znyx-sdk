package ai.znyx.sdk.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class EvaluationResponse {

    @JsonProperty("request_id")
    public String requestId;

    @JsonProperty("decision")
    public Decision decision;

    @JsonProperty("risk_score")
    public int riskScore;

    @JsonProperty("policy_version")
    public String policyVersion;

    @JsonProperty("rule_hits")
    public List<RuleHit> ruleHits;

    @JsonProperty("sanitized_text")
    public String sanitizedText;

    @JsonProperty("user_message")
    public String userMessage;

    @JsonProperty("developer_message")
    public String developerMessage;

    @JsonProperty("latency_ms")
    public int latencyMs;

    @JsonProperty("trace_id")
    public String traceId;

    @JsonProperty("session_id")
    public String sessionId;

    @JsonProperty("detector_results")
    public List<DetectorResult> detectorResults;

    public boolean isBlocked() {
        return Decision.BLOCK.equals(decision);
    }

    public boolean isRedacted() {
        return Decision.REDACT.equals(decision);
    }

    /** Returns sanitized text if available, otherwise the original. */
    public String safeText(String original) {
        return (sanitizedText != null && !sanitizedText.isEmpty()) ? sanitizedText : original;
    }
}
