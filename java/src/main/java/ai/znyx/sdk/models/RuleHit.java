package ai.znyx.sdk.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class RuleHit {

    @JsonProperty("rule_id")
    public String ruleId;

    @JsonProperty("severity")
    public String severity;

    @JsonProperty("message")
    public String message;
}
