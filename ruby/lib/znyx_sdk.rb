require_relative "znyx_sdk/models"
require_relative "znyx_sdk/client"
require_relative "znyx_sdk/telemetry"

module ZnyxSdk
  # Resolved from the loaded gem spec, never a literal.
  #
  # The publish workflow stamps the release tag into ruby/*.gemspec ONLY, so a
  # literal here is never updated by a release and goes stale - Telemetry#version
  # reads this constant, so every install reported the same frozen number
  # regardless of the gem version actually installed.
  #
  # Gem.loaded_specs is populated for the normal RubyGems/Bundler install path.
  # A vendored source checkout has no spec, and is marked as obviously-unreal
  # rather than guessing a number.
  VERSION = (Gem.loaded_specs["znyx-sdk"]&.version&.to_s || "0.0.0+unknown").freeze
end
