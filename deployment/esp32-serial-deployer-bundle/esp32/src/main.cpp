/**
 * AetherGuard ESP32 自动化部署工具 - 主程序
 *
 * 当前交付基线:
 * - USB-TTL 本地串口部署
 * - 非阻塞状态机
 * - 真实 OLED 状态显示
 * - 显式串口标记协议
 *
 * Hardening changes:
 * - Task 9.1:  Button event queue (button_handler.h)
 * - Task 10.2: Physical confirmation gate — startInstall/startUninstall only
 *              called after OK button press in ST_CONFIRM_INSTALL/ST_CRITICAL_CONFIRM
 * - Task 10.3: Back-button rejection sends AG:ERR:INSTALL / AG:ERR:REMOVE on UART2
 * - Task 10.4: 60-second auto-cancel timeout for pending confirmations (Req 6.5)
 * - Task 11.1: OLED updated within same loop tick on confirmation state entry (Req 6.5)
 * - Task 11.2: 5-second result display hold in ST_SUCCESS / ST_ERROR (Req 6.6)
 * - Task 12.1: LED colour mapping aligned with Requirement 8.5 / 8.9
 */

#include <Arduino.h>
#include "config.h"
#include "display.h"
#include "button_handler.h"
#include "hardware_ctrl.h"
#include "deployment.h"

static Display display;
static MultiButtonHandler btns;
static HardwareCtrl hw;
static DeploymentModule deploy;

// Confirmation timeout: 60 seconds (Requirement 6.5)
static constexpr uint32_t CONFIRM_TIMEOUT_MS = 60000UL;

// Result display hold: 5 seconds (Requirement 6.6)
static constexpr uint32_t RESULT_HOLD_MS = 5000UL;

enum DeployState {
    ST_BOOT = 0,
    ST_CHECK_ENV,
    ST_MENU_SELECT,
    ST_BACKUP,
    ST_BACKUP_FAIL,
    ST_CONFIRM_INSTALL,
    ST_INSTALLING,
    ST_CRITICAL_CONFIRM,
    ST_UNINSTALLING,
    ST_SUCCESS,
    ST_ERROR
};

static DeployState state = ST_BOOT;
static DeployState errorReturnState = ST_MENU_SELECT;
static bool stateNeedsEntry = true;
static uint32_t stateEnteredAt = 0;
static bool uiDirty = true;
static bool isInstallMode = true;

static char envInfo[32] = "Detecting...";
static char statusTitle[24] = "Status";
static char statusDetail[48] = "";

void enterState(DeployState nextState);

void copyText(char* target, size_t targetSize, const char* source, const char* fallback = "") {
    if (!target || targetSize == 0) {
        return;
    }

    const char* value = source ? source : fallback;
    snprintf(target, targetSize, "%s", value ? value : "");
    target[targetSize - 1] = '\0';
}

void setStatusMessage(const char* title, const char* detail) {
    copyText(statusTitle, sizeof(statusTitle), title, "Status");
    copyText(statusDetail, sizeof(statusDetail), detail, "");
}

void enterErrorState(const char* title, const char* detail, DeployState retryState) {
    setStatusMessage(title, detail);
    errorReturnState = retryState;
    enterState(ST_ERROR);
}

void updateEnvInfo() {
    switch (deploy.getHostEnvironment()) {
        case HOST_LINUX:
            copyText(envInfo, sizeof(envInfo), "Linux Host Ready");
            break;
        case HOST_WINDOWS:
            copyText(envInfo, sizeof(envInfo), "Windows Detected");
            break;
        case HOST_UNKNOWN:
        default:
            copyText(envInfo, sizeof(envInfo), "Unknown Host");
            break;
    }
}

void enterState(DeployState nextState) {
    state = nextState;
    stateNeedsEntry = true;
    stateEnteredAt = millis();
    uiDirty = true;
    DEBUG_PRINTF("[State] -> %d\n", static_cast<int>(state));
}

// ---------------------------------------------------------------------------
// renderUi() — forward declaration (needed by handleStateEntry for task 11.1)
// ---------------------------------------------------------------------------
void renderUi();

void handleStateEntry() {
    if (!stateNeedsEntry) {
        return;
    }

    stateNeedsEntry = false;

    switch (state) {
        case ST_BOOT:
            isInstallMode = true;
            errorReturnState = ST_MENU_SELECT;
            copyText(envInfo, sizeof(envInfo), "Detecting...");
            setStatusMessage("Status", "");
            // Idle state: white during boot splash
            hw.setColor(COLOR_WHITE);
            break;

        case ST_CHECK_ENV:
            hw.setBlink(COLOR_BLUE, COLOR_OFF, 250);
            if (!deploy.startEnvironmentCheck()) {
                enterErrorState("Env Busy", deploy.getLastMessage(), ST_CHECK_ENV);
            }
            break;

        case ST_MENU_SELECT:
            // Idle → blue (Requirement 8.9)
            hw.setColor(COLOR_BLUE);
            break;

        case ST_BACKUP:
            // Operation in progress → BUSY (magenta) (Requirement 8.9)
            hw.setBlink(COLOR_PURPLE, COLOR_OFF, 220);
            if (!deploy.startBackup()) {
                setStatusMessage("Backup Failed", deploy.getLastMessage());
                enterState(ST_BACKUP_FAIL);
            }
            break;

        case ST_BACKUP_FAIL:
            // Operation failed → ERROR (red) (Requirement 8.9)
            hw.setColor(COLOR_RED);
            hw.playError();
            break;

        case ST_CONFIRM_INSTALL:
            // Awaiting confirmation → PENDING (yellow, blink 500/500ms) (Requirement 8.9)
            hw.setBlink(COLOR_YELLOW, COLOR_OFF, 500);
            // Task 11.1: Update OLED immediately (within same loop tick) — Requirement 6.5
            uiDirty = true;
            renderUi();
            break;

        case ST_INSTALLING:
            // Operation in progress → BUSY (magenta) (Requirement 8.9)
            hw.setBlink(COLOR_PURPLE, COLOR_OFF, 200);
            if (!deploy.startInstall()) {
                enterErrorState("Install Failed", deploy.getLastMessage(), ST_MENU_SELECT);
            }
            break;

        case ST_CRITICAL_CONFIRM:
            // Awaiting confirmation → PENDING (yellow, blink 500/500ms) (Requirement 8.9)
            hw.setBlink(COLOR_YELLOW, COLOR_OFF, 500);
            hw.playWarning();
            // Task 11.1: Update OLED immediately (within same loop tick) — Requirement 6.5
            uiDirty = true;
            renderUi();
            break;

        case ST_UNINSTALLING:
            // Operation in progress → BUSY (magenta) (Requirement 8.9)
            hw.setBlink(COLOR_PURPLE, COLOR_OFF, 200);
            if (!deploy.startUninstall()) {
                enterErrorState("Remove Failed", deploy.getLastMessage(), ST_MENU_SELECT);
            }
            break;

        case ST_SUCCESS:
            // Operation succeeded → OK (green, 3s solid) (Requirement 8.9)
            hw.setColor(COLOR_GREEN);
            hw.playSuccess();
            break;

        case ST_ERROR:
            // Operation failed/rejected → ERROR (red, 3s solid) (Requirement 8.9)
            hw.setColor(COLOR_RED);
            hw.playError();
            break;
    }
}

void handleDeployResults() {
    CmdStatus result;
    if (!deploy.consumeResult(result)) {
        return;
    }

    switch (state) {
        case ST_CHECK_ENV:
            if (result == CMD_SUCCESS) {
                updateEnvInfo();
                enterState(ST_MENU_SELECT);
            } else {
                enterErrorState("Env Detect Fail", deploy.getLastMessage(), ST_CHECK_ENV);
            }
            break;

        case ST_BACKUP:
            if (result == CMD_SUCCESS) {
                if (isInstallMode) {
                    enterState(ST_CONFIRM_INSTALL);
                } else {
                    enterState(ST_CRITICAL_CONFIRM);
                }
            } else {
                setStatusMessage("Backup Failed", deploy.getLastMessage());
                enterState(ST_BACKUP_FAIL);
            }
            break;

        case ST_INSTALLING:
            if (result == CMD_SUCCESS) {
                enterState(ST_SUCCESS);
            } else {
                enterErrorState("Install Failed", deploy.getLastMessage(), ST_MENU_SELECT);
            }
            break;

        case ST_UNINSTALLING:
            if (result == CMD_SUCCESS) {
                enterState(ST_SUCCESS);
            } else {
                enterErrorState("Remove Failed", deploy.getLastMessage(), ST_MENU_SELECT);
            }
            break;

        default:
            break;
    }
}

