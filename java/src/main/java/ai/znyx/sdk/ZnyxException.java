package ai.znyx.sdk;

public class ZnyxException extends RuntimeException {

    private final int statusCode;

    public ZnyxException(String message) {
        super(message);
        this.statusCode = 0;
    }

    public ZnyxException(String message, int statusCode) {
        super(message);
        this.statusCode = statusCode;
    }

    public ZnyxException(String message, Throwable cause) {
        super(message, cause);
        this.statusCode = 0;
    }

    /** HTTP status code from the runtime, or 0 if the error was not HTTP. */
    public int getStatusCode() {
        return statusCode;
    }
}
