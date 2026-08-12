package utils;

import com.microsoft.playwright.Page;
import io.qameta.allure.Allure;

public class ScreenshotUtils {

    private ScreenshotUtils() {}

    /**
     * Takes a full-page screenshot and attaches it to the current Allure test result.
     */
    public static void attachScreenshot(Page page, String name) {
        byte[] png = page.screenshot(new Page.ScreenshotOptions().setFullPage(true));
        Allure.getLifecycle().addAttachment(name, "image/png", "png",
                new java.io.ByteArrayInputStream(png));
    }
}