void renderUi() {
    static int lastRenderedState = -1;
    static int lastProgress = -1;
    static bool lastInstallMode = false;
    static uint8_t lastSpinner = 0xFF;
    static char lastDetail[48] = "";
    static char lastMenuEnv[32] = "";

    const char spinnerChars[] = {'|', '/', '-', '\\'};
    uint8_t spinner = (millis() / UI_SPINNER_INTERVAL_MS) % 4;
    const char* liveDetail = deploy.getLastMessage();
    int liveProgress = deploy.getProgress();

    bool needsRedraw = uiDirty || lastRenderedState != static_cast<int>(state);

    if (state == ST_MENU_SELECT) {
        if (lastInstallMode != isInstallMode || strcmp(lastMenuEnv, envInfo) != 0) {
            needsRedraw = true;
        }
    } else if (state == ST_CHECK_ENV || state == ST_BACKUP || state == ST_INSTALLING || state == ST_UNINSTALLING) {
        if (lastProgress != liveProgress || lastSpinner != spinner || strcmp(lastDetail, liveDetail) != 0) {
            needsRedraw = true;
        }
    }

    if (!needsRedraw) {
        return;
    }

    lastRenderedState = static_cast<int>(state);
    lastProgress = liveProgress;
    lastInstallMode = isInstallMode;
    lastSpinner = spinner;
    copyText(lastDetail, sizeof(lastDetail), liveDetail, "");
    copyText(lastMenuEnv, sizeof(lastMenuEnv), envInfo, "");

    char title[24];
    switch (state) {
        case ST_BOOT:
            display.showLines("AetherGuard", "Serial Deployer", "Preparing...", nullptr, false);
            break;

        case ST_CHECK_ENV:
            snprintf(title, sizeof(title), "Detect Host %c", spinnerChars[spinner]);
            display.showProgress(title, deploy.getLastMessage(), max(deploy.getProgress(), 5));
            break;

        case ST_MENU_SELECT:
            display.showMenu(envInfo, isInstallMode);
            break;

        case ST_BACKUP:
            snprintf(title, sizeof(title), "Backup %c", spinnerChars[spinner]);
            display.showProgress(title, deploy.getLastMessage(), max(deploy.getProgress(), 5));
            break;

        case ST_BACKUP_FAIL:
            display.showError("Backup Failed", statusDetail, "[Back]/[OK] Retry");
            break;

        case ST_CONFIRM_INSTALL:
            // Task 11.1: Show operation name and "CONFIRM?" text (Requirement 6.5)
            display.showPrompt("INSTALL", "CONFIRM?", "[OK] Yes [Back] No");
            break;

        case ST_INSTALLING:
            snprintf(title, sizeof(title), "Install %c", spinnerChars[spinner]);
            display.showProgress(title, deploy.getLastMessage(), max(deploy.getProgress(), 10));
            break;

        case ST_CRITICAL_CONFIRM:
            // Task 11.1: Show operation name and "CONFIRM?" text (Requirement 6.5)
            display.showLines("REMOVE", "CONFIRM?", "Press OK to confirm", "[Back] Cancel", false);
            break;

        case ST_UNINSTALLING:
            snprintf(title, sizeof(title), "Remove %c", spinnerChars[spinner]);
            display.showProgress(title, deploy.getLastMessage(), max(deploy.getProgress(), 10));
            break;

        case ST_SUCCESS:
            display.showSuccess(isInstallMode ? "Install completed" : "Remove completed");
            break;

        case ST_ERROR:
            display.showError(
                statusTitle,
                statusDetail,
                errorReturnState == ST_CHECK_ENV ? "[Back] Retry Detect" : "[Back] Retry"
            );
            break;
    }

    uiDirty = false;
}

