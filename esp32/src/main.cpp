/**
 * AetherGuard ESP32 自动化部署工具 - 主程序
 *
 * 当前交付基线:
 * - USB-TTL 本地串口部署
 * - 非阻塞状态机
 * - 真实 OLED 状态显示
 * - 显式串口标记协议
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
    ST_ERROR,
    // Bundle relay states
    ST_BUNDLE_MENU,
    ST_BUNDLE_DEPLOYING,
    ST_BUNDLE_SUCCESS,
    ST_BUNDLE_ERROR
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
            hw.setColor(COLOR_WHITE);
            break;

        case ST_CHECK_ENV:
            hw.setBlink(COLOR_BLUE, COLOR_OFF, 250);
            if (!deploy.startEnvironmentCheck()) {
                enterErrorState("Env Busy", deploy.getLastMessage(), ST_CHECK_ENV);
            }
            break;

        case ST_MENU_SELECT:
            hw.setColor(COLOR_BLUE);
            break;

        case ST_BACKUP:
            hw.setBlink(COLOR_PURPLE, COLOR_OFF, 220);
            if (!deploy.startBackup()) {
                setStatusMessage("Backup Failed", deploy.getLastMessage());
                enterState(ST_BACKUP_FAIL);
            }
            break;

        case ST_BACKUP_FAIL:
            hw.setColor(COLOR_RED);
            hw.playError();
            break;

        case ST_CONFIRM_INSTALL:
            hw.setColor(COLOR_YELLOW);
            break;

        case ST_INSTALLING:
            hw.setBlink(COLOR_YELLOW, COLOR_OFF, 200);
            if (!deploy.startInstall()) {
                enterErrorState("Install Failed", deploy.getLastMessage(), ST_MENU_SELECT);
            }
            break;

        case ST_CRITICAL_CONFIRM:
            hw.setBlink(COLOR_RED, COLOR_OFF, 160);
            hw.playWarning();
            break;

        case ST_UNINSTALLING:
            hw.setBlink(COLOR_RED, COLOR_OFF, 200);
            if (!deploy.startUninstall()) {
                enterErrorState("Remove Failed", deploy.getLastMessage(), ST_MENU_SELECT);
            }
            break;

        case ST_SUCCESS:
            hw.setColor(COLOR_GREEN);
            hw.playSuccess();
            break;

        case ST_ERROR:
            hw.setColor(COLOR_RED);
            hw.playError();
            break;

        // Bundle relay states
        case ST_BUNDLE_MENU:
            hw.setColor(COLOR_CYAN);
            break;

        case ST_BUNDLE_DEPLOYING:
            hw.setBlink(COLOR_CYAN, COLOR_OFF, 150);
            break;

        case ST_BUNDLE_SUCCESS:
            hw.setColor(COLOR_GREEN);
            hw.playSuccess();
            break;

        case ST_BUNDLE_ERROR:
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

        // Bundle deploy results handled separately via getBundleState()
        default:
            break;
    }
}

void handleBundleDeployResults() {
    auto bs = deploy.getBundleState();
    if (state == ST_BUNDLE_DEPLOYING) {
        if (bs == DeploymentModule::BUNDLE_DONE) {
            enterState(ST_BUNDLE_SUCCESS);
        } else if (bs == DeploymentModule::BUNDLE_FAILED) {
            setStatusMessage("Deploy Failed", deploy.getBundleError());
            enterState(ST_BUNDLE_ERROR);
        }
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
            display.showPrompt("Install Agent?", "Backup complete. Continue?", "[OK] Yes [Back] No");
            break;

        case ST_INSTALLING:
            snprintf(title, sizeof(title), "Install %c", spinnerChars[spinner]);
            display.showProgress(title, deploy.getLastMessage(), max(deploy.getProgress(), 10));
            break;

        case ST_CRITICAL_CONFIRM:
            display.showLines("Warning", "Delete deployed files?", "Press OK to confirm", "[Back] Cancel", false);
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

        // Bundle relay states
        case ST_BUNDLE_MENU: {
            char sizeInfo[24];
            snprintf(sizeInfo, sizeof(sizeInfo), "Size: %u KB", deploy.getBundleTotalSize() / 1024);
            display.showLines("Bundle Ready", sizeInfo, "Press OK to deploy", "[Back] Menu", false);
            break;
        }

        case ST_BUNDLE_DEPLOYING: {
            snprintf(title, sizeof(title), "Deploy %c", spinnerChars[spinner]);
            display.showProgress(title, "Writing to target...", deploy.getBundleDeployProgress());
            break;
        }

        case ST_BUNDLE_SUCCESS:
            display.showSuccess("Bundle deployed");
            break;

        case ST_BUNDLE_ERROR:
            display.showError("Deploy Failed", statusDetail, "[Back] Return");
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

            // Long press Back to access bundle menu if bundle available
            if (back && deploy.hasBundle()) {
                enterState(ST_BUNDLE_MENU);
            }
            break;

        case ST_BACKUP_FAIL:
            if (back || ok) {
                enterState(ST_MENU_SELECT);
            }
            break;

        case ST_CONFIRM_INSTALL:
            if (ok) {
                enterState(ST_INSTALLING);
            } else if (back) {
                enterState(ST_MENU_SELECT);
            }
            break;

        case ST_CRITICAL_CONFIRM:
            if (ok) {
                enterState(ST_UNINSTALLING);
            } else if (back) {
                enterState(ST_MENU_SELECT);
            }
            break;

        case ST_SUCCESS:
            if (ok || back) {
                enterState(ST_BOOT);
            }
            break;

        case ST_ERROR:
            if (back) {
                enterState(errorReturnState);
            }
            break;

        // Bundle relay button handling
        case ST_BUNDLE_MENU:
            if (ok) {
                deploy.startDeploy();
                enterState(ST_BUNDLE_DEPLOYING);
            } else if (back) {
                enterState(ST_MENU_SELECT);
            }
            break;

        case ST_BUNDLE_DEPLOYING:
            // No buttons allowed during deploy
            break;

        case ST_BUNDLE_SUCCESS:
            if (ok || back) {
                deploy.clearBundle();
                enterState(ST_MENU_SELECT);
            }
            break;

        case ST_BUNDLE_ERROR:
            if (ok || back) {
                enterState(ST_MENU_SELECT);
            }
            break;

        default:
            break;
    }
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
    deploy.updateBundle();   // Process console serial for bundle commands
    handleDeployResults();
    handleBundleDeployResults();
    handleStateEntry();

    if (state == ST_BOOT && millis() - stateEnteredAt >= BOOT_SPLASH_MS) {
        enterState(ST_CHECK_ENV);
    }

    bool ok = btns.isOkClicked();
    bool next = btns.isNextClicked();
    bool back = btns.isBackClicked();

    handleButtons(ok, next, back);
    handleStateEntry();
    renderUi();

    delay(LOOP_IDLE_DELAY_MS);
}
