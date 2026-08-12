package pages;

import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import io.qameta.allure.Step;

import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;

public class LoginPage {

    private final Page page;

    public LoginPage(Page page) {
        this.page = page;
    }

    @Step("Navigate to login page")
    public void goTo() {
        page.navigate("/web/index.php/auth/login");
    }

    @Step("Login with username '{username}'")
    public void login(String username, String password) {
        page.getByPlaceholder("Username").fill(username);
        page.getByPlaceholder("Password").fill(password);
        page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Login")).click();
    }

    @Step("Expect invalid-credentials error")
    public void expectLoginError() {
        assertThat(page.getByText("Invalid credentials")).isVisible();
    }

    @Step("Expect user is logged in (Dashboard visible)")
    public void expectLoggedIn() {
        assertThat(page.getByRole(AriaRole.HEADING, new Page.GetByRoleOptions().setName("Dashboard")))
                .isVisible(new com.microsoft.playwright.assertions.LocatorAssertions.IsVisibleOptions().setTimeout(30000));
    }
}