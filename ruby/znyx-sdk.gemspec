Gem::Specification.new do |s|
  s.name        = "znyx-sdk"
  s.version     = "1.0.0"
  s.summary     = "Official Ruby SDK for the ZNYX Runtime guardrails API"
  s.homepage    = "https://znyx.ai"
  s.license     = "MIT"
  s.authors     = ["Zitrino"]
  s.email       = ["znyx-team@zitrino.com"]

  s.required_ruby_version = ">= 2.7"

  s.files = Dir["lib/**/*.rb"]

  # Zero runtime dependencies — uses Ruby stdlib only (Net::HTTP, JSON)
end
