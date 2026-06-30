module ZnyxSdk
  DECISIONS = %w[ALLOW BLOCK REDACT WARN TRANSFORM].freeze

  # Immutable value object returned by all evaluate methods.
  class EvaluationResponse
    attr_reader :request_id, :decision, :risk_score, :policy_version,
                :rule_hits, :sanitized_text, :user_message,
                :developer_message, :latency_ms, :trace_id, :session_id,
                :detector_results

    def initialize(data)
      @request_id        = data["request_id"]
      @decision          = data["decision"]
      @risk_score        = data["risk_score"].to_i
      @policy_version    = data["policy_version"]
      @rule_hits         = Array(data["rule_hits"]).map { |h| RuleHit.new(h) }
      @sanitized_text    = data["sanitized_text"]
      @user_message      = data["user_message"]
      @developer_message = data["developer_message"]
      @latency_ms        = data["latency_ms"].to_i
      @trace_id          = data["trace_id"]
      @session_id        = data["session_id"]
      @detector_results  = Array(data["detector_results"]).map { |d| DetectorResult.new(d) }
    end

    def blocked?   = @decision == "BLOCK"
    def redacted?  = @decision == "REDACT"

    # Returns sanitized_text if present, otherwise the original string.
    def safe_text(original)
      sanitized_text.nil? || sanitized_text.empty? ? original : sanitized_text
    end
  end

  class RuleHit
    attr_reader :rule_id, :severity, :message

    def initialize(data)
      @rule_id  = data["rule_id"]
      @severity = data["severity"]
      @message  = data["message"]
    end
  end

  class DetectorResult
    attr_reader :detector_name, :decision, :risk_score, :latency_ms, :rule_hits

    def initialize(data)
      @detector_name = data["detector_name"]
      @decision      = data["decision"]
      @risk_score    = data["risk_score"].to_i
      @latency_ms    = data["latency_ms"].to_i
      @rule_hits     = Array(data["rule_hits"]).map { |h| RuleHit.new(h) }
    end
  end

  class ZnyxError < StandardError
    attr_reader :status_code

    def initialize(message, status_code: nil)
      super(message)
      @status_code = status_code
    end
  end
end
