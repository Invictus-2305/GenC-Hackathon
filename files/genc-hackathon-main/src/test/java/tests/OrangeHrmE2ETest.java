package tests;

import io.qameta.allure.*;
import org.junit.jupiter.api.Test;

import pages.DashboardPage;
import pages.LeavePage;
import pages.LoginPage;
import pages.PimPage;

@Epic("OrangeHRM")
@Feature("End-to-end workflow")
public class OrangeHrmE2ETest extends BaseTest {

    private static final String VALID_USERNAME = "Admin";
    private static final String VALID_PASSWORD = "admin123";

    @Test
    @Story("Full user journey")
    @Severity(SeverityLevel.BLOCKER)
    @Description("Single continuous flow: login -> add employee -> verify employee in list "
            + "-> apply leave -> logout, all in one session.")
    void fullOrangeHrmFlow() {
        LoginPage login = new LoginPage(page);
        DashboardPage dashboard = new DashboardPage(page);
        PimPage pim = new PimPage(page);
        LeavePage leave = new LeavePage(page);

        String uniqueSuffix = String.valueOf(System.currentTimeMillis() % 1_000_000);
        String firstName = "QA";
        String lastName = "Tester" + uniqueSuffix;
        String fullName = firstName + " " + lastName;

        // 1. Login
        login.goTo();
        login.login(VALID_USERNAME, VALID_PASSWORD);
        login.expectLoggedIn();
        dashboard.expectWidgetsVisible();

        // 2. Add employee via PIM
        pim.goToAddEmployee();
        pim.addEmployee(firstName, lastName);

        // 3. Verify the employee appears in Employee List
        pim.searchEmployee(fullName);
        pim.expectEmployeeInList(fullName);

        // 4. Apply for leave (skip gracefully if no leave type has any balance configured)
        leave.goToApplyLeave();
        if (leave.hasAvailableLeaveType()) {
            leave.applyLeave("CAN - Bereavement", "2026-08-21", "2026-08-21");
        } else {
            System.out.println(">>> Skipping leave application: no leave type with available balance found.");
        }

        // 5. Logout
        dashboard.logout();
        dashboard.expectLoggedOut();
    }
}