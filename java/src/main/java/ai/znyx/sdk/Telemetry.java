package ai.znyx.sdk;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Anonymous install telemetry for the ZNYX Java SDK.
 *
 * <p>Sends a single fire-and-forget ping when a client is first constructed, then
 * at most one "heartbeat" ping per 24h. Non-sensitive metadata only:
 * install_id (random UUID, persisted to {@code ~/.znyx/sdk-state-java.json}), SDK
 * version, source ("java-sdk"), OS / arch / Java version, run_count. The state
 * file is per language, so this SDK's ping schedule is independent of any other
 * ZNYX SDK installed on the same machine.
 *
 * <p>No PII, no request content, no tenant data. Opt out with
 * {@code ZNYX_TELEMETRY=false} (on by default). Disclosed once to stderr on the
 * first run. Every operation is best-effort — telemetry must never slow down,
 * block, or break the calling application. See TELEMETRY.md.
 */
final class Telemetry {

    // Telemetry endpoint. Defaults to the ZNYX production receiver so anonymous
    // install telemetry is on out of the box (opt-out, fully transparent).
    // Override with ZNYX_TELEMETRY_URL (or ZNYX_HEARTBEAT_URL), or opt out with
    // ZNYX_TELEMETRY=false.
    private static final String ENDPOINT = resolveEndpoint();
    private static final Path STATE_FILE =
            Path.of(System.getProperty("user.home", "."), ".znyx", "sdk-state-java.json");
    private static final long HEARTBEAT_INTERVAL_SECONDS = 86_400L; // 24h
    private static final String SOURCE = "java-sdk";

    private static final String DISCLOSURE =
            "[znyx-sdk] Anonymous usage telemetry is on (install id, SDK version, OS - "
                    + "no PII, no request content). Opt out with ZNYX_TELEMETRY=false.";

    // Only attempt once per process, no matter how many clients are constructed.
    private static volatile boolean attempted = false;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private Telemetry() {}

    /**
     * Where install pings go.
     *
     * Defaults to the ZNYX receiver. ZNYX_TELEMETRY_URL (or ZNYX_HEARTBEAT_URL) overrides it.
     * An EMPTY value removes the destination, which is distinct from leaving it unset: with
     * no destination nothing is sent even though this SDK is opt-out, giving an air-gapped
     * deployment a verifiable guarantee (the ENDPOINT.isEmpty() guard at the send site).
     *
     * The first variable that is SET wins, empty or not. Testing isEmpty() while walking the
     * chain would fall through to the default and defeat the point.
     */
    private static String resolveEndpoint() {
        for (String name : new String[] {"ZNYX_TELEMETRY_URL", "ZNYX_HEARTBEAT_URL"}) {
            String value = System.getenv(name);
            if (value != null) {
                return value.trim();
            }
        }
        return "https://cp.znyx.ai/v1/install-telemetry";
    }

    private static boolean enabled() {
        String val = System.getenv("ZNYX_TELEMETRY");
        if (val == null || val.isEmpty()) {
            val = System.getenv("GUARDRAILS_TELEMETRY");
        }
        if (val == null || val.isEmpty()) {
            val = "true";
        }
        val = val.toLowerCase();
        return !val.equals("false") && !val.equals("0") && !val.equals("no");
    }

    private static String sdkVersion() {
        try {
            String v = Telemetry.class.getPackage().getImplementationVersion();
            return (v == null || v.isEmpty()) ? "unknown" : v;
        } catch (Exception e) {
            return "unknown";
        }
    }

    /** Send an anonymous install ping, throttled to once per 24h. Fire-and-forget. */
    static synchronized void maybeSendInstallPing() {
        if (attempted) {
            return;
        }
        attempted = true;

        try {
            if (ENDPOINT.isEmpty() || !enabled()) {
                return;
            }

            Map<String, Object> state = loadState();
            Object lastPing = state.get("last_ping_at");

            String eventType;
            if (lastPing == null) {
                eventType = "first_run";
            } else {
                long elapsed;
                try {
                    elapsed = Duration.between(
                            parseInstant(lastPing.toString()), Instant.now()).getSeconds();
                } catch (Exception e) {
                    elapsed = HEARTBEAT_INTERVAL_SECONDS; // unparseable -> treat as due
                }
                if (elapsed < HEARTBEAT_INTERVAL_SECONDS) {
                    return; // throttled
                }
                eventType = "heartbeat";
            }

            String installId = state.get("install_id") != null
                    ? state.get("install_id").toString()
                    : UUID.randomUUID().toString();
            long runCount = toLong(state.get("run_count")) + 1;
            String nowIso = Instant.now().toString();

            state.put("install_id", installId);
            state.putIfAbsent("first_seen_at", nowIso);
            state.put("last_ping_at", nowIso);
            state.put("run_count", runCount);
            saveState(state);

            if (eventType.equals("first_run")) {
                try {
                    System.err.println(DISCLOSURE);
                } catch (Exception ignored) {
                    // ignore
                }
            }

            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("install_id", installId);
            payload.put("version", sdkVersion());
            payload.put("event_type", eventType);
            payload.put("source", SOURCE);
            payload.put("os", System.getProperty("os.name", "unknown"));
            payload.put("os_version", System.getProperty("os.version", "unknown"));
            payload.put("arch", System.getProperty("os.arch", "unknown"));
            // The receiver stores every SDK's language runtime version in its
            // python_version field; "source" says which runtime this really is.
            payload.put("python_version", System.getProperty("java.version", "unknown"));
            payload.put("run_count", runCount);
            payload.put("timestamp", nowIso);

            String json = MAPPER.writeValueAsString(payload);
            Thread t = new Thread(() -> post(json), "znyx-telemetry");
            t.setDaemon(true);
            t.start();
        } catch (Exception e) {
            // Telemetry must never break client construction.
        }
    }

    private static void post(String json) {
        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(3))
                    .build();
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(ENDPOINT))
                    .timeout(Duration.ofSeconds(3))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
            client.send(req, HttpResponse.BodyHandlers.discarding());
        } catch (Exception e) {
            // never fail the app because of telemetry
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> loadState() {
        try {
            if (Files.exists(STATE_FILE)) {
                return MAPPER.readValue(Files.readAllBytes(STATE_FILE), Map.class);
            }
        } catch (Exception e) {
            // fall through to empty state
        }
        return new LinkedHashMap<>();
    }

    private static void saveState(Map<String, Object> state) {
        try {
            Files.createDirectories(STATE_FILE.getParent());
            Files.write(STATE_FILE, MAPPER.writerWithDefaultPrettyPrinter().writeValueAsBytes(state));
        } catch (Exception e) {
            // best-effort; never raise
        }
    }

    /**
     * Parse an ISO-8601 timestamp leniently. {@link Instant#parse} only accepts a
     * trailing 'Z'; fall back to {@link OffsetDateTime}, which also accepts an
     * explicit "+00:00" offset (seen in state files written by older releases).
     */
    private static Instant parseInstant(String s) {
        try {
            return OffsetDateTime.parse(s).toInstant();
        } catch (Exception e) {
            return Instant.parse(s);
        }
    }

    private static long toLong(Object o) {
        if (o instanceof Number) {
            return ((Number) o).longValue();
        }
        try {
            return o == null ? 0L : Long.parseLong(o.toString());
        } catch (NumberFormatException e) {
            return 0L;
        }
    }
}
