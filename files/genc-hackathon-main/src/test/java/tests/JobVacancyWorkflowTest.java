package tests;

import io.qameta.allure.*;
import org.junit.jupiter.api.Test;

import pages.DashboardPage;
import pages.LoginPage;
import pages.RecruitmentPage;

@Epic("OrangeHRM")
@Feature("Recruitment")
public class JobVacancyWorkflowTest extends BaseTest {

    private static final String VALID_USERNAME = "Admin";
    private static final String VALID_PASSWORD = "admin123";

    @Test
    @Story("Post a job vacancy")
    @Severity(SeverityLevel.CRITICAL)
    @Description("Single continuous flow: login -> create a new job vacancy -> verify it "
            + "appears in the vacancy list -> logout.")
    void postJobVacancyFlow() {
        LoginPage login = new LoginPage(page);
        DashboardPage dashboard = new DashboardPage(page);
        RecruitmentPage recruitment = new RecruitmentPage(page);

        String uniqueSuffix = String.valueOf(System.currentTimeMillis() % 1_000_000);
        String vacancyName = "QA Engineer " + uniqueSuffix;

        // 1. Login
        login.goTo();
        login.login(VALID_USERNAME, VALID_PASSWORD);
        login.expectLoggedIn();
        dashboard.expectWidgetsVisible();

        // 2. Create the vacancy
        recruitment.goToAddVacancy();
        recruitment.addVacancy(vacancyName, "Admin", "2");

        // 3. Verify it shows up in the vacancy list
        recruitment.expectVacancyInList(vacancyName);

        // 4. Logout
        dashboard.logout();
        dashboard.expectLoggedOut();
    }
}