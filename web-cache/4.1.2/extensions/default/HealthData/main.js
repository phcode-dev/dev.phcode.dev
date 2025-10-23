/*
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2015 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

define(function (require, exports, module) {

    var AppInit                 = brackets.getModule("utils/AppInit"),
        Menus                   = brackets.getModule("command/Menus"),
        CommandManager          = brackets.getModule("command/CommandManager"),
        Strings                 = brackets.getModule("strings"),
        Commands                = brackets.getModule("command/Commands"),
        HealthDataNotification  = require("HealthDataNotification"),  // self-initializes to show first-launch notification
        HealthDataManager       = require("HealthDataManager"),  // self-initializes timer to send data
        HealthDataPopup         = require("HealthDataPopup");

    var menu            = Menus.getMenu(Menus.AppMenuBar.HELP_MENU),
        healthDataCmdId = "healthData.healthDataStatistics";

    // Handles the command execution for Health Data menu item
    function handleHealthDataStatistics() {
        HealthDataNotification.handleHealthDataStatistics();
    }

    // Register the command and add the menu item for the Health Data Statistics
    function addCommand() {
        CommandManager.register(Strings.CMD_HEALTH_DATA_STATISTICS, healthDataCmdId, handleHealthDataStatistics);

        menu.addMenuItem(healthDataCmdId, "", Menus.AFTER, Commands.HELP_GET_INVOLVED);
        menu.addMenuDivider(Menus.AFTER, Commands.HELP_GET_INVOLVED);
    }

    function initTest() {
        brackets.test.HealthDataPreview      = require("HealthDataPreview");
        brackets.test.HealthDataManager      = HealthDataManager;
        brackets.test.HealthDataNotification = HealthDataNotification;
        brackets.test.HealthDataPopup        = HealthDataPopup;
    }

    AppInit.appReady(function () {
        initTest();
    });

    addCommand();

});

/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2015 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/*global logger*/
define("HealthDataManager", function (require, exports, module) {
    var AppInit             = brackets.getModule("utils/AppInit"),
        PreferencesManager  = brackets.getModule("preferences/PreferencesManager"),
        Strings             = brackets.getModule("strings"),
        Metrics             = brackets.getModule("utils/Metrics"),
        SendToAnalytics     = require("SendToAnalytics"),
        prefs               = PreferencesManager.getExtensionPrefs("healthData"),
        ONE_SECOND          = 1000,
        TEN_SECOND          = 10 * ONE_SECOND,
        ONE_MINUTE          = 60000,
        MAX_DAYS_TO_KEEP_COUNTS = 60,
        USAGE_COUNTS_KEY    = "healthDataUsage";

    /**
     * A power user is someone who has used Phoenix at least 3 days or 8 hours in the last two weeks
     * @returns {boolean}
     */
    function isPowerUser() {
        let usageData = PreferencesManager.getViewState(USAGE_COUNTS_KEY) || {},
            dateKeys = Object.keys(usageData),
            dateBefore14Days = new Date(),
            totalUsageMinutes = 0,
            totalUsageDays = 0;
        dateBefore14Days.setUTCDate(dateBefore14Days.getUTCDate()-14);
        for(let dateKey of dateKeys){
            let date = new Date(dateKey);
            if(date >= dateBefore14Days) {
                totalUsageDays ++;
                totalUsageMinutes = totalUsageMinutes + usageData[dateKey];
            }
        }
        return totalUsageDays >= 3 || (totalUsageMinutes/60) >= 8;
    }

    let healthDataDisabled;

    prefs.definePreference("healthDataTracking", "boolean", true, {
        description: Strings.DESCRIPTION_HEALTH_DATA_TRACKING
    });

    prefs.on("change", "healthDataTracking", function () {
        healthDataDisabled = !prefs.get("healthDataTracking");
        Metrics.setDisabled(healthDataDisabled);
        logger.loggingOptions.healthDataDisabled = healthDataDisabled;
    });

    // we delete all usage counts greater than MAX_DAYS_TO_KEEP_COUNTS days
    function _pruneUsageData() {
        let usageData = PreferencesManager.getViewState(USAGE_COUNTS_KEY) || {},
            dateKeys = Object.keys(usageData),
            dateBefore60Days = new Date();
        dateBefore60Days.setDate(dateBefore60Days.getDate() - MAX_DAYS_TO_KEEP_COUNTS);
        if(dateKeys.length > MAX_DAYS_TO_KEEP_COUNTS) {
            for(let dateKey of dateKeys){
                let date = new Date(dateKey);
                if(date < dateBefore60Days) {
                    delete usageData[dateKey];
                }
            }
        }
        // low priority, we do not want to save this right now
        PreferencesManager.setViewState(USAGE_COUNTS_KEY, usageData);
    }

    function _trackUsageInfo() {
        _pruneUsageData();
        setInterval(()=>{
            if(healthDataDisabled){
                return;
            }
            let usageData = PreferencesManager.getViewState(USAGE_COUNTS_KEY) || {};
            let dateNow = new Date();
            let today = dateNow.toISOString().split('T')[0]; // yyyy-mm-dd format
            usageData[today] = (usageData[today] || 0) + 1;
            // low priority, we do not want to save this right now
            PreferencesManager.setViewState(USAGE_COUNTS_KEY, usageData);
        }, ONE_MINUTE);
    }

    AppInit.appReady(function () {
        Metrics.init({
            isPowerUserFn: isPowerUser
        });
        healthDataDisabled = !prefs.get("healthDataTracking");
        if (healthDataDisabled && !Phoenix.healthTrackingDisabled) {
            // Phoenix.healthTrackingDisabled is initialized at boot using localStorage.
            // However, there's a theoretical edge case where the browser may have cleared
            // localStorage, causing a mismatch between the boot-time flag and the actual
            // persisted user preference.
            //
            // This means we might unintentionally log some metrics during the short window
            // before the real preference is loaded and applied.
            //
            // To track this discrepancy, we emit a one-time metric just before disabling tracking,
            // so we’re aware of this inconsistency and can address it if needed.
            Metrics.countEvent(Metrics.PLATFORM, "metricBoot", "disableErr");
        }
        Metrics.setDisabled(healthDataDisabled);
        SendToAnalytics.sendPlatformMetrics();
        SendToAnalytics.sendThemesMetrics();
        _trackUsageInfo();
        setTimeout(SendToAnalytics.sendStartupPerformanceMetrics, TEN_SECOND);
    });
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2021 - present core.ai. All rights reserved.

/*global*/

define("HealthDataNotification", function (require, exports, module) {

    const PreferencesManager           = brackets.getModule("preferences/PreferencesManager"),
        HealthDataPreview            = require("HealthDataPreview"),
        HealthDataPopup              = require("HealthDataPopup");

    // Since we don't have any user accounts or trackable ID to uniquely identify a user on first launch,
    // we should be ok GDPR wise to delay showing the health data popup. But it was found later to be annoying
    // and a workflow distraction. So we show the health data popup almost immediately so that the user can
    // close all the popups in on go.

    _showFirstLaunchPopup();

    function handleHealthDataStatistics() {
        HealthDataPreview.previewHealthData();
    }

    function _showFirstLaunchPopup() {
        if(!window.testEnvironment){
            const alreadyShown = PreferencesManager.getViewState("healthDataNotificationShown");
            const prefs = PreferencesManager.getExtensionPrefs("healthData");
            if (!alreadyShown && prefs.get("healthDataTracking")) {
                HealthDataPopup.showFirstLaunchTooltip()
                    .done(function () {
                        PreferencesManager.setViewState("healthDataNotificationShown", true);
                    });
            }
        }
    }

    exports.handleHealthDataStatistics       = handleHealthDataStatistics;
});

/*
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2015 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

define("HealthDataPopup", function (require, exports, module) {

    // Load dependent modules
    const NotificationUI = brackets.getModule("widgets/NotificationUI"),
        Strings = brackets.getModule("strings");

    function showFirstLaunchTooltip() {
        const deferred = new $.Deferred();
        NotificationUI.createToastFromTemplate(Strings.HEALTH_FIRST_POPUP_TITLE,
            `<div id="healthdata-firstlaunch-popup">${Strings.HEALTH_DATA_NOTIFICATION_MESSAGE}</div>`).done(deferred.resolve);
        return deferred.promise();
    }

    exports.showFirstLaunchTooltip          = showFirstLaunchTooltip;
});

/*
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2015 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

define("HealthDataPreview", function (require, exports, module) {

    var _                       = brackets.getModule("thirdparty/lodash"),
        Mustache                = brackets.getModule("thirdparty/mustache/mustache"),
        PreferencesManager      = brackets.getModule("preferences/PreferencesManager"),
        Strings                 = brackets.getModule("strings"),
        Dialogs                 = brackets.getModule("widgets/Dialogs"),
        ExtensionUtils          = brackets.getModule("utils/ExtensionUtils"),
        Metrics                 = brackets.getModule("utils/Metrics"),
        HealthDataPreviewDialog = `<div class="health-data-preview modal">
    <div class="modal-header">
        <h1 class="dialog-title">{{Strings.HEALTH_DATA_PREVIEW}}</h1>
    </div>
    <div class="modal-body">
        <div class="dialog-message">{{{Strings.HEALTH_DATA_PREVIEW_INTRO}}}</div>
		<div class="dialog-message">
			<label>
	            <input type="checkbox" data-target="hdPref" {{#hdPref}}checked{{/hdPref}} />
	            {{Strings.HEALTH_DATA_DO_TRACK}}
	        </label>
			<div style="display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-left: 3px solid #aaa; font-size: 13px; color: #666; margin: 8px 0;">
				<span style="flex-shrink: 0;">ℹ️</span>
				<span>{{Strings.HEALTH_DATA_PREVIEW_NECESSARY}}</span>
			</div>
    	</div>
	    <div class="dialog-message preview-content-container">
	        <p class="preview-content">{{{content}}}</p>
	    </div>
	</div>
    <div class="modal-footer">
		<button class="dialog-button btn" data-button-id="clear">{{Strings.RECENT_FILES_DLG_CLEAR_BUTTON_LABEL}}</button>
		<button class="dialog-button btn" data-button-id="cancel">{{Strings.CANCEL}}</button>
        <button class="dialog-button btn primary" data-button-id="save">{{Strings.DONE}}</button>
    </div>
</div>
`;

    var prefs = PreferencesManager.getExtensionPrefs("healthData");

    ExtensionUtils.loadStyleSheet(module, "styles.css");

    function _buildPreviewData() {
        let content;
        let auditData = Metrics.getLoggedDataForAudit();
        let sortedData = new Map([...auditData.entries()].sort());
        let displayData = [];
        for (const [key, value] of sortedData.entries()) {
            let valueString = "";
            if(value.count > 1) {
                valueString = `(${value.count})`;
            }
            if(value.eventType === Metrics.AUDIT_TYPE_COUNT){
                displayData.push(`${key}  total: ${value.sum} ${valueString}`);
            } else if(value.eventType === Metrics.AUDIT_TYPE_VALUE && value.count !== 0){
                displayData.push(`${key}  avg: ${value.sum/value.count} ${valueString}`);
            }
        }
        content = JSON.stringify(displayData, null, 2);
        content = _.escape(content);
        content = content.replace(/ /g, "&nbsp;");
        content = content.replace(/(?:\r\n|\r|\n)/g, "<br />");
        return content;
    }

    /**
     * Show the dialog for previewing the Health Data that will be sent.
     */
    function previewHealthData() {
        let hdPref   = prefs.get("healthDataTracking"),
            template = Mustache.render(HealthDataPreviewDialog,
                {Strings: Strings, content: _buildPreviewData(), hdPref: hdPref}),
            $template = $(template);

        Dialogs.addLinkTooltips($template);
        Dialogs.showModalDialogUsingTemplate($template).done(function (id) {

            if (id === "save") {
                var newHDPref = $template.find("[data-target]:checkbox").is(":checked");
                if (hdPref !== newHDPref) {
                    prefs.set("healthDataTracking", newHDPref);
                }
            } else if (id === 'clear'){
                Metrics.clearAuditData();
            }
        });
    }

    exports.previewHealthData = previewHealthData;
});

/*
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/*global AppConfig*/
define("SendToAnalytics", function (require, exports, module) {
    const Metrics = brackets.getModule("utils/Metrics"),
        PreferencesManager  = brackets.getModule("preferences/PreferencesManager"),
        PerfUtils           = brackets.getModule("utils/PerfUtils"),
        NodeUtils           = brackets.getModule("utils/NodeUtils"),
        themesPref          = PreferencesManager.getExtensionPrefs("themes");

    const BugsnagPerformance = window.BugsnagPerformance;

    const PLATFORM = Metrics.EVENT_TYPE.PLATFORM,
        PERFORMANCE = Metrics.EVENT_TYPE.PERFORMANCE,
        STORAGE = Metrics.EVENT_TYPE.STORAGE;

    // Platform metrics to be sent at startup
    function _emitDeviceTypeMetrics() {
        if(brackets.browser.isDeskTop) {
            Metrics.countEvent(PLATFORM, "device", "desktop");
        }
        if(brackets.browser.isMobile) {
            Metrics.countEvent(PLATFORM, "device", "mobile");
        }
        if(brackets.browser.isTablet) {
            Metrics.countEvent(PLATFORM, "device", "tablet");
        }
    }
    function _emitMobileMetricsIfPresent() {
        let platform = "none";
        if(brackets.browser.mobile.isIos) {
            platform = "ios";
        } else if(brackets.browser.mobile.isWindows) {
            platform = "windows";
        } else if(brackets.browser.mobile.isAndroid) {
            platform = "android";
        } else {
            return;
        }
        Metrics.countEvent(PLATFORM, "mobile", platform);
    }
    function _emitBrowserMetrics() {
        if(brackets.browser.desktop.isChrome) {
            Metrics.countEvent(PLATFORM, "browser", "chrome");
        }
        if(brackets.browser.desktop.isChromeBased) {
            Metrics.countEvent(PLATFORM, "browser", "chromeBased");
        }
        if(brackets.browser.desktop.isEdgeChromium) {
            Metrics.countEvent(PLATFORM, "browser", "EdgeChromium");
        }
        if(brackets.browser.desktop.isFirefox) {
            Metrics.countEvent(PLATFORM, "browser", "firefox");
        }
        if(brackets.browser.desktop.isOpera) {
            Metrics.countEvent(PLATFORM, "browser", "opera");
        }
        if(brackets.browser.desktop.isOperaChromium) {
            Metrics.countEvent(PLATFORM, "browser", "operaChromium");
        }
    }

    // web storage
    async function _sendStorageMetrics() {
        if (navigator.storage && navigator.storage.estimate) {
            const quota = await navigator.storage.estimate();
            // quota.usage -> Number of bytes used.
            // quota.quota -> Maximum number of bytes available.
            const percentageUsed = Math.round((quota.usage / quota.quota) * 100);
            const usedMB = Math.round(quota.usage / 1024 / 1024);
            console.log(`Web Storage quota used: ${percentageUsed}%, ${usedMB}MB`);
            Metrics.valueEvent(STORAGE, "browserQuota", "percentUsed", percentageUsed);
            Metrics.valueEvent(STORAGE, "browserQuota", "usedMB", usedMB);
        }
    }

    function _getPlatformInfo() {
        let OS = "";
        if (/Windows|Win32|WOW64|Win64/.test(window.navigator.userAgent)) {
            OS = "WIN";
        } else if (/Mac/.test(window.navigator.userAgent)) {
            OS = "OSX";
        } else if (/Linux|X11/.test(window.navigator.userAgent)) {
            OS = "LINUX32";
            if (/x86_64/.test(window.navigator.appVersion + window.navigator.userAgent)) {
                OS = "LINUX64";
            }
        }

        return OS;
    }

    function sendPlatformMetrics() {
        Metrics.countEvent(PLATFORM, "os", brackets.platform);
        Metrics.countEvent(PLATFORM, "userAgent", window.navigator.userAgent);
        Metrics.countEvent(PLATFORM, "languageOS", brackets.app.language);
        Metrics.countEvent(PLATFORM, "languageBrackets", brackets.getLocale());
        Metrics.countEvent(PLATFORM, "bracketsVersion", brackets.metadata.version);
        if(Phoenix.platform === "linux" && Phoenix.isNativeApp) {
            NodeUtils.getLinuxOSFlavorName()
                .then(flavor=>{
                    if(flavor){
                        Metrics.countEvent(PLATFORM, "os.flavor", flavor);
                    } else {
                        Metrics.countEvent(PLATFORM, "os.flavor", _getPlatformInfo());
                    }
                });
        } else {
            Metrics.countEvent(PLATFORM, "os.flavor", _getPlatformInfo());
        }
        _emitDeviceTypeMetrics();
        _emitBrowserMetrics();
        _emitMobileMetricsIfPresent();
        _sendStorageMetrics();
    }

    let bugsnagPerformanceInited = false;
    function _initBugsnagPerformance() {
        bugsnagPerformanceInited = true;
        BugsnagPerformance.start({
            apiKey: '94ef94f4daf871ca0f2fc912c6d4764d',
            appVersion: AppConfig.version,
            releaseStage: window.__TAURI__ ?
                `tauri-${AppConfig.config.bugsnagEnv}-${Phoenix.platform}` : AppConfig.config.bugsnagEnv,
            autoInstrumentRouteChanges: false,
            autoInstrumentNetworkRequests: false,
            autoInstrumentFullPageLoads: false
        });
    }

    function _bugsnagPerformance(key, valueMs) {
        if(Metrics.isDisabled() || !BugsnagPerformance || Phoenix.isTestWindow){
            return;
        }
        if(!bugsnagPerformanceInited) {
            _initBugsnagPerformance();
        }
        let activityStartTime = new Date();
        let activityEndTime = new Date(activityStartTime.getTime() + valueMs);
        BugsnagPerformance
            .startSpan(key, { startTime: activityStartTime })
            .end(activityEndTime);
    }

    // Performance
    function sendStartupPerformanceMetrics() {
        const healthReport = PerfUtils.getHealthReport();
        let labelAppStart = "AppStartupTime";
        if(Phoenix.firstBoot){
            labelAppStart = "FirstBootTime";
        }
        Metrics.valueEvent(PERFORMANCE, "startup", labelAppStart,
            Number(healthReport["AppStartupTime"]));
        _bugsnagPerformance(labelAppStart, Number(healthReport["AppStartupTime"])); // expensive api, use sparsely
        Metrics.valueEvent(PERFORMANCE, "startup", "ModuleDepsResolved",
            Number(healthReport["ModuleDepsResolved"]));
        _bugsnagPerformance("ModuleDepsResolved", Number(healthReport["ModuleDepsResolved"])); // expensive api, use sparsely
        Metrics.valueEvent(PERFORMANCE, "startup", "PhStore", PhStore._storageBootstrapTime);
        _bugsnagPerformance("PhStore",
            PhStore._storageBootstrapTime); // expensive api, use sparsely
        if(Phoenix.isNativeApp) {
            Metrics.valueEvent(PERFORMANCE, "startup", "tauriBoot", window._tauriBootVars.bootstrapTime);
            _bugsnagPerformance("tauriBootVars",
                window._tauriBootVars.bootstrapTime); // expensive api, use sparsely
        }
        if(window.nodeSetupDonePromise) {
            window.nodeSetupDonePromise
                .then(()=>{
                    if(window.PhNodeEngine && window.PhNodeEngine._nodeLoadTime){
                        Metrics.valueEvent(PERFORMANCE, "startup", "nodeBoot", window.PhNodeEngine._nodeLoadTime);
                        _bugsnagPerformance("nodeBoot",
                            window.PhNodeEngine._nodeLoadTime); // expensive api, use sparsely
                    }
                    Metrics.countEvent(PERFORMANCE, "nodeBoot", "success", 1);
                })
                .catch(_err=>{
                    Metrics.countEvent(PERFORMANCE, "nodeBoot", "fail", 1);
                });
        }
    }

    // Themes
    function _getCurrentTheme() {
        // TODO: currently phoenix only have default themes, but in future, we should ensure that only themes in the
        //  registry and user installed are logged for privacy.
        return themesPref.get("theme") || "default";
    }
    function sendThemesMetrics() {
        Metrics.countEvent(Metrics.EVENT_TYPE.THEMES, "currentTheme", _getCurrentTheme());
    }

    exports.sendPlatformMetrics = sendPlatformMetrics;
    exports.sendStartupPerformanceMetrics = sendStartupPerformanceMetrics;
    exports.sendThemesMetrics = sendThemesMetrics;
    // TODO: send extension metrics
});
