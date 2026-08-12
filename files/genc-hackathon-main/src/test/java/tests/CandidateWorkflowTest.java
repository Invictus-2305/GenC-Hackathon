package tests;

import io.qameta.allure.*;
import org.junit.jupiter.api.Test;

import pages.DashboardPage;
import pages.LoginPage;
import pages.RecruitmentPage;

@Epic("OrangeHRM")
@Feature("Recruitment")
public class CandidateWorkflowTest extends BaseTest {

    private static final String VALID_USERNAME = "Admin";
    private static final String VALID_PASSWORD = "admin123";

    @Test
    @Story("Add a candidate")
    @Severity(SeverityLevel.CRITICAL)
    @Description("Single continuous flow: login -> add a new candidate -> verify the candidate "
            + "appears in the candidate list -> logout.")
    void addCandidateFlow() {
        LoginPage login = new LoginPage(page);
        DashboardPage dashboard = new DashboardPage(page);
        RecruitmentPage recruitment = new RecruitmentPage(page);

        String uniqueSuffix = String.valueOf(System.currentTimeMillis() % 1_000_000);
        String firstName = "Jordan";
        String lastName = "Candidate" + uniqueSuffix;
        String fullName = firstName + " " + lastName;
        String email = "jordan.candidate" + uniqueSuffix + "@example.com";

        // 1. Login
        login.goTo();
        login.login(VALID_USERNAME, VALID_PASSWORD);
        login.expectLoggedIn();
        dashboard.expectWidgetsVisible();

        // 2. Add the candidate
        recruitment.goToAddCandidate();
        recruitment.addCandidate(firstName, lastName, email);

        // 3. Verify the candidate shows up in the candidate list
        recruitment.expectCandidateInList(fullName);

        // 4. Logout
        dashboard.logout();
        dashboard.expectLoggedOut();
    }
}