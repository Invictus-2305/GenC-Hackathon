package pages;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.assertions.LocatorAssertions;
import com.microsoft.playwright.options.AriaRole;
import com.microsoft.playwright.options.WaitForSelectorState;
import io.qameta.allure.Step;

import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;

public class RecruitmentPage {

    private final Page page;

    public RecruitmentPage(Page page) {
        this.page = page;
    }

    private void waitForLoaderToDisappear() {
        try {
            page.locator(".oxd-form-loader").waitFor(new Locator.WaitForOptions()
                    .setState(WaitForSelectorState.HIDDEN)
                    .setTimeout(20000));
        } catch (com.microsoft.playwright.TimeoutError ignored) {
            // Loader may not appear on every run — fine either way.
        }
    }

    // ---------- Job Vacancy ----------

    @Step("Navigate to Recruitment > Vacancies > Add")
    public void goToAddVacancy() {
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("Recruitment")).click();
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("Vacancies")).click();
        page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Add")).click();
        assertThat(page.getByRole(AriaRole.HEADING, new Page.GetByRoleOptions().setName("Add Vacancy")))
                .isVisible(new LocatorAssertions.IsVisibleOptions().setTimeout(30000));
    }

    private Locator inputInGroupLabeled(String labelPattern) {
        return page.locator(".oxd-input-group", new Page.LocatorOptions()
                        .setHasText(java.util.regex.Pattern.compile(labelPattern, java.util.regex.Pattern.CASE_INSENSITIVE)))
                .locator("input")
                .first();
    }

    @Step("Fill and save vacancy: {vacancyName}, hiring manager '{hiringManager}', positions {numPositions}")
    public void addVacancy(String vacancyName, String hiringManager, String numPositions) {
        // Vacancy name — locate by label, not ordinal position, since ordering
        // assumptions about which input comes "first" were wrong.
        Locator vacancyNameInput = inputInGroupLabeled("Vacancy Name");
        vacancyNameInput.waitFor(new Locator.WaitForOptions().setTimeout(10000));
        vacancyNameInput.fill(vacancyName);

        // Job title dropdown — locate the select specifically inside the "Job Title" group.
        Locator jobTitleGroup = page.locator(".oxd-input-group", new Page.LocatorOptions()
                .setHasText(java.util.regex.Pattern.compile("Job Title", java.util.regex.Pattern.CASE_INSENSITIVE)));
        Locator jobTitleSelect = jobTitleGroup.locator(".oxd-select-text-input").first();
        jobTitleSelect.waitFor(new Locator.WaitForOptions().setTimeout(10000));
        jobTitleSelect.click();

        Locator jobTitleOptions = page.getByRole(AriaRole.OPTION);
        Locator firstRealOption = jobTitleOptions.filter(new Locator.FilterOptions()
                        .setHasNotText(java.util.regex.Pattern.compile("--\\s*Select\\s*--", java.util.regex.Pattern.CASE_INSENSITIVE)))
                .first();
        firstRealOption.waitFor(new Locator.WaitForOptions().setTimeout(10000));
        firstRealOption.click();

        // Hiring manager autocomplete — optional field. `fill()` sets the value directly
        // without firing real keystroke events, so the autocomplete's live-search never
        // triggers and no suggestion ever appears. Use pressSequentially() to simulate
        // actual typing instead, so the dropdown genuinely opens.
        Locator hiringManagerGroup = page.locator(".oxd-input-group", new Page.LocatorOptions()
                .setHasText(java.util.regex.Pattern.compile("Hiring Manager", java.util.regex.Pattern.CASE_INSENSITIVE)));
        Locator hiringManagerInput = hiringManagerGroup.getByPlaceholder("Type for hints...").first();
        hiringManagerInput.click();
        hiringManagerInput.pressSequentially(hiringManager, new Locator.PressSequentiallyOptions().setDelay(80));

        Locator suggestion = page.locator(".oxd-autocomplete-dropdown .oxd-autocomplete-option").first();
        try {
            suggestion.waitFor(new Locator.WaitForOptions().setTimeout(8000));
            suggestion.click();
        } catch (com.microsoft.playwright.TimeoutError e) {
            // No matching hiring manager suggestion — clear via keyboard (select-all + delete)
            // rather than fill(""), since fill() doesn't reliably reset this component's
            // internal validation state once it's been marked invalid.
            hiringManagerInput.click();
            hiringManagerInput.press("Control+A");
            hiringManagerInput.press("Delete");
            // Click elsewhere to force a blur, since some form components only
            // re-run validation on blur rather than on every keystroke.
            vacancyNameInput.click();
        }

        // Number of positions
        Locator positionsInput = inputInGroupLabeled("Position");
        positionsInput.waitFor(new Locator.WaitForOptions().setTimeout(10000));
        positionsInput.fill(numPositions);

        page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Save")).click();
        waitForLoaderToDisappear();

        Locator validationErrors = page.locator(".oxd-input-field-error-message");
        int errorCount = validationErrors.count();
        if (errorCount > 0) {
            StringBuilder sb = new StringBuilder("Add Vacancy form validation error(s):\n");
            for (int i = 0; i < errorCount; i++) {
                Locator error = validationErrors.nth(i);
                // Walk up to the containing form group to grab its label text, so we know
                // WHICH field failed, not just that something did.
                String groupText = "";
                try {
                    groupText = error.locator("xpath=ancestor::div[contains(@class,'oxd-input-group')][1]")
                            .first().innerText();
                } catch (Exception ignored) {
                    // If we can't resolve the group, we'll just show the error text alone.
                }
                sb.append("  [").append(i + 1).append("] ")
                  .append(groupText.isBlank() ? "(unknown field)" : groupText.replace("\n", " "))
                  .append(" -> ").append(error.textContent()).append("\n");
            }
            throw new AssertionError(sb.toString());
        }
    }

    @Step("Search vacancy '{vacancyName}' and expect it in the list")
    public void expectVacancyInList(String vacancyName) {
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("Recruitment")).click();
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("Vacancies")).click();

        page.locator("input.oxd-input").first().fill(vacancyName);
        page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Search")).click();
        waitForLoaderToDisappear();

        assertThat(page.locator(".oxd-table-card", new Page.LocatorOptions().setHasText(vacancyName)))
                .isVisible(new LocatorAssertions.IsVisibleOptions().setTimeout(20000));
    }

    // ---------- Candidate ----------

    @Step("Navigate to Recruitment > Candidates > Add")
    public void goToAddCandidate() {
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("Recruitment")).click();
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("Candidates")).click();
        page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Add")).click();
        assertThat(page.getByRole(AriaRole.HEADING, new Page.GetByRoleOptions().setName("Add Candidate")))
                .isVisible(new LocatorAssertions.IsVisibleOptions().setTimeout(30000));
    }

    @Step("Fill and save candidate: {firstName} {lastName}, email {email}")
    public void addCandidate(String firstName, String lastName, String email) {
        page.locator("input[name='firstName']").fill(firstName);
        page.locator("input[name='lastName']").fill(lastName);
        page.locator("input[name='email']").fill(email);

        page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Save")).click();
        waitForLoaderToDisappear();

        Locator validationError = page.locator(".oxd-input-field-error-message").first();
        if (validationError.isVisible()) {
            throw new AssertionError("Add Candidate form validation error: " + validationError.textContent());
        }

        // Successful save redirects to the candidate's detail view showing their name as a heading
        assertThat(page.getByRole(AriaRole.HEADING, new Page.GetByRoleOptions().setName(firstName + " " + lastName)))
                .isVisible(new LocatorAssertions.IsVisibleOptions().setTimeout(30000));
    }

    @Step("Search candidate '{fullName}' and expect it in the list")
    public void expectCandidateInList(String fullName) {
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("Recruitment")).click();
        page.getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName("Candidates")).click();

        page.locator("input.oxd-input").first().fill(fullName);
        page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Search")).click();
        waitForLoaderToDisappear();

        assertThat(page.locator(".oxd-table-card", new Page.LocatorOptions().setHasText(fullName)))
                .isVisible(new LocatorAssertions.IsVisibleOptions().setTimeout(20000));
    }
}