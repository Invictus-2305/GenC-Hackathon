package pages;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import io.qameta.allure.Step;

import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;

public class DashboardPage {

    private final Page page;

    public DashboardPage(Page page) {
        this.page = page;
    }

    @Step("Expect dashboard widgets to be visible")
    public void expectWidgetsVisible() {
        assertThat(page.getByText("Time at Work")).isVisible();
        assertThat(page.getByText("My Actions")).isVisible();
    }

    @Step("Logout")
    public void logout() {
        Locator userDropdown = page.locator(".oxd-userdropdown-tab");
        userDropdown.click();
        page.getByRole(AriaRole.MENUITEM, new Page.GetByRoleOptions().setName("Logout")).click();
    }

    @Step("Expect user is logged out (back on login screen)")
    public void expectLoggedOut() {
        assertThat(page.getByPlaceholder("Username")).isVisible(
                new com.microsoft.playwright.assertions.LocatorAssertions.IsVisibleOptions().setTimeout(15000));
    }
}