package pages;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.microsoft.playwright.assertions.LocatorAssertions;
import io.qameta.allure.Step;

import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;

public class PimPage {

    private final Page page;

    public PimPage(Page page) {
        this.page = page;
    }

    @Step("Navigate to PIM > Add Employee")
    public void goToAddEmployee() {
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("PIM")).click();
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("Add Employee")).click();
        assertThat(page.getByRole(AriaRole.HEADING, new Page.GetByRoleOptions().setName("Add Employee")))
                .isVisible(new LocatorAssertions.IsVisibleOptions().setTimeout(30000));
    }

    @Step("Add employee: {firstName} {lastName}")
    public void addEmployee(String firstName, String lastName) {
        page.locator("input[name='firstName']").fill(firstName);
        page.locator("input[name='lastName']").fill(lastName);
        page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Save")).click();

        // Wait for the save/redirect loader to disappear first — clicking through it
        // repeatedly (as we saw on the Leave page) wastes the whole timeout budget.
        try {
            page.locator(".oxd-form-loader").waitFor(new Locator.WaitForOptions()
                    .setState(com.microsoft.playwright.options.WaitForSelectorState.HIDDEN)
                    .setTimeout(20000));
        } catch (com.microsoft.playwright.TimeoutError ignored) {
            // Loader may not appear at all on some runs — that's fine, keep going.
        }

        // If a validation error appears instead of redirecting, fail with a clear message
        // rather than a generic "locator not visible" timeout.
        Locator validationError = page.locator(".oxd-input-field-error-message").first();
        if (validationError.isVisible()) {
            throw new AssertionError("Add Employee form validation error: " + validationError.textContent());
        }

        assertThat(page.getByRole(AriaRole.HEADING, new Page.GetByRoleOptions().setName("Personal Details")))
                .isVisible(new LocatorAssertions.IsVisibleOptions().setTimeout(30000));
    }

    @Step("Search employee: {name}")
    public void searchEmployee(String name) {
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("PIM")).click();
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("Employee List")).click();

        var nameInput = page.getByPlaceholder("Type for hints...").first();
        nameInput.fill(name);

        // Wait for the autocomplete dropdown option to appear, then click it
        var suggestion = page.locator(".oxd-autocomplete-dropdown .oxd-autocomplete-option").first();
        suggestion.waitFor(new Locator.WaitForOptions().setTimeout(10000));
        suggestion.click();

        page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Search")).click();
    }

    @Step("Expect employee '{fullName}' present in list")
    public void expectEmployeeInList(String fullName) {
        assertThat(page.locator(".oxd-table-card", new Page.LocatorOptions().setHasText(fullName)))
                .isVisible(new LocatorAssertions.IsVisibleOptions().setTimeout(20000));
    }
}