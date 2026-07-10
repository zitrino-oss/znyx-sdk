require "net/http"
require "uri"
require "json"
require "securerandom"

module ZnyxSdk
  # Official Ruby SDK for the ZNYX Runtime guardrails API.
  #
  # @example
  #   client = ZnyxSdk::Client.new("http://localhost:8080")
  #
  #   result = client.evaluate_input(
  #     tenant_id: "my-org",
  #     app_id:    "my-app",
  #     text:      user_message
  #   )
  #   raise result.user_message if result.blocked?
  #
  class Client
    # @param base_url [String] URL of the running ZNYX Runtime (e.g. "http://localhost:8080")
    # @param api_key  [String, nil] Optional API key sent as Authorization: Bearer
    # @param timeout  [Integer] HTTP read/open timeout in seconds (default: 10)
    def initialize(base_url, api_key: nil, timeout: 10)
      @uri     = URI.parse(base_url.chomp("/"))
      @api_key = api_key
      @timeout = timeout

      # Anonymous, opt-out install telemetry (ZNYX_TELEMETRY=false to disable).
      begin
        Telemetry.maybe_send_install_ping
      rescue StandardError
        # telemetry must never break client construction
      end
    end

    # Evaluates a user prompt before sending it to the LLM.
    #
    # @param text      [String] The text to evaluate
    # @param tenant_id [String]
    # @param app_id    [String]
    # @param kwargs    [Hash]   Optional: agent_id, env, trace_id, session_id, metadata
    # @return [EvaluationResponse]
    def evaluate_input(text:, tenant_id: "default", app_id: "default", **kwargs)
      post("/v1/evaluate/input", build_payload(text: text, tenant_id: tenant_id, app_id: app_id, **kwargs))
    end

    # Evaluates an LLM response before returning it to the user.
    def evaluate_output(text:, tenant_id: "default", app_id: "default", **kwargs)
      post("/v1/evaluate/output", build_payload(text: text, tenant_id: tenant_id, app_id: app_id, **kwargs))
    end

    # Evaluates a tool call before executing it.
    #
    # @param tool_name [String]
    # @param tool_args [Hash]
    def evaluate_tool(tool_name:, tool_args:, tenant_id: "default", app_id: "default", **kwargs)
      payload = {
        request_id: new_request_id,
        tenant_id:  tenant_id,
        app_id:     app_id,
        agent_id:   kwargs.delete(:agent_id) || "default",
        env:        kwargs.delete(:env)      || "prod",
        tool_name:  tool_name,
        tool_args:  tool_args,
      }.merge(kwargs.compact)
      post("/v1/evaluate/tool", payload)
    end

    private

    def build_payload(text:, tenant_id:, app_id:, **kwargs)
      {
        request_id: new_request_id,
        tenant_id:  tenant_id,
        app_id:     app_id,
        agent_id:   kwargs.delete(:agent_id) || "default",
        env:        kwargs.delete(:env)      || "prod",
        text:       text,
      }.merge(kwargs.compact)
    end

    def post(path, payload)
      http = Net::HTTP.new(@uri.host, @uri.port)
      http.use_ssl     = @uri.scheme == "https"
      http.read_timeout = @timeout
      http.open_timeout = @timeout

      request = Net::HTTP::Post.new(path)
      request["Content-Type"] = "application/json"
      request["Authorization"] = "Bearer #{@api_key}" if @api_key
      request.body = JSON.generate(payload)

      response = http.request(request)

      if response.code.to_i >= 400
        raise ZnyxError.new(
          "ZNYX Runtime returned #{response.code}: #{response.body}",
          status_code: response.code.to_i
        )
      end

      EvaluationResponse.new(JSON.parse(response.body))
    rescue ZnyxError
      raise
    rescue => e
      raise ZnyxError, "HTTP request failed: #{e.message}"
    end

    def new_request_id
      "req_#{SecureRandom.hex(4)}"
    end
  end
end
