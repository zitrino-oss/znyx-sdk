package ai.znyx.sdk;

import ai.znyx.sdk.models.EvaluationRequest;
import ai.znyx.sdk.models.EvaluationResponse;
import ai.znyx.sdk.models.ToolEvaluationRequest;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Random;
import java.util.concurrent.CompletableFuture;

/**
 * Official Java SDK for the ZNYX Runtime guardrails API.
 *
 * <pre>{@code
 * ZnyxClient client = ZnyxClient.builder("http://localhost:8080").build();
 *
 * EvaluationResponse result = client.evaluateInput(
 *     new EvaluationRequest("my-org", "my-app", userMessage)
 * );
 * if (result.isBlocked()) {
 *     throw new RuntimeException(result.userMessage);
 * }
 * }</pre>
 */
public class ZnyxClient {

    private final String baseUrl;
    private final String apiKey;
    private final HttpClient httpClient;
    private final ObjectMapper mapper;

    private ZnyxClient(Builder builder) {
        this.baseUrl = builder.baseUrl.replaceAll("/$", "");
        this.apiKey = builder.apiKey;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        this.mapper = new ObjectMapper();
    }

    // ── Synchronous API ───────────────────────────────────────────────────────

    /** Evaluates a user prompt before sending it to the LLM. */
    public EvaluationResponse evaluateInput(EvaluationRequest request) {
        applyDefaults(request);
        return post("/v1/evaluate/input", request);
    }

    /** Evaluates an LLM response before returning it to the user. */
    public EvaluationResponse evaluateOutput(EvaluationRequest request) {
        applyDefaults(request);
        return post("/v1/evaluate/output", request);
    }

    /** Evaluates a tool call before executing it. */
    public EvaluationResponse evaluateTool(ToolEvaluationRequest request) {
        applyToolDefaults(request);
        return post("/v1/evaluate/tool", request);
    }

    // ── Async API ─────────────────────────────────────────────────────────────

    /** Async variant of {@link #evaluateInput}. */
    public CompletableFuture<EvaluationResponse> evaluateInputAsync(EvaluationRequest request) {
        applyDefaults(request);
        return postAsync("/v1/evaluate/input", request);
    }

    /** Async variant of {@link #evaluateOutput}. */
    public CompletableFuture<EvaluationResponse> evaluateOutputAsync(EvaluationRequest request) {
        applyDefaults(request);
        return postAsync("/v1/evaluate/output", request);
    }

    /** Async variant of {@link #evaluateTool}. */
    public CompletableFuture<EvaluationResponse> evaluateToolAsync(ToolEvaluationRequest request) {
        applyToolDefaults(request);
        return postAsync("/v1/evaluate/tool", request);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private EvaluationResponse post(String path, Object body) {
        try {
            HttpRequest req = buildRequest(path, body);
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            return parseResponse(resp, path);
        } catch (ZnyxException e) {
            throw e;
        } catch (Exception e) {
            throw new ZnyxException("HTTP request failed: " + e.getMessage(), e);
        }
    }

    private CompletableFuture<EvaluationResponse> postAsync(String path, Object body) {
        try {
            HttpRequest req = buildRequest(path, body);
            return httpClient.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                    .thenApply(resp -> parseResponse(resp, path));
        } catch (Exception e) {
            return CompletableFuture.failedFuture(
                    new ZnyxException("Failed to build request: " + e.getMessage(), e));
        }
    }

    private HttpRequest buildRequest(String path, Object body) throws Exception {
        String json = mapper.writeValueAsString(body);
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + path))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json));
        if (apiKey != null && !apiKey.isEmpty()) {
            builder.header("Authorization", "Bearer " + apiKey);
        }
        return builder.build();
    }

    private EvaluationResponse parseResponse(HttpResponse<String> resp, String path) {
        if (resp.statusCode() >= 400) {
            throw new ZnyxException(
                    "Server returned " + resp.statusCode() + " for " + path, resp.statusCode());
        }
        try {
            return mapper.readValue(resp.body(), EvaluationResponse.class);
        } catch (Exception e) {
            throw new ZnyxException("Failed to parse response: " + e.getMessage(), e);
        }
    }

    private static void applyDefaults(EvaluationRequest req) {
        if (req.requestId == null) req.requestId = newRequestId();
        if (req.agentId == null)   req.agentId = "default";
        if (req.env == null)       req.env = "prod";
    }

    private static void applyToolDefaults(ToolEvaluationRequest req) {
        if (req.requestId == null) req.requestId = newRequestId();
        if (req.agentId == null)   req.agentId = "default";
        if (req.env == null)       req.env = "prod";
    }

    private static final Random RNG = new Random();

    private static String newRequestId() {
        byte[] b = new byte[4];
        RNG.nextBytes(b);
        return "req_" + HexFormat.of().formatHex(b);
    }

    // ── Builder ───────────────────────────────────────────────────────────────

    public static Builder builder(String baseUrl) {
        return new Builder(baseUrl);
    }

    public static final class Builder {
        private final String baseUrl;
        private String apiKey;

        private Builder(String baseUrl) {
            this.baseUrl = baseUrl;
        }

        public Builder apiKey(String apiKey) {
            this.apiKey = apiKey;
            return this;
        }

        public ZnyxClient build() {
            return new ZnyxClient(this);
        }
    }
}
