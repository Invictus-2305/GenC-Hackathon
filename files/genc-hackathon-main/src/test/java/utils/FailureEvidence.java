package utils;

import com.microsoft.playwright.Page;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Captures everything the AI Observer needs to tell a functional bug apart from a scripting bug,
 * BEFORE the browser context/page is closed:
 *
 *   - screenshot.png   full-page screenshot at the moment of failure
 *   - dom.html         the live DOM (page.content()) at the moment of failure — lets the AI check
 *                       whether the locators used in the Page Object still match what the app
 *                       actually rendered, vs. the app showing an error/validation message
 *   - failure.json      manifest tying it all together: which test, which assertion/exception,
 *                       current URL, and pointers to the screenshot/DOM/step log files
 *
 * Written into the same target/ai-observer/<testId>/ directory that {@link EvidenceLogger} has
 * been writing steps.log to throughout the test, so the AI Observer has one self-contained
 * folder of evidence per failure.
 */
public final class FailureEvidence {

    private FailureEvidence() {}

    public static void capture(Page page, String testId, String displayName, Throwable cause) {
        Path dir = EvidenceLogger.getCurrentDir();
        if (dir == null) {
            EvidenceLogger.log("Could not resolve evidence directory for " + testId + " — skipping evidence capture.");
            return;
        }

        String url = "(unknown)";
        try {
            url = page.url();
        } catch (Exception ignored) {
            // page may already be in a bad state
        }

        String screenshotFile = null;
        try {
            byte[] png = page.screenshot(new Page.ScreenshotOptions().setFullPage(true));
            Files.write(dir.resolve("screenshot.png"), png);
            screenshotFile = "screenshot.png";
            EvidenceLogger.log("Captured failure screenshot -> screenshot.png");
        } catch (Exception e) {
            EvidenceLogger.log("Could not capture screenshot: " + e.getMessage());
        }

        String domFile = null;
        try {
            String html = page.content();
            Files.writeString(dir.resolve("dom.html"), html, StandardCharsets.UTF_8);
            domFile = "dom.html";
            EvidenceLogger.log("Captured DOM snapshot -> dom.html (" + html.length() + " chars)");
        } catch (Exception e) {
            EvidenceLogger.log("Could not capture DOM snapshot: " + e.getMessage());
        }

        writeManifest(dir, testId, displayName, url, cause, screenshotFile, domFile);
    }

    private static void writeManifest(Path dir, String testId, String displayName, String url,
                                       Throwable cause, String screenshotFile, String domFile) {
        String exceptionType = cause != null ? cause.getClass().getName() : "(none)";
        String exceptionMessage = cause != null ? String.valueOf(cause.getMessage()) : "";
        String stackTrace = cause != null ? formatStackTrace(cause) : "";

        StringBuilder json = new StringBuilder();
        json.append("{\n");
        json.append("  \"testId\": ").append(quote(testId)).append(",\n");
        json.append("  \"displayName\": ").append(quote(displayName)).append(",\n");
        json.append("  \"timestamp\": ").append(quote(Instant.now().toString())).append(",\n");
        json.append("  \"url\": ").append(quote(url)).append(",\n");
        json.append("  \"exceptionType\": ").append(quote(exceptionType)).append(",\n");
        json.append("  \"exceptionMessage\": ").append(quote(exceptionMessage)).append(",\n");
        json.append("  \"stackTrace\": ").append(quote(stackTrace)).append(",\n");
        json.append("  \"screenshotFile\": ").append(screenshotFile == null ? "null" : quote(screenshotFile)).append(",\n");
        json.append("  \"domFile\": ").append(domFile == null ? "null" : quote(domFile)).append(",\n");
        json.append("  \"stepLogFile\": \"steps.log\"\n");
        json.append("}\n");

        try {
            Files.writeString(dir.resolve("failure.json"), json.toString(), StandardCharsets.UTF_8);
            EvidenceLogger.log("Wrote failure manifest -> failure.json");
        } catch (IOException e) {
            throw new UncheckedIOException("Could not write failure.json for " + testId, e);
        }
    }

    private static String formatStackTrace(Throwable t) {
        List<String> lines = new ArrayList<>();
        lines.add(t.toString());
        for (StackTraceElement el : t.getStackTrace()) {
            lines.add("  at " + el.toString());
            if (lines.size() > 40) { // keep the manifest readable — full trace is still in the mvn log
                lines.add("  ... (truncated)");
                break;
            }
        }
        return String.join("\n", lines);
    }

    private static String quote(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append("\"");
        return sb.toString();
    }
}
