package ai.znyx.sdk.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class DetectorResult {

    @JsonProperty("detector_name")
    public String detectorName;

    @JsonProperty("decision")
    public String decision;

    @JsonProperty("risk_score")
    public int riskScore;

    @JsonProperty("latency_ms")
    public int latencyMs;

    @JsonProperty("rule_hits")
    public List<RuleHit> ruleHits;
}
