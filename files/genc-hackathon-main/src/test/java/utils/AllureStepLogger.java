package utils;

import io.qameta.allure.listener.StepLifecycleListener;
import io.qameta.allure.model.Status;
import io.qameta.allure.model.StepResult;

/**
 * Every Page Object method in this project is already annotated with Allure's {@code @Step}
 * (e.g. "Login with username '{username}'", "Fill and save vacancy: ..."). Rather than adding
 * manual logging calls to every one of those methods, this listener taps into Allure's own step
 * lifecycle and mirrors each step's start/result into {@link EvidenceLogger}'s steps.log.
 *
 * This gives the AI Observer a plain-English, chronological trail of exactly what the test did
 * ("Navigate to PIM > Add Employee", "Add employee: QA Tester123" ...) right up to the moment of
 * failure, with no changes needed to LoginPage/PimPage/LeavePage/RecruitmentPage/DashboardPage.
 *
 * Registered via Java's ServiceLoader mechanism — see
 * src/test/resources/META-INF/services/io.qameta.allure.listener.StepLifecycleListener
 */
public class AllureStepLogger implements StepLifecycleListener {

    @Override
    public void afterStepStart(final StepResult result) {
        EvidenceLogger.log("STEP -> " + result.getName());
    }

    @Override
    public void afterStepStop(final StepResult result) {
        Status status = result.getStatus();
        String label = status == null ? "UNKNOWN" : status.name();
        if (status == Status.PASSED) {
            EvidenceLogger.log("STEP OK <- " + result.getName());
        } else {
            String detail = "";
            if (result.getStatusDetails() != null) {
                String msg = result.getStatusDetails().getMessage();
                if (msg != null && !msg.isBlank()) {
                    detail = " | " + msg.lines().findFirst().orElse(msg);
                }
            }
            EvidenceLogger.log("STEP " + label + " <- " + result.getName() + detail);
        }
    }
}
