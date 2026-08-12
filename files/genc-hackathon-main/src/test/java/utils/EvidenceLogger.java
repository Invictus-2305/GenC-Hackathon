package utils;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.format.DateTimeFormatter;

/**
 * Writes a running, timestamped log of everything that happens during a single test
 * (steps, browser console messages, failed network requests, HTTP error responses) to
 * target/ai-observer/<testId>/steps.log.
 *
 * The goal is simple: when the AI Observer is invoked after a failure, it should have a
 * plain-English trail of "what happened and when" instead of having to reconstruct it from
 * a stack trace alone. Every test gets its own directory for the duration of the run; if the
 * test passes, the directory is deleted during cleanup so only failures leave evidence behind.
 *
 * One test runs at a time in this project (no parallel execution is configured), so a simple
 * ThreadLocal is enough to track "the test currently running on this thread" without having to
 * thread a logger instance through every Page Object.
 */
public final class EvidenceLogger {

    private static final DateTimeFormatter TS = DateTimeFormatter.ISO_INSTANT;
    private static final Path ROOT = Paths.get("target", "ai-observer");

    private static final ThreadLocal<State> CURRENT = new ThreadLocal<>();

    private EvidenceLogger() {}

    private static final class State {
        final String testId;
        final Path dir;
        final PrintWriter writer;
        boolean keep = false; // set true on failure so cleanup() doesn't delete the evidence

        State(String testId, Path dir, PrintWriter writer) {
            this.testId = testId;
            this.dir = dir;
            this.writer = writer;
        }
    }

    /**
     * Call from @BeforeEach. Creates (fresh) target/ai-observer/<testId>/ and opens steps.log.
     */
    public static synchronized void startTest(String testId) {
        try {
            Path dir = ROOT.resolve(sanitize(testId));
            if (Files.exists(dir)) {
                deleteRecursively(dir);
            }
            Files.createDirectories(dir);
            PrintWriter writer = new PrintWriter(Files.newBufferedWriter(dir.resolve("steps.log")), true);
            CURRENT.set(new State(testId, dir, writer));
            log("== TEST START: " + testId + " ==");
        } catch (IOException e) {
            throw new UncheckedIOException("Could not set up evidence directory for " + testId, e);
        }
    }

    /** Appends a timestamped line to the current test's steps.log (and stdout). */
    public static void log(String message) {
        State state = CURRENT.get();
        String line = "[" + TS.format(Instant.now()) + "] " + message;
        if (state != null) {
            state.writer.println(line);
        } else {
            // No active test context (e.g. logging happened outside a test lifecycle) —
            // still surface it on stdout rather than silently dropping it.
            System.out.println("[EvidenceLogger:no-test] " + line);
        }
    }

    /** Directory evidence for the current test should be written into (screenshot, DOM, manifest). */
    public static Path getCurrentDir() {
        State state = CURRENT.get();
        return state != null ? state.dir : null;
    }

    /** Marks the current test's evidence directory to be kept (not deleted) after the test ends. */
    public static void markFailed() {
        State state = CURRENT.get();
        if (state != null) state.keep = true;
    }

    /**
     * Call from @AfterEach (after the browser context is closed). Closes the log file and,
     * unless the test was marked failed, deletes the evidence directory so only genuine
     * failures accumulate on disk.
     */
    public static synchronized void endTest() {
        State state = CURRENT.get();
        if (state == null) return;
        try {
            log("== TEST END (" + (state.keep ? "FAILED - evidence kept" : "PASSED - evidence discarded") + ") ==");
            state.writer.close();
            if (!state.keep) {
                deleteRecursively(state.dir);
            }
        } finally {
            CURRENT.remove();
        }
    }

    private static String sanitize(String testId) {
        return testId.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private static void deleteRecursively(Path dir) {
        try {
            if (!Files.exists(dir)) return;
            try (var stream = Files.walk(dir)) {
                stream.sorted((a, b) -> b.getNameCount() - a.getNameCount())
                        .forEach(p -> {
                            try {
                                Files.deleteIfExists(p);
                            } catch (IOException ignored) {
                                // best-effort cleanup
                            }
                        });
            }
        } catch (IOException ignored) {
            // best-effort cleanup
        }
    }
}
