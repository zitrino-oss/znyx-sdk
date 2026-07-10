# frozen_string_literal: true

require "net/http"
require "uri"
require "json"
require "securerandom"
require "rbconfig"
require "time"
require "fileutils"

module ZnyxSdk
  # Anonymous install telemetry for the ZNYX Ruby SDK.
  #
  # Sends a single fire-and-forget ping when a client is first constructed, then
  # at most one "heartbeat" ping per 24h. Non-sensitive metadata only:
  # install_id (random UUID, persisted to ~/.znyx/sdk-state.json), SDK version,
  # source ("ruby-sdk"), OS / arch / Ruby version, run_count.
  #
  # No PII, no request content, no tenant data. Opt out with
  # ZNYX_TELEMETRY=false (on by default). Disclosed once to stderr on the first
  # run. Every operation is best-effort — telemetry must never slow down, block,
  # or break the calling application. See TELEMETRY.md.
  module Telemetry
    # Telemetry endpoint. Defaults to the ZNYX production receiver so anonymous
    # install telemetry is on out of the box (opt-out, fully transparent).
    # Override with ZNYX_TELEMETRY_URL (or ZNYX_HEARTBEAT_URL), or opt out with
    # ZNYX_TELEMETRY=false.
    ENDPOINT = (
      (ENV["ZNYX_TELEMETRY_URL"] || "").empty? ? nil : ENV["ZNYX_TELEMETRY_URL"]
    ) || (
      (ENV["ZNYX_HEARTBEAT_URL"] || "").empty? ? nil : ENV["ZNYX_HEARTBEAT_URL"]
    ) || "https://cp.znyx.ai/v1/install-telemetry"

    STATE_FILE = File.join(Dir.home, ".znyx", "sdk-state.json")
    HEARTBEAT_INTERVAL = 86_400 # seconds (24h)
    SOURCE = "ruby-sdk"

    DISCLOSURE =
      "[znyx-sdk] Anonymous usage telemetry is on (install id, SDK version, OS - " \
      "no PII, no request content). Opt out with ZNYX_TELEMETRY=false."

    @attempted = false

    class << self
      # Send an anonymous install ping, throttled to once per 24h. Fire-and-forget.
      def maybe_send_install_ping
        return if @attempted

        @attempted = true

        return if ENDPOINT.to_s.empty? || !enabled?

        state = load_state
        last_ping = state["last_ping_at"]

        if last_ping.nil?
          event_type = "first_run"
        else
          begin
            elapsed = Time.now - Time.iso8601(last_ping)
          rescue StandardError
            elapsed = HEARTBEAT_INTERVAL # unparseable -> treat as due
          end
          return if elapsed < HEARTBEAT_INTERVAL

          event_type = "heartbeat"
        end

        install_id = state["install_id"] || SecureRandom.uuid
        run_count  = (state["run_count"] || 0).to_i + 1
        now_iso    = Time.now.utc.iso8601

        state.merge!(
          "install_id"    => install_id,
          "first_seen_at" => state["first_seen_at"] || now_iso,
          "last_ping_at"  => now_iso,
          "run_count"     => run_count
        )
        save_state(state)

        if event_type == "first_run"
          begin
            warn DISCLOSURE
          rescue StandardError
            # ignore
          end
        end

        payload = {
          install_id:   install_id,
          version:      version,
          event_type:   event_type,
          source:       SOURCE,
          os:           RbConfig::CONFIG["host_os"],
          os_version:   host_os_version,
          arch:         RbConfig::CONFIG["host_cpu"],
          ruby_version: RUBY_VERSION,
          run_count:    run_count,
          timestamp:    now_iso
        }

        Thread.new { post(payload) }
      rescue StandardError
        # Telemetry must never break client construction.
      end

      private

      def enabled?
        val = (ENV["ZNYX_TELEMETRY"] || ENV["GUARDRAILS_TELEMETRY"] || "true").downcase
        !%w[false 0 no].include?(val)
      end

      def version
        defined?(ZnyxSdk::VERSION) ? ZnyxSdk::VERSION : "unknown"
      end

      def host_os_version
        `uname -r`.strip
      rescue StandardError
        "unknown"
      end

      def load_state
        return {} unless File.exist?(STATE_FILE)

        JSON.parse(File.read(STATE_FILE))
      rescue StandardError
        {}
      end

      def save_state(state)
        FileUtils.mkdir_p(File.dirname(STATE_FILE))
        File.write(STATE_FILE, JSON.pretty_generate(state))
      rescue StandardError
        # best-effort; never raise
      end

      def post(payload)
        uri = URI.parse(ENDPOINT)
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = uri.scheme == "https"
        http.open_timeout = 3
        http.read_timeout = 3

        request = Net::HTTP::Post.new(uri.request_uri)
        request["Content-Type"] = "application/json"
        request.body = JSON.generate(payload)

        http.request(request)
      rescue StandardError
        # never fail the app because of telemetry
      end
    end
  end
end
