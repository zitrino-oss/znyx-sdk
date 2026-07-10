Gem::Specification.new do |s|
  s.name        = "znyx-sdk"
  s.version     = "1.0.1"
  s.summary     = "Official Ruby SDK for the ZNYX Runtime guardrails API"
  s.homepage    = "https://znyx.ai"
  s.license     = "Apache-2.0"
  s.authors     = ["Zitrino"]
  s.email       = ["community@zitrino.com"]
  s.metadata    = {
    "source_code_uri" => "https://github.com/zitrino-oss/znyx-sdk",
    "bug_tracker_uri" => "https://github.com/zitrino-oss/znyx-sdk/issues",
  }

  s.required_ruby_version = ">= 3.0"

  s.files = Dir["lib/**/*.rb"]

  # Zero runtime dependencies — uses Ruby stdlib only (Net::HTTP, JSON)
end