void handleButtons(bool ok, bool next, bool back) {
    switch (state) {
        case ST_MENU_SELECT:
            if (next) {
                isInstallMode = !isInstallMode;
                uiDirty = true;
            }

            if (ok) {
                if (!deploy.supportsDeployment()) {
                    enterErrorState("Unsupported Host", "Deploy requires Linux host", ST_CHECK_ENV);
                } else {
                    enterState(ST_BACKUP);
                }
            }
            break;

        case ST_BACKUP_FAIL:
            if (back || ok) {
                enterState(ST_MENU_SELECT);
            }
            break;

        case ST_CONFIRM_INSTALL:
            if (ok) {
                // Task 10.2: Physical OK press received — now safe to call startInstall()
                // (Requirement 5.3, 5.8: AG:BEGIN:INSTALL only sent after physical OK)
                enterState(ST_INSTALLING);
            } else if (back) {
                // Task 10.3: Back rejection — send AG:ERR:INSTALL on UART2 (Requirement 5.6)
                deploy.sendErrInstall();
                enterState(ST_MENU_SELECT);
            }
            break;

        case ST_CRITICAL_CONFIRM:
            if (ok) {
                // Task 10.2: Physical OK press received — now safe to call startUninstall()
                // (Requirement 5.4, 5.8: AG:BEGIN:REMOVE only sent after physical OK)
                enterState(ST_UNINSTALLING);
            } else if (back) {
                // Task 10.3: Back rejection — send AG:ERR:REMOVE on UART2 (Requirement 5.5)
                deploy.sendErrRemove();
                enterState(ST_MENU_SELECT);
            }
            break;

        case ST_SUCCESS:
            // Task 11.2: Only accept button input after 5-second hold (Requirement 6.6)
            if ((ok || back) && millis() - stateEnteredAt >= RESULT_HOLD_MS) {
                enterState(ST_BOOT);
            }
            break;

        case ST_ERROR:
            // Task 11.2: Only accept button input after 5-second hold (Requirement 6.6)
            if (back && millis() - stateEnteredAt >= RESULT_HOLD_MS) {
                enterState(errorReturnState);
            }
            break;

        default:
            break;
    }
}

// ---------------------------------------------------------------------------
// Task 10.4: 60-second auto-cancel for pending confirmations (Requirement 6.5)
// ---------------------------------------------------------------------------
void checkConfirmationTimeout() {
    if (state != ST_CONFIRM_INSTALL && state != ST_CRITICAL_CONFIRM) {
        return;
    }

    if (millis() - stateEnteredAt < CONFIRM_TIMEOUT_MS) {
        return;
    }

    // Timeout elapsed — send AG:ERR and revert to idle
    if (state == ST_CONFIRM_INSTALL) {
        deploy.sendErrTimeout(OP_INSTALL);
        DEBUG_PRINTLN("[Main] INSTALL confirmation timed out — auto-cancelled");
    } else {
        deploy.sendErrTimeout(OP_REMOVE);
        DEBUG_PRINTLN("[Main] REMOVE confirmation timed out — auto-cancelled");
    }

    // Revert OLED to idle state
    setStatusMessage("Timeout", "Confirmation expired");
    enterState(ST_MENU_SELECT);
}

void setup() {
    Serial.begin(115200);
    hw.init();
    display.init();
    btns.init();
    deploy.init();
    enterState(ST_BOOT);
}

void loop() {
    hw.update();
    deploy.update();
    handleDeployResults();

    // Task 13.1: Play begin sound when AG:BEGIN is received
    if (deploy.consumeBeginSound()) {
        hw.playBegin();
    }

    handleStateEntry();

    if (state == ST_BOOT && millis() - stateEnteredAt >= BOOT_SPLASH_MS) {
        enterState(ST_CHECK_ENV);
    }

    // Task 10.4: Check 60-second confirmation timeout
    checkConfirmationTimeout();

    // Poll buttons into the event queue (Requirement 7.5 / 7.6)
    btns.update();

    // Drain the event queue and dispatch each event
    ButtonEvent evt;
    while (btns.dequeue(evt)) {
        bool ok   = (evt == BTN_OK);
        bool next = (evt == BTN_NEXT);
        bool back = (evt == BTN_BACK);
        handleButtons(ok, next, back);
    }
    handleStateEntry();
    renderUi();

    delay(LOOP_IDLE_DELAY_MS);
}
