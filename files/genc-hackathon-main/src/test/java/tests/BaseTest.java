package tests;

import com.microsoft.playwright.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.*;
import utils.EvidenceLogger;
import utils.FailureEvidence;
import utils.ScreenshotUtils;

import java.nio.file.Paths;
import java.util.Optional;

@ExtendWith(BaseTest.FailureWatcher.class)
public class BaseTest {

    protected static final String BASE_URL =
            System.getProperty("baseUrl", "https://opensource-demo.orangehrmlive.com");

    static Playwright playwright;
    static Browser browser;

    BrowserContext context;
    protected Page page;

    @BeforeAll
    static void launchBrowser() {
        playwright = Playwright.create();
        boolean headless = !"true".equals(System.getProperty("headed"));
        browser = playwright.chromium().launch(
                new BrowserType.LaunchOptions().setHeadless(headless).setSlowMo(0));
    }

    @AfterAll
    static void closeBrowser() {
        browser.close();
        playwright.close();
    }

    @BeforeEach
    void createContextAndPage(TestInfo testInfo) {
        // Start collecting evidence (steps.log) for this test before anything else happens,
        // so the AI Observer has a full trail to work with if this test ends up failing.
        String testId = testId(testInfo);
        EvidenceLogger.startTest(testId);

        context = browser.newContext(new Browser.NewContextOptions()
                .setBaseURL(BASE_URL)
                .setViewportSize(1366, 768));
        // This demo server can be slow — raise the default timeouts so we don't have to
        // set them individually on every assertion/action.
        context.setDefaultTimeout(30000);
        context.setDefaultNavigationTimeout(30000);
        context.tracing().start(new Tracing.StartOptions()
                .setScreenshots(true).setSnapshots(true).setSources(true));
        page = context.newPage();

        // Mirror browser-side signals into the same evidence log. 
        page.onConsoleMessage(msg -> {
            if ("error".equals(msg.type()) || "warning".equals(msg.type())) {
                EvidenceLogger.log("[browser console." + msg.type() + "] " + msg.text());
            }
        });
        page.onPageError(error -> EvidenceLogger.log("[browser uncaught JS error] " + error));
        page.onRequestFailed(req -> EvidenceLogger.log(
                "[network request failed] " + req.method() + " " + req.url() + " -> " + req.failure()));
        page.onResponse(res -> {
            if (res.status() >= 400) {
                EvidenceLogger.log("[http " + res.status() + "] " + res.request().method() + " " + res.url());
            }
        });
    }

    @AfterEach
    void closeContext(TestInfo testInfo) {
        try {
            context.tracing().stop(new Tracing.StopOptions()
                    .setPath(Paths.get("target/traces/",
                            testInfo.getDisplayName().replaceAll("[^a-zA-Z0-9]", "_") + ".zip")));
        } finally {
            context.close();
            EvidenceLogger.endTest();
        }
    }

    static String testId(TestInfo testInfo) {
        String className = testInfo.getTestClass().map(Class::getSimpleName).orElse("UnknownClass");
        String methodName = testInfo.getTestMethod().map(m -> m.getName()).orElse(testInfo.getDisplayName());
        return className + "." + methodName;
    }

    /**
     * JUnit5 extension that captures failure evidence — screenshot, DOM snapshot, and the
     * step-by-step log — the moment a test fails, before the page/context closes. 
     */
    static class FailureWatcher implements AfterTestExecutionCallback {
        
        @Override
        public void afterTestExecution(ExtensionContext context) {
            // Check if the test threw an exception (meaning it failed)
            Optional<Throwable> exception = context.getExecutionException();
            
            if (exception.isPresent()) {
                Throwable cause = exception.get();
                Object testInstance = context.getRequiredTestInstance();
                
                if (testInstance instanceof BaseTest base && base.page != null) {
                    String testId = context.getTestClass().map(Class::getSimpleName).orElse("UnknownClass")
                            + "." + context.getTestMethod().map(java.lang.reflect.Method::getName)
                                    .orElse(context.getDisplayName());
                    
                    EvidenceLogger.log("TEST FAILED: " + cause);
                    
                    try {
                        ScreenshotUtils.attachScreenshot(base.page, "Failure screenshot");
                    } catch (Exception ignored) {
                        // Page may already be closed/unusable
                    }
                    
                    try {
                        FailureEvidence.capture(base.page, testId, context.getDisplayName(), cause);
                    } catch (Exception e) {
                        EvidenceLogger.log("Could not capture full failure evidence: " + e.getMessage());
                    }
                    
                    // Keep the evidence directory around so the AI Observer picks it up.
                    EvidenceLogger.markFailed();
                }
            }
        }
    }
}