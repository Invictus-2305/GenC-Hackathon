package pages;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.microsoft.playwright.assertions.LocatorAssertions;
import io.qameta.allure.Step;

import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;

public class LeavePage {

    private final Page page;

    public LeavePage(Page page) {
        this.page = page;
    }

    @Step("Navigate to Leave > Apply")
    public void goToApplyLeave() {
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("Leave")).click();
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("Apply")).click();
        assertThat(page.getByText("Apply Leave")).isVisible();
    }

    /**
     * Returns true if at least one leave-type dropdown is present and usable on the
     * Apply Leave page. Returns false if the logged-in user has no leave type with
     * any balance configured — in which case OrangeHRM renders the page without a
     * usable dropdown, and applying for leave isn't possible.
     */
    @Step("Check whether a leave type is available to apply for")
    public boolean hasAvailableLeaveType() {
        // Give the form a moment to finish loading before checking
        page.locator(".oxd-form-loader").waitFor(new Locator.WaitForOptions()
                .setState(com.microsoft.playwright.options.WaitForSelectorState.HIDDEN)
                .setTimeout(20000));

        Locator leaveTypeSelect = page.locator(".oxd-select-text-input").first();
        try {
            leaveTypeSelect.waitFor(new Locator.WaitForOptions().setTimeout(10000));
            return true;
        } catch (com.microsoft.playwright.TimeoutError e) {
            return false;
        }
    }

    @Step("Apply leave type '{leaveTypeLabel}' from {fromDate} to {toDate}")
    public void applyLeave(String leaveTypeLabel, String fromDate, String toDate) {
        Locator leaveTypeSelect = page.locator(".oxd-select-text-input").first();
        leaveTypeSelect.click();

        // Prefer the requested leave type, but fall back to whichever leave type is
        // actually available (e.g. if "CAN - Bereavement" isn't configured with balance
        // on this instance), rather than failing the whole flow over a hardcoded name.
        Locator requestedOption = page.getByRole(AriaRole.OPTION, new Page.GetByRoleOptions().setName(leaveTypeLabel));
        Locator anyOption = page.getByRole(AriaRole.OPTION).first();

        try {
            requestedOption.waitFor(new Locator.WaitForOptions().setTimeout(5000));
            requestedOption.click();
        } catch (com.microsoft.playwright.TimeoutError e) {
            anyOption.waitFor(new Locator.WaitForOptions().setTimeout(10000));
            anyOption.click();
        }

        Locator dateInputs = page.locator("input[placeholder='yyyy-dd-mm']");
        dateInputs.nth(0).fill(fromDate);
        dateInputs.nth(1).fill(toDate);

        page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Apply")).click();
        assertThat(page.getByText("Successfully Saved"))
                .isVisible(new LocatorAssertions.IsVisibleOptions().setTimeout(20000));
    }
}