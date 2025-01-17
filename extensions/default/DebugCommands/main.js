/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2012 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

/*globals path, logger, Phoenix*/
/*jslint regexp: true */

define(function (require, exports, module) {


    const _ = brackets.getModule("thirdparty/lodash");

    const Commands               = brackets.getModule("command/Commands"),
        CommandManager         = brackets.getModule("command/CommandManager"),
        Menus                  = brackets.getModule("command/Menus"),
        FileSystem             = brackets.getModule("filesystem/FileSystem"),
        FileUtils              = brackets.getModule("file/FileUtils"),
        PerfUtils              = brackets.getModule("utils/PerfUtils"),
        StringUtils            = brackets.getModule("utils/StringUtils"),
        Dialogs                = brackets.getModule("widgets/Dialogs"),
        DragAndDrop            = brackets.getModule("utils/DragAndDrop"),
        Strings                = brackets.getModule("strings"),
        PreferencesManager     = brackets.getModule("preferences/PreferencesManager"),
        LocalizationUtils      = brackets.getModule("utils/LocalizationUtils"),
        MainViewManager        = brackets.getModule("view/MainViewManager"),
        WorkingSetView         = brackets.getModule("project/WorkingSetView"),
        ExtensionManager       = brackets.getModule("extensibility/ExtensionManager"),
        Mustache               = brackets.getModule("thirdparty/mustache/mustache"),
        Locales                = brackets.getModule("nls/strings"),
        ProjectManager         = brackets.getModule("project/ProjectManager"),
        ExtensionLoader        = brackets.getModule("utils/ExtensionLoader"),
        NodeConnector          = brackets.getModule("NodeConnector"),
        extensionDevelopment   = require("extensionDevelopment"),
        PerfDialogTemplate     = require("text!htmlContent/perf-dialog.html"),
        TestBuilder      = require("./testBuilder"),
        LanguageDialogTemplate = require("text!htmlContent/language-dialog.html");

    const KeyboardPrefs = JSON.parse(require("text!keyboard.json"));

    const DIAGNOSTICS_SUBMENU = "debug-diagnostics-sub-menu",
        EXPERIMENTAL_FEATURES_SUB_MENU = "debug-experimental-features";

    // default preferences file name
    const DEFAULT_PREFERENCES_FILENAME = "defaultPreferences.json",
        SUPPORTED_PREFERENCE_TYPES   = ["number", "boolean", "string", "array", "object"];

    let recomputeDefaultPrefs        = true,
        defaultPreferencesFullPath   = path.normalize(brackets.app.getApplicationSupportDirectory() + "/" + DEFAULT_PREFERENCES_FILENAME);

     /**
      * Debug commands IDs
      * @enum {string}
      */
    const DEBUG_REFRESH_WINDOW                = "debug.refreshWindow", // string must MATCH string in native code (brackets_extensions)
        DEBUG_SHOW_DEVELOPER_TOOLS            = "debug.showDeveloperTools",
        DEBUG_LOAD_CURRENT_EXTENSION          = "debug.loadCurrentExtension",
        DEBUG_UNLOAD_CURRENT_EXTENSION        = "debug.unloadCurrentExtension",
        DEBUG_RUN_UNIT_TESTS                  = "debug.runUnitTests",
        DEBUG_SHOW_PERF_DATA                  = "debug.showPerfData",
        DEBUG_RELOAD_WITHOUT_USER_EXTS        = "debug.reloadWithoutUserExts",
        DEBUG_SWITCH_LANGUAGE                 = "debug.switchLanguage",
        DEBUG_ENABLE_LOGGING                  = "debug.enableLogging",
        DEBUG_ENABLE_PHNODE_INSPECTOR         = "debug.enablePhNodeInspector",
        DEBUG_GET_PHNODE_INSPECTOR_URL        = "debug.getPhNodeInspectorURL",
        DEBUG_LIVE_PREVIEW_LOGGING            = "debug.livePreviewLogging",
        DEBUG_GIT_EXTENSION_LOGGING           = "debug.gitLogging",
        DEBUG_OPEN_VFS                        = "debug.openVFS",
        DEBUG_OPEN_EXTENSION_FOLDER           = "debug.openExtensionFolders",
        DEBUG_OPEN_VIRTUAL_SERVER             = "debug.openVirtualServer",
        DEBUG_OPEN_PREFERENCES_IN_SPLIT_VIEW  = "debug.openPrefsInSplitView",
        DEBUG_BUILD_TESTS                     = "debug.buildTests",
        DEBUG_DRAG_AND_DROP                   = "debug.dragAndDrop";

    const LOG_TO_CONSOLE_KEY = logger.loggingOptions.LOCAL_STORAGE_KEYS.LOG_TO_CONSOLE_KEY,
        LOG_LIVE_PREVIEW_KEY = logger.loggingOptions.LOCAL_STORAGE_KEYS.LOG_LIVE_PREVIEW,
        LOG_GIT_KEY = logger.loggingOptions.LOCAL_STORAGE_KEYS.LOG_GIT;

    // define a preference to turn off opening preferences in split-view.
    var prefs = PreferencesManager.getExtensionPrefs("preferencesView");
    prefs.definePreference("openPrefsInSplitView",   "boolean", true, {
        description: Strings.DESCRIPTION_OPEN_PREFS_IN_SPLIT_VIEW
    });

    prefs.definePreference("openUserPrefsInSecondPane",   "boolean", true, {
        description: Strings.DESCRIPTION_OPEN_USER_PREFS_IN_SECOND_PANE
    });

    // Implements the 'Run Tests' menu to bring up the Jasmine unit test window
    function _runUnitTests(spec) {
        let queryString = spec ? "?spec=" + spec : "?suite=unit";
        let testBaseURL = "../test/SpecRunner.html";
        if(window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'){
            // must be a deployed in phcode.dev/other sites. point to site test url
            testBaseURL = "test/SpecRunner.html";
        }
        Phoenix.app.openURLInPhoenixWindow(testBaseURL + queryString, {
            windowTitle: "Test Runner",
            preferTabs: true,
            width: 1670,
            height: 900
        });
    }

    function handleReload() {
        CommandManager.execute(Commands.APP_RELOAD);
    }

    function handleReloadWithoutUserExts() {
        CommandManager.execute(Commands.APP_RELOAD_WITHOUT_EXTS);
    }

    function handleShowPerfData() {
        var templateVars = {
            delimitedPerfData: PerfUtils.getDelimitedPerfData(),
            perfData: []
        };

        var getValue = function (entry) {
            // entry is either an Array or a number
            if (Array.isArray(entry)) {
                // For Array of values, return: minimum/average(count)/maximum/last
                var i, e, avg, sum = 0, min = Number.MAX_VALUE, max = 0;

                for (i = 0; i < entry.length; i++) {
                    e = entry[i];
                    min = Math.min(min, e);
                    sum += e;
                    max = Math.max(max, e);
                }
                avg = Math.round(sum * 10 / entry.length) / 10; // tenth of a millisecond
                return String(min) + "/" + String(avg) + "(" + entry.length + ")/" + String(max) + "/" + String(e);
            }
            return entry;

        };

        var perfData = PerfUtils.getData();
        _.forEach(perfData, function (value, testName) {
            templateVars.perfData.push({
                testName: StringUtils.breakableUrl(testName),
                value: getValue(value)
            });
        });

        var template = Mustache.render(PerfDialogTemplate, templateVars);
        Dialogs.showModalDialogUsingTemplate(template);

        // Select the raw perf data field on click since select all doesn't
        // work outside of the editor
        $("#brackets-perf-raw-data").click(function () {
            $(this).focus().select();
        });
    }

    function handleSwitchLanguage() {
        const supportedLocales = Object.keys(Locales);

        var $dialog,
            $submit,
            $select,
            locale,
            curLocale = (brackets.isLocaleDefault() ? null : brackets.getLocale()),
            languages = [];

        var setLanguage = function (event) {
            locale = $select.val();
            $submit.prop("disabled", locale === (curLocale || ""));
        };

        for(let supportedLocale of supportedLocales){
            var match = supportedLocale.match(/^([a-z]{2})(-[a-z]{2})?$/);

            if (match) {
                var language = supportedLocale,
                    label = match[1];

                if (match[2]) {
                    label += match[2].toUpperCase();
                }

                languages.push({label: LocalizationUtils.getLocalizedLabel(label), language: language});
            }
        }
        // add English (US), which is the root folder and should be sorted as well
        languages.push({label: LocalizationUtils.getLocalizedLabel("en"),  language: "en"});

        // sort the languages via their display name
        languages.sort(function (lang1, lang2) {
            return lang1.label.localeCompare(lang2.label);
        });

        // add system default (which is placed on the very top)
        languages.unshift({label: Strings.LANGUAGE_SYSTEM_DEFAULT, language: null});

        var template = Mustache.render(LanguageDialogTemplate, {languages: languages, Strings: Strings});
        Dialogs.showModalDialogUsingTemplate(template).done(function (id) {
            if (id === Dialogs.DIALOG_BTN_OK && locale !== curLocale) {
                brackets.setLocale(locale);
                CommandManager.execute(Commands.APP_RELOAD);
            }
        });

        $dialog = $(".switch-language.instance");
        $submit = $dialog.find(".dialog-button[data-button-id='" + Dialogs.DIALOG_BTN_OK + "']");
        $select = $dialog.find("select");

        $select.on("change", setLanguage).val(curLocale);
    }

    function _openPrefFilesInSplitView(prefsPath, defaultPrefsPath, deferredPromise) {

        var currScheme         = MainViewManager.getLayoutScheme(),
            file               = FileSystem.getFileForPath(prefsPath),
            defaultPrefsFile   = FileSystem.getFileForPath(defaultPrefsPath),
            DEFAULT_PREFS_PANE = "first-pane",
            USER_PREFS_PANE    = "second-pane";

        // Exchange the panes, if default preferences need to be opened
        // in the right pane.
        if (!prefs.get("openUserPrefsInSecondPane")) {
            DEFAULT_PREFS_PANE = "second-pane";
            USER_PREFS_PANE    = "first-pane";
        }

        function _openFiles() {

            if (currScheme.rows === 1 && currScheme.columns === 1) {
                // Split layout is not active yet. Initiate the
                // split view.
                MainViewManager.setLayoutScheme(1, 2);
            }

            // Open the default preferences in the left pane in the read only mode.
            CommandManager.execute(Commands.FILE_OPEN, { fullPath: defaultPrefsPath, paneId: DEFAULT_PREFS_PANE, options: { isReadOnly: true } })
                .done(function () {

                    // Make sure the preference file is going to be opened in pane
                    // specified in the preference.
                    if (MainViewManager.findInWorkingSet(DEFAULT_PREFS_PANE, prefsPath) >= 0) {

                        MainViewManager._moveView(DEFAULT_PREFS_PANE, USER_PREFS_PANE, file, 0, true);

                        // Now refresh the project tree by asking
                        // it to rebuild the UI.
                        WorkingSetView.refresh(true);
                    }

                    CommandManager.execute(Commands.FILE_OPEN, { fullPath: prefsPath, paneId: USER_PREFS_PANE})
                        .done(function () {
                            deferredPromise.resolve();
                        }).fail(function () {
                            deferredPromise.reject();
                        });
                }).fail(function () {
                    deferredPromise.reject();
                });
        }

        var resultObj = MainViewManager.findInAllWorkingSets(defaultPrefsPath);
        if (resultObj && resultObj.length > 0) {
            CommandManager.execute(Commands.FILE_CLOSE, {file: defaultPrefsFile, paneId: resultObj[0].paneId})
                .done(function () {
                    _openFiles();
                }).fail(function () {
                    deferredPromise.reject();
                });
        } else {
            _openFiles();
        }

    }

    function _isSupportedPrefType(prefType) {

        if (SUPPORTED_PREFERENCE_TYPES.indexOf(prefType) >= 0) {
            return true;
        }
        return false;

    }

   /*
    * This method tries to deduce the preference type
    * based on various parameters like objects initial
    * value, object type, object's type property.
    */
    function _getPrefType(prefItem) {

        var finalPrefType = "undefined";

        if (prefItem) {
            // check the type parameter.
            var _prefType = prefItem.type;
            if (_prefType !== undefined) {
                finalPrefType = prefItem.type.toLowerCase();
                // make sure the initial property's
                // object type matches to that of 'type' property.
                if (prefItem.initial !== undefined) {

                    if (Array.isArray(prefItem.initial)) {
                        _prefType = "array";
                    } else {
                        var _initialType = typeof (prefItem.initial);
                        _initialType = _initialType.toLowerCase();
                        if (_prefType !== _initialType) {
                            _prefType = _initialType;
                        }
                    }
                }
            }

            if (_prefType) {
                // preference object's type
                // is defined. Check if that is valid or not.
                finalPrefType = _prefType;
                if (!_isSupportedPrefType(finalPrefType)) {
                    finalPrefType = "undefined";
                }
            } else if (Array.isArray(prefItem)) {
                // Check if the object itself
                // is an array, in which case
                // we log the default.
                finalPrefType = "array";
            } else if (prefItem.initial !== undefined  ||
                       prefItem.keys !== undefined) {

                // OK looks like this preference has
                // no explicit type defined. instead
                // it needs to be deduced from initial/keys
                // variable.
                var _prefVar;
                if (prefItem.initial !== undefined) {
                    _prefVar = prefItem.initial;
                } else {
                    _prefVar = prefItem.keys;
                }

                if (Array.isArray(_prefVar)) {
                    // In cases of array the
                    // typeof is returning a function.
                    finalPrefType = "array";
                }

            } else {
                finalPrefType = typeof (prefItem);
            }
        }

        // Now make sure we recognize this format.
        if (!_isSupportedPrefType(finalPrefType)) {
            finalPrefType = "undefined";
        }

        return finalPrefType;
    }

    function _isValidPref(pref) {

        // Make sure to generate pref description only for
        // user overrides and don't generate for properties
        // meant to be used for internal purposes. Also check
        // if the preference type is valid or not.
        if (pref && !pref.excludeFromHints && _getPrefType(pref) !== "undefined") {
            return true;
        }

        return false;
    }

   /*
    * This method tries to match between initial objects
    * and key objects and then aggregates objects from both
    * the properties.
    */
    function _getChildPrefs(prefItem) {

        var finalObj = {},
            keysFound = false;

        if (!prefItem) {
            return {};
        }

        function _populateKeys(allKeys) {

            var prop;
            if (typeof (allKeys) === "object") {
                // iterate through the list.
                keysFound = true;
                for (prop in allKeys) {
                    if (allKeys.hasOwnProperty(prop)) {
                        finalObj[prop] = allKeys[prop];
                    }
                }
            }
        }

        _populateKeys(prefItem.initial);
        _populateKeys(prefItem.keys);

        // Last resort: Maybe plain objects, in which case
        // we blindly extract all the properties.
        if (!keysFound) {
            _populateKeys(prefItem);
        }

        return finalObj;
    }

    function _formatBasicPref(prefItem, prefName, tabIndentStr) {

        if (!prefItem || typeof (prefName) !== "string" || _getPrefType(prefItem) === "object") {
            // return empty string in case of
            // object or pref is not defined.
            return "";
        }

        var prefDescription = prefItem.description || "",
            prefDefault     = prefItem.initial,
            prefFormatText  = tabIndentStr + "\t// {0}\n" + tabIndentStr + "\t\"{1}\": {2}",
            prefItemType    = _getPrefType(prefItem);

        if (prefDefault === undefined && !prefItem.description) {
            // This could be the case when prefItem is a basic JS variable.
            if (prefItemType === "number" || prefItemType === "boolean" || prefItemType === "string") {
                prefDefault = prefItem;
            }
        }

        if (prefDefault === undefined) {
            if (prefItemType === "number") {
                prefDefault = 0;
            } else if (prefItemType === "boolean") {
                // Defaulting the preference to false,
                // in case this is missing.
                prefDefault = false;
            } else {
                // for all other types
                prefDefault = "";
            }
        }

        if ((prefDescription === undefined || prefDescription.length === 0)) {
            if (!Array.isArray(prefDefault)) {
                prefDescription = Strings.DEFAULT_PREFERENCES_JSON_DEFAULT + ": " + prefDefault;
            } else {
                prefDescription = "";
            }
        }

        if (prefItemType === "array") {
            prefDefault = "[]";
        } else if (prefDefault.length === 0 || (prefItemType !== "boolean" && prefItemType !== "number")) {
            prefDefault = "\"" + prefDefault + "\"";
        }

        return StringUtils.format(prefFormatText, prefDescription, prefName, prefDefault);
    }

    function _formatPref(prefName,  prefItem, indentLevel) {

        // check for validity of the parameters being passed
        if (!prefItem || indentLevel < 0 || !prefName || !prefName.length) {
            return "";
        }

        var iLevel,
            prefItemKeys,
            entireText     = "",
            prefItemDesc   = prefItem.description || "",
            prefItemType   = _getPrefType(prefItem),
            hasKeys        = false,
            tabIndents     = "",
            numKeys        = 0;

        // Generate the indentLevel string
        for (iLevel = 0; iLevel < indentLevel; iLevel++) {
            tabIndents += "\t";
        }

        // Check if the preference is an object.
        if (_getPrefType(prefItem) === "object") {
            prefItemKeys = _getChildPrefs(prefItem);
            if (Object.keys(prefItemKeys).length > 0) {
                hasKeys = true;
            }
        }

        // There are some properties like "highlightMatches" that
        // are declared as boolean type but still can take object keys.
        // The below condition check can take care of cases like this.
        if (prefItemType !== "object" && hasKeys === false) {
            return _formatBasicPref(prefItem, prefName, tabIndents);
        }

        // Indent the beginning of the object.
        tabIndents += "\t";

        if (prefItemDesc && prefItemDesc.length > 0) {
            entireText = tabIndents + "// " + prefItemDesc + "\n";
        }

        entireText += tabIndents + "\"" + prefName + "\": " + "{";

        if (prefItemKeys) {
            numKeys = Object.keys(prefItemKeys).length;
        }

        // In case the object array is empty
        if (numKeys <= 0) {
            entireText += "}";
            return entireText;
        }
        entireText += "\n";


        // Now iterate through all the keys
        // and generate nested formatted objects.

        Object.keys(prefItemKeys).sort().forEach(function (property) {

            if (prefItemKeys.hasOwnProperty(property)) {

                var pref = prefItemKeys[property];

                if (_isValidPref(pref)) {

                    var formattedText = "";

                    if (_getPrefType(pref) === "object") {
                        formattedText = _formatPref(property, pref, indentLevel + 1);
                    } else {
                        formattedText = _formatBasicPref(pref, property, tabIndents);
                    }

                    if (formattedText.length > 0) {
                        entireText += formattedText + ",\n\n";
                    }
                }
            }
        });

        // Strip ",\n\n" that got added above, for the last property
        if (entireText.length > 0) {
            entireText = entireText.slice(0, -3) + "\n" + tabIndents + "}";
        } else {
            entireText = "{}";
        }

        return entireText;
    }

    function _getDefaultPreferencesString() {

        var allPrefs       = PreferencesManager.getAllPreferences(),
            headerComment  = Strings.DEFAULT_PREFERENCES_JSON_HEADER_COMMENT + "\n\n{\n",
            entireText     = "";

        Object.keys(allPrefs).sort().forEach(function (property) {
            if (allPrefs.hasOwnProperty(property)) {

                var pref = allPrefs[property];

                if (_isValidPref(pref)) {
                    entireText += _formatPref(property, pref, 0) + ",\n\n";
                }
            }
        });

        // Strip ",\n\n" that got added above, for the last property
        if (entireText.length > 0) {
            entireText = headerComment + entireText.slice(0, -3) + "\n}\n";
        } else {
            entireText = headerComment + "}\n";
        }

        return entireText;
    }

    function _loadDefaultPrefs(prefsPath, deferredPromise) {

        var defaultPrefsPath = defaultPreferencesFullPath,
            file             = FileSystem.getFileForPath(defaultPrefsPath);

        function _executeDefaultOpenPrefsCommand() {

            CommandManager.execute(Commands.FILE_OPEN_PREFERENCES)
                .done(function () {
                    deferredPromise.resolve();
                }).fail(function () {
                    deferredPromise.reject();
                });
        }

        file.exists(function (err, doesExist) {

            if (doesExist) {

                // Go about recreating the default preferences file.
                if (recomputeDefaultPrefs) {

                    var prefsString       = _getDefaultPreferencesString();
                    recomputeDefaultPrefs = false;

                    // We need to delete this first
                    file.unlink(function (err) {
                        if (!err) {
                            // Go about recreating this
                            // file and write the default
                            // preferences string to this file.
                            FileUtils.writeText(file, prefsString, true)
                                .done(function () {
                                    recomputeDefaultPrefs = false;
                                    _openPrefFilesInSplitView(prefsPath, defaultPrefsPath, deferredPromise);
                                }).fail(function (error) {
                                    // Give a chance for default preferences command.
                                    console.error("Unable to write to default preferences file! error code:" + error);
                                    _executeDefaultOpenPrefsCommand();
                                });
                        } else {
                            // Some error occured while trying to delete
                            // the file. In this case open the user
                            // preferences alone.
                            console.error("Unable to delete the existing default preferences file! error code:" + err);
                            _executeDefaultOpenPrefsCommand();
                        }
                    });

                } else {
                    // Default preferences already generated.
                    // Just go about opening both the files.
                    _openPrefFilesInSplitView(prefsPath, defaultPrefsPath, deferredPromise);
                }
            } else {

                // The default prefs file does not exist at all.
                // So go about recreating the default preferences
                // file.
                var _prefsString = _getDefaultPreferencesString();
                FileUtils.writeText(file, _prefsString, true)
                    .done(function () {
                        recomputeDefaultPrefs = false;
                        _openPrefFilesInSplitView(prefsPath, defaultPrefsPath, deferredPromise);
                    }).fail(function (error) {
                        // Give a chance for default preferences command.
                        console.error("Unable to write to default preferences file! error code:" + error);
                        _executeDefaultOpenPrefsCommand();
                    });
            }
        });
    }

    function handleOpenPrefsInSplitView() {

        var fullPath        = PreferencesManager.getUserPrefFile(),
            file            = FileSystem.getFileForPath(fullPath),
            splitViewPrefOn = prefs.get("openPrefsInSplitView"),
            result          = new $.Deferred();

        if (!splitViewPrefOn) {
            return CommandManager.execute(Commands.FILE_OPEN_PREFERENCES);
        }
        file.exists(function (err, doesExist) {
            if (doesExist) {
                _loadDefaultPrefs(fullPath, result);
            } else {
                FileUtils.writeText(file, "", true)
                        .done(function () {
                            _loadDefaultPrefs(fullPath, result);
                        }).fail(function () {
                            result.reject();
                        });
            }
        });


        return result.promise();
    }

    function _updateLogToConsoleMenuItemChecked() {
        const isLogging = window.setupLogging();
        CommandManager.get(DEBUG_ENABLE_LOGGING).setChecked(isLogging);
        CommandManager.get(DEBUG_LIVE_PREVIEW_LOGGING).setEnabled(isLogging);
        logger.loggingOptions.logLivePreview = window.isLoggingEnabled(LOG_LIVE_PREVIEW_KEY);
        logger.loggingOptions.logGit = window.isLoggingEnabled(LOG_GIT_KEY);
        CommandManager.get(DEBUG_LIVE_PREVIEW_LOGGING).setChecked(logger.loggingOptions.logLivePreview);
        CommandManager.get(DEBUG_GIT_EXTENSION_LOGGING).setChecked(logger.loggingOptions.logGit);
        CommandManager.get(DEBUG_ENABLE_PHNODE_INSPECTOR).setChecked(NodeConnector.isInspectEnabled());
    }

    function _handleLogging() {
        window.toggleLoggingKey(LOG_TO_CONSOLE_KEY);
        _updateLogToConsoleMenuItemChecked();
    }

    function _handlePhNodeInspectEnable() {
        NodeConnector.setInspectEnabled(!NodeConnector.isInspectEnabled());
        _updateLogToConsoleMenuItemChecked();
    }

    function _handleGetPhNodeInspectURL() {
        Dialogs.showInfoDialog(Strings.CMD_GET_PHNODE_INSPECTOR_URL,
            `<div id="instructions">
  <p>
    1. Go to <a href="chrome://inspect/" target="_blank">chrome://inspect/#devices</a>
    <button onclick="Phoenix.app.copyToClipboard('chrome://inspect/')">
      <i class="fas fa-copy"></i> Copy
    </button>
  </p>
  <p>2. Select Option 'Open dedicated DevTools for Node'</p>
  <p>
    3. Use the URL in connection tab'<code>localhost:${NodeConnector.getInspectPort()}</code>'
    <button onclick="Phoenix.app.copyToClipboard('localhost:${NodeConnector.getInspectPort()}')">
      <i class="fas fa-copy"></i> Copy
    </button>
  </p>
</div>`);
    }

    function _handleLivePreviewLogging() {
        window.toggleLoggingKey(LOG_LIVE_PREVIEW_KEY);
        _updateLogToConsoleMenuItemChecked();
    }

    function _handleGitLogging() {
        window.toggleLoggingKey(LOG_GIT_KEY);
        _updateLogToConsoleMenuItemChecked();
    }

    ExtensionManager.on("statusChange", function (id) {
        // Seems like an extension(s) got installed.
        // Need to recompute the default prefs.
        recomputeDefaultPrefs = true;
    });

    function _openVFS() {
        ProjectManager.openProject("/");
    }

    function _openExtensionsFolder() {
        Phoenix.app.openPathInFileBrowser(ExtensionLoader.getUserExtensionPath());
    }

    function _openVirtualServer() {
        const virtualServingURL = Phoenix.VFS.getVirtualServingURLForPath("/");
        if(!virtualServingURL) {
            throw new Error("Unable to find virtual server!");
        }
        Phoenix.app.openURLInPhoenixWindow(virtualServingURL, {
            preferTabs: true
        });
    }

    function _handleShowDeveloperTools() {
        brackets.app.toggleDevtools();
    }

    /* Register all the command handlers */
    let loadOrReloadString = extensionDevelopment.isProjectLoadedAsExtension() ?
        Strings.CMD_RELOAD_CURRENT_EXTENSION : Strings.CMD_LOAD_CURRENT_EXTENSION;
    CommandManager.register(loadOrReloadString,     DEBUG_LOAD_CURRENT_EXTENSION,
        extensionDevelopment.loadCurrentExtension);
    CommandManager.register(Strings.CMD_UNLOAD_CURRENT_EXTENSION,     DEBUG_UNLOAD_CURRENT_EXTENSION,
        extensionDevelopment.unloadCurrentExtension);
    CommandManager.register(Strings.CMD_REFRESH_WINDOW,             DEBUG_REFRESH_WINDOW,           handleReload);
    CommandManager.register(Strings.CMD_RELOAD_WITHOUT_USER_EXTS,   DEBUG_RELOAD_WITHOUT_USER_EXTS, handleReloadWithoutUserExts);

    // Start with the "Run Tests" item disabled. It will be enabled later if the test file can be found.
    CommandManager.register(Strings.CMD_RUN_UNIT_TESTS,       DEBUG_RUN_UNIT_TESTS,         _runUnitTests);

    CommandManager.register(Strings.CMD_SHOW_PERF_DATA,            DEBUG_SHOW_PERF_DATA,            handleShowPerfData);

    let switchLanguageStr = Strings.CMD_SWITCH_LANGUAGE === "Switch Language\u2026" ?
        Strings.CMD_SWITCH_LANGUAGE :
        `${Strings.CMD_SWITCH_LANGUAGE} (Switch Language)`;
    CommandManager.register(switchLanguageStr,           DEBUG_SWITCH_LANGUAGE,           handleSwitchLanguage);

    CommandManager.register(Strings.CMD_ENABLE_LOGGING, DEBUG_ENABLE_LOGGING,   _handleLogging);
    CommandManager.register(Strings.CMD_ENABLE_PHNODE_INSPECTOR, DEBUG_ENABLE_PHNODE_INSPECTOR, _handlePhNodeInspectEnable);
    CommandManager.register(Strings.CMD_GET_PHNODE_INSPECTOR_URL, DEBUG_GET_PHNODE_INSPECTOR_URL, _handleGetPhNodeInspectURL);
    CommandManager.register(Strings.CMD_ENABLE_LIVE_PREVIEW_LOGS, DEBUG_LIVE_PREVIEW_LOGGING, _handleLivePreviewLogging);
    CommandManager.register(Strings.CMD_ENABLE_GIT_LOGS, DEBUG_GIT_EXTENSION_LOGGING, _handleGitLogging);
    CommandManager.register(Strings.CMD_OPEN_VFS, DEBUG_OPEN_VFS,   _openVFS);
    CommandManager.register(Strings.CMD_OPEN_EXTENSIONS_FOLDER, DEBUG_OPEN_EXTENSION_FOLDER,   _openExtensionsFolder);
    CommandManager.register(Strings.CMD_OPEN_VIRTUAL_SERVER, DEBUG_OPEN_VIRTUAL_SERVER,   _openVirtualServer);

    CommandManager.register(Strings.CMD_OPEN_PREFERENCES, DEBUG_OPEN_PREFERENCES_IN_SPLIT_VIEW, handleOpenPrefsInSplitView);
    const debugMenu = Menus.getMenu(Menus.AppMenuBar.DEBUG_MENU);
    debugMenu.addMenuItem(DEBUG_REFRESH_WINDOW, window.debugMode ? KeyboardPrefs.refreshWindow : undefined);
    debugMenu.addMenuItem(DEBUG_RELOAD_WITHOUT_USER_EXTS, window.debugMode ? KeyboardPrefs.reloadWithoutUserExts : undefined);
    debugMenu.addMenuItem(DEBUG_LOAD_CURRENT_EXTENSION);
    debugMenu.addMenuItem(DEBUG_UNLOAD_CURRENT_EXTENSION, undefined, undefined, undefined, {
        hideWhenCommandDisabled: true
    });
    debugMenu.addMenuItem(DEBUG_OPEN_EXTENSION_FOLDER, undefined, undefined, undefined, {
        hideWhenCommandDisabled: true
    });
    debugMenu.addMenuDivider();
    // Show Developer Tools (optionally enabled)
    if(Phoenix.isNativeApp){
        CommandManager.register(Strings.CMD_SHOW_DEV_TOOLS, DEBUG_SHOW_DEVELOPER_TOOLS, _handleShowDeveloperTools);
        debugMenu.addMenuItem(DEBUG_SHOW_DEVELOPER_TOOLS, KeyboardPrefs.showDeveloperTools);
    }
    // this command is defined in core, but exposed only in Debug menu for now
    debugMenu.addMenuItem(Commands.FILE_OPEN_KEYMAP, null);
    const diagnosticsSubmenu = debugMenu.addSubMenu(Strings.CMD_DIAGNOSTIC_TOOLS, DIAGNOSTICS_SUBMENU);
    diagnosticsSubmenu.addMenuItem(DEBUG_RUN_UNIT_TESTS);
    CommandManager.register(Strings.CMD_BUILD_TESTS, DEBUG_BUILD_TESTS, TestBuilder.toggleTestBuilder);
    diagnosticsSubmenu.addMenuItem(DEBUG_BUILD_TESTS);
    diagnosticsSubmenu.addMenuDivider();
    diagnosticsSubmenu.addMenuItem(DEBUG_ENABLE_LOGGING);
    diagnosticsSubmenu.addMenuItem(DEBUG_ENABLE_PHNODE_INSPECTOR, undefined, undefined, undefined, {
        hideWhenCommandDisabled: true
    });
    diagnosticsSubmenu.addMenuItem(DEBUG_GET_PHNODE_INSPECTOR_URL, undefined, undefined, undefined, {
        hideWhenCommandDisabled: true
    });
    diagnosticsSubmenu.addMenuItem(DEBUG_LIVE_PREVIEW_LOGGING);
    if(Phoenix.isNativeApp) {
        diagnosticsSubmenu.addMenuItem(DEBUG_GIT_EXTENSION_LOGGING);
    }
    diagnosticsSubmenu.addMenuDivider();
    diagnosticsSubmenu.addMenuItem(DEBUG_SHOW_PERF_DATA);
    diagnosticsSubmenu.addMenuItem(DEBUG_OPEN_VFS);
    diagnosticsSubmenu.addMenuItem(DEBUG_OPEN_VIRTUAL_SERVER, undefined, undefined, undefined, {
        hideWhenCommandDisabled: true
    });

    if(Phoenix.isNativeApp) {
        // there is only one experimental feature- drag and drop available in native apps only.
        const experimentalSubmenu = debugMenu.addSubMenu(Strings.CMD_EXPERIMENTAL_FEATURES, EXPERIMENTAL_FEATURES_SUB_MENU);
        CommandManager.register(Strings.CMD_ENABLE_DRAG_AND_DROP, DEBUG_DRAG_AND_DROP, ()=>{
            PreferencesManager.set(DragAndDrop._PREF_DRAG_AND_DROP,
                !PreferencesManager.get(DragAndDrop._PREF_DRAG_AND_DROP));
        });
        PreferencesManager.on("change", DragAndDrop._PREF_DRAG_AND_DROP, function () {
            CommandManager.get(DEBUG_DRAG_AND_DROP).setChecked(PreferencesManager.get(DragAndDrop._PREF_DRAG_AND_DROP));
        });
        experimentalSubmenu.addMenuItem(DEBUG_DRAG_AND_DROP);
    }

    CommandManager.get(DEBUG_UNLOAD_CURRENT_EXTENSION)
        .setEnabled(extensionDevelopment.isProjectLoadedAsExtension());
    CommandManager.get(DEBUG_OPEN_EXTENSION_FOLDER)
        .setEnabled(Phoenix.isNativeApp); // only show in tauri
    CommandManager.get(DEBUG_ENABLE_PHNODE_INSPECTOR)
        .setEnabled(Phoenix.isNativeApp); // only show in tauri
    CommandManager.get(DEBUG_GET_PHNODE_INSPECTOR_URL)
        .setEnabled(Phoenix.isNativeApp); // only show in tauri
    CommandManager.get(DEBUG_OPEN_VIRTUAL_SERVER)
        .setEnabled(!Phoenix.isNativeApp); // don't show in tauri as there is no virtual server in tauri

    _updateLogToConsoleMenuItemChecked();

    const helpMenu = Menus.getMenu(Menus.AppMenuBar.HELP_MENU);
    helpMenu.addMenuItem(DEBUG_SWITCH_LANGUAGE, "", Menus.BEFORE, Commands.HELP_YOUTUBE);
    helpMenu.addMenuDivider(Menus.AFTER, DEBUG_SWITCH_LANGUAGE);

    const fileMenu = Menus.getMenu(Menus.AppMenuBar.FILE_MENU);
    // this command will enable defaultPreferences and brackets preferences to be open side by side in split view.
    fileMenu.addMenuItem(DEBUG_OPEN_PREFERENCES_IN_SPLIT_VIEW, null, Menus.BEFORE, Menus.MenuSection.FILE_SETTINGS.sectionMarker);

    // exposed for convenience, but not official API
    exports._runUnitTests = _runUnitTests;
});

/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

/*global path, jsPromise*/

/**
 *  Utilities functions for running macros.
 *  Eg:
 *  await __PR.openFile("a.html");
 *   __PR.setCursors(["17:28", "17:28-17:30"])
 * __PR.expectCursorsToBe(["17:28", "17:28-17:30"])
 * __PR.keydown(["BACK_SPACE"])
 * __PR.typeAtCursor("hello")
 * __PR.validateText(`a`, "16:14-16:15")
 * __PR.validateAllMarks("startTagSyncEdit", ["16:14-16:15"]); // All marks of type startTagSyncEdit should be there
 * __PR.validateMarks("startTagSyncEdit", ["16:14-16:15"], 1); // 1 is total marks of type startTagSyncEdit
 *
 *  This can be later extended to run macros. But since this uses eval, the
 *  security posture must be changed. One way is to:
 *  1. create an iframe that contains the macro panel and codemirror surface in a sandboxed or 3rd party context. This
 *     will create origin isolation in browser so that extensions cannot read or write to the ifrmae macro code.
 *  2. The iframe should be created in an extensions and once created, only that iframe should be tested to run evaled
 *     code. So the iframe will post message with code to eval and we will only eval that.
 *  3. The iframe can request to save data to eval which we need to carefully handle.
 *  4. Now this is a problem only when we securely sandbox extensions in the future, as for now an extension can run
 *     eval itself and pretty much all of this is no-op till we have extension sandbox. So this is not the security
 *     model now.
 */
define("MacroRunner", function (require, exports, module) {
    const FileViewController = brackets.getModule("project/FileViewController"),
        CommandManager = brackets.getModule("command/CommandManager"),
        EditorManager = brackets.getModule("editor/EditorManager"),
        KeyEvent = brackets.getModule("utils/KeyEvent"),
        Commands = brackets.getModule("command/Commands"),
        FileSystem = brackets.getModule("filesystem/FileSystem"),
        MainViewManager = brackets.getModule("view/MainViewManager"),
        FileUtils   = brackets.getModule("file/FileUtils"),
        PreferencesManager  = brackets.getModule("preferences/PreferencesManager"),
        Editor = brackets.getModule("editor/Editor"),
        Dialogs = brackets.getModule("widgets/Dialogs"),
        _ = brackets.getModule("thirdparty/lodash"),
        ProjectManager = brackets.getModule("project/ProjectManager");

    /**
     * Open a project relative file or absolute file path. if no leading slash, path is assumed to be project relative
     * @param filePath
     * @returns {Promise<null>}
     */
    function openFile(filePath) {
        if(filePath.startsWith('/')) {
            return jsPromise(FileViewController.openFileAndAddToWorkingSet(filePath));
        }
        const projectFilePath = path.join(ProjectManager.getProjectRoot().fullPath, filePath);
        return jsPromise(FileViewController.openFileAndAddToWorkingSet(projectFilePath));
    }

    /**
     * Reads a text file and returns a promise that resolves to the text
     * @param filePath - project relative or full path
     * @param {boolean?} bypassCache - an optional argument, if specified will read from disc instead of using cache.
     * @returns {Promise<String>}
     */
    function readTextFile(filePath, bypassCache) {
        if(!filePath.startsWith('/')) {
            filePath = path.join(ProjectManager.getProjectRoot().fullPath, filePath);
        }
        const file = FileSystem.getFileForPath(filePath);
        return jsPromise(FileUtils.readAsText(file, bypassCache));
    }

    /**
     * Asynchronously writes a file as UTF-8 encoded text.
     * @param filePath - project relative or full path
     * @param {String} text
     * @param {boolean} allowBlindWrite Indicates whether or not CONTENTS_MODIFIED
     *      errors---which can be triggered if the actual file contents differ from
     *      the FileSystem's last-known contents---should be ignored.
     * @return {Promise<null>} promise that will be resolved when
     * file writing completes, or rejected with a FileSystemError string constant.
     */
    function writeTextFile(filePath, text, allowBlindWrite) {
        if(!filePath.startsWith('/')) {
            filePath = path.join(ProjectManager.getProjectRoot().fullPath, filePath);
        }
        const file = FileSystem.getFileForPath(filePath);
        return jsPromise(FileUtils.writeText(file, text, allowBlindWrite));
    }

    /**
     * deletes a file or dir at given path
     * @param filePath - project relative or full path
     * @return {Promise<null>} promise that will be resolved when path removed
     */
    function deletePath(filePath) {
        if(!filePath.startsWith('/')) {
            filePath = path.join(ProjectManager.getProjectRoot().fullPath, filePath);
        }
        return new Promise((resolve, reject) => {
            window.fs.unlink(filePath, (err)=>{
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }


    /**
     * Set cursor positions or text selections in the active CodeMirror editor based on a specified format.
     * The input should be an array of strings where each string can denote a cursor position ("line:char")
     * or a text selection range ("line:char-line:char"). For a selection, the first part is the anchor and
     * the second is the head of the selection.
     *
     * Example usage: ["1:2", "2:2-3:4"]
     *
     * @param {Array<string>} selections - An array of strings defining cursor positions or selection ranges.
     * @throws {Error} Throws an error if no active editor is found or if there are parsing issues with the input.
     */
    function setCursors(selections) {
        const activeEditor = EditorManager.getActiveEditor();
        if(!activeEditor){
            throw new Error(`No active editor found to set cursor at: ${selections}`);
        }
        // Parse the selection strings to CodeMirror positions
        const parsedSelections = selections.map(selection => {
            const parts = selection.split('-');
            if (parts.length === 1) {
                const [line, ch] = parts[0].split(':').map(Number);
                if (isNaN(line) || isNaN(ch)) {
                    throw new Error(`Invalid cursor format: ${parts[0]} for ${selections}`);
                }
                return {start: {line: line - 1, ch: ch - 1}, end: {line: line - 1, ch: ch - 1}};
            } else if (parts.length === 2) {
                const [fromLine, fromCh] = parts[0].split(':').map(Number);
                const [toLine, toCh] = parts[1].split(':').map(Number);
                if (isNaN(fromLine) || isNaN(fromCh) || isNaN(toLine) || isNaN(toCh)) {
                    throw new Error(`Invalid selection range format: ${selection}`);
                }
                return {start: {line: fromLine - 1, ch: fromCh -1}, end: {line: toLine - 1, ch: toCh - 1}};
            } else {
                throw new Error(`Invalid format: ${selection}`);
            }
        });

        // Set the selections in the editor
        activeEditor.setSelections(parsedSelections);
    }

    /**
     * gets cursor selections array that can be used in the setCursors API
     * @param editor
     * @returns {*}
     */
    function computeCursors(editor, addQuotes) {
        const selections = editor.getSelections();
        return selections.map(selection => {
            const start = selection.start;
            const end = selection.end;
            let cursor;

            // Check if the selection is a cursor (start and end are the same)
            if (start.line === end.line && start.ch === end.ch) {
                cursor = `${start.line + 1}:${start.ch + 1}`;
            } else {
                cursor = `${start.line + 1}:${start.ch + 1}-${end.line + 1}:${end.ch + 1}`;
            }
            return addQuotes ? `"${cursor}"` : cursor;
        });
    }

    /**
     * Validates the currently active editor has selections as given here
     */
    function expectCursorsToBe(expectedSelections) {
        const activeEditor = EditorManager.getActiveEditor();
        if(!activeEditor){
            throw new Error(`No active editor found for expectCursorsToBe: ${expectedSelections}`);
        }
        const currentSelections = computeCursors(activeEditor);
        if(currentSelections.length !== expectedSelections.length) {
            throw new Error(`expectCursorsToBe: [${expectedSelections.join(", ")}] `+
             `but got [${currentSelections.join(", ")}]`);
        }
        for(let i = 0; i < currentSelections.length; i++) {
            if(!currentSelections.includes(`${expectedSelections[i]}`) ||
                !expectedSelections.includes(currentSelections[i])){
                throw new Error(`expectCursorsToBe: [${expectedSelections.join(", ")}] `+
                    `but got [${currentSelections.join(", ")}]`);
            }
        }
    }

    /**
     * Simulate a key event.
     * @param {Number} key Key code available as One of the KeyEvent.DOM_VK_*
     * @param {String} event Key event to simulate. one of keydown, keyup or keypress
     * @param {HTMLElement} element Element to receive event
     * @param {KeyboardEventInit} options Optional arguments for key event
     */
    function raiseKeyEvent(key, event, element, options) {
        const doc = element.ownerDocument;

        if(typeof options === 'undefined') {
            options = {
                view: doc.defaultView,
                bubbles: true,
                cancelable: true,
                keyIdentifer: key
            };
        } else {
            options.view = doc.defaultView;
            options.bubbles = true;
            options.cancelable = true;
            options.keyIdentifier = key;
        }
        const oEvent = new KeyboardEvent(event, options);

        if (event !== "keydown" && event !== "keyup" && event !== "keypress") {
            console.log("SpecRunnerUtils.simulateKeyEvent() - unsupported keyevent: " + event);
            return;
        }

        // Chromium Hack: need to override the 'which' property.
        // Note: this code is not designed to work in IE, Safari,
        // or other browsers. Well, maybe with Firefox. YMMV.
        Object.defineProperty(oEvent, 'keyCode', {
            get: function () {
                return this.keyCodeVal;
            }
        });
        Object.defineProperty(oEvent, 'which', {
            get: function () {
                return this.keyCodeVal;
            }
        });
        Object.defineProperty(oEvent, 'charCode', {
            get: function () {
                return this.keyCodeVal;
            }
        });

        oEvent.keyCodeVal = key;
        if (oEvent.keyCode !== key) {
            console.log("SpecRunnerUtils.simulateKeyEvent() - keyCode mismatch: " + oEvent.keyCode);
        }

        element.dispatchEvent(oEvent);
    }

    /**
     * @param {Array<string>} keysArray An array of Key strings available as One of the KeyEvent.DOM_VK_* without the
     *    `KeyEvent.DOM_VK_` prefix. Eg: use `["ESCAPE"]` instead of fully specifying [`DOM_VK_ESCAPE`]
     *    E.g: __PR.keydown(["BACK_SPACE"]) or __PR.keydown(["BACK_SPACE"], {ctrlKey: true})
     * @param {object} modifiers to modify the key
     * @param {boolean} modifiers.ctrlKey
     * @param {boolean} modifiers.altKey
     * @param {boolean} modifiers.shiftKey
     * @param {boolean} modifiers.metaKey
     * @param keysArray
     */
    function keydown(keysArray, modifiers) {
        for(let key of keysArray) {
            if(typeof key === "string"){
                if(!key.startsWith("DOM_VK_")){
                    key = "DOM_VK_"+key;
                }
                key = KeyEvent[key];
                if(!key){
                    throw new Error(`Invalid key "${key}"`);
                }
            }
            raiseKeyEvent(key, "keydown", document.activeElement, modifiers);
        }
    }

    function typeAtCursor(text, origin) {
        const activeEditor = EditorManager.getActiveEditor();
        if(!activeEditor){
            throw new Error(`No active editor found to typeAtCursor: ${text}`);
        }
        const selections = activeEditor.getSelections();
        // Insert text at each cursor or the head of each selection.
        // We perform the insertions in reverse order to avoid affecting the indices of subsequent insertions.
        for (let selection of selections) {
            activeEditor.replaceRange(text, selection.start, selection.end, origin);
        }
    }

    // converts string of from "ln:ch" to pos object
    function _toPos(posString) {
        const pos = posString.split(":");
        return {line: Number(pos[0]) - 1, ch: Number(pos[1]) - 1 };
    }

    /**
     * Verify if the given text is same as what is in between the given selection.
     * @param {string} text
     * @param {string} selection of the form "ln:ch-ln:ch"
     */
    function validateText(text, selection) {
        const activeEditor = EditorManager.getActiveEditor();
        if(!activeEditor){
            throw new Error(`No active editor found to validateText: ${text} at selection ${selection}`);
        }
        const from = selection.split("-")[0], to = selection.split("-")[1];
        const selectedText = activeEditor.getTextBetween(_toPos(from), _toPos(to));
        if(selectedText !== text){
            throw new Error(`validateText: expected text at [${selection}] to be "${text}" but got "${selectedText}"`);
        }
    }

    function _getMarkLocations(markType, whichAPI, selections) {
        const activeEditor = EditorManager.getActiveEditor();
        if(!activeEditor){
            throw new Error(`No active editor found to ${whichAPI}: "${markType}" for selection "${selections}"`);
        }
        const marks = activeEditor.getAllMarks(markType);
        const marksLocations = [];
        for(let mark of marks){
            const loc = mark.find();
            marksLocations.push(`${loc.from.line+1}:${loc.from.ch+1}-${loc.to.line+1}:${loc.to.ch+1}`);
        }
        return marksLocations;
    }

    /**
     * validates all marks of the given mark type
     * @param {string} markType
     * @param {Array<string>} selections - An array of strings defining cursor positions or selection ranges.
     */
    function validateAllMarks(markType, selections) {
        const marksLocations = _getMarkLocations(markType, "validateAllMarks", selections);
        if(!selections || marksLocations.length !== selections.length){
            throw new Error(`validateAllMarks expected marks "${markType}" at: [${selections&&selections.join(", ")}] `+
                `but got marked locations [${marksLocations.join(", ")}]`);
        }
        for(let i = 0; i < selections.length; i++) {
            if(!selections.includes(`${marksLocations[i]}`) ||
                !marksLocations.includes(selections[i])){
                throw new Error(`validateAllMarks expected marks "${markType}" at: [${selections.join(", ")}] `+
                    `but got marked locations [${marksLocations.join(", ")}]`);
            }
        }
    }

    function validateEqual(obj1, obj2, message = "") {
        if(!_.isEqual(obj1, obj2)){
            throw new Error(`validateEqual: ${ message ? message + "\n" : ""
            } expected ${JSON.stringify(obj1)} to equal ${JSON.stringify(obj2)}`);
        }
    }

    function validateNotEqual(obj1, obj2) {
        if(_.isEqual(obj1, obj2)){
            throw new Error(`validateEqual: expected ${JSON.stringify(obj1)} to NOT equal ${JSON.stringify(obj2)}`);
        }
    }

    /**
     * validates if the given mark type is present in the specified selections
     * @param {string} markType
     * @param {Array<string>} selections - An array of strings defining cursor positions or selection ranges.
     * @param {number} [totalMarkCount] optional to validate against the total number of expected marks of the type
     */
    function validateMarks(markType, selections, totalMarkCount) {
        const marksLocations = _getMarkLocations(markType, "validateMarks", selections);
        if(!selections){
            return;
        }
        if(totalMarkCount !== undefined && marksLocations.length !== totalMarkCount){
            throw new Error(`validateMarks expected mark count for "${markType}" to be: ${totalMarkCount} `+
                `but got ${marksLocations.length}`);
        }
        for(let selection of selections) {
            if(!marksLocations.includes(selection)){
                throw new Error(`validateMarks expected marks "${markType}" to be at: [${selections.join(", ")}] `+
                    `but got marked locations [${marksLocations.join(", ")}]`);
            }
        }
    }

    function closeFile() {
        return jsPromise(CommandManager.execute(Commands.FILE_CLOSE, { _forceClose: true }));
    }

    function closeAll() {
        return jsPromise(CommandManager.execute(Commands.FILE_CLOSE_ALL, { _forceClose: true }));
    }

    function execCommand(commandID, arg) {
        return jsPromise(CommandManager.execute(commandID, arg));
    }

    function undo() {
        return execCommand(Commands.EDIT_UNDO);
    }

    function redo() {
        return execCommand(Commands.EDIT_REDO);
    }

    function setPreference(key, value){
        PreferencesManager.set(key, value);
    }

    function getPreference(key){
        return PreferencesManager.get(key);
    }

    // Helper function to get full path (reusing existing openFile logic)
    function _getFullPath(filePath) {
        if(filePath.startsWith('/')) {
            return filePath;
        }
        return path.join(ProjectManager.getProjectRoot().fullPath, filePath);
    }

    const EDITING = {
        setEditorSpacing: function (useTabs, spaceOrTabCount, isAutoMode) {
            const activeEditor = EditorManager.getActiveEditor();
            if(!activeEditor){
                throw new Error(`No active editor found to setEditorSpacing`);
            }
            const fullPath = activeEditor.document.file.fullPath;
            if(Editor.Editor.getAutoTabSpaces(fullPath) !== isAutoMode){
                Editor.Editor.setAutoTabSpaces(isAutoMode, fullPath);
                isAutoMode && Editor.Editor._autoDetectTabSpaces(activeEditor, true, true);
            }
            Editor.Editor.setUseTabChar(useTabs, fullPath);
            if(useTabs) {
                Editor.Editor.setTabSize(spaceOrTabCount, fullPath);
            } else {
                Editor.Editor.setSpaceUnits(spaceOrTabCount, fullPath);
            }
        },
        /**
         * Split the editor pane vertically
         */
        splitVertical: function() {
            CommandManager.execute(Commands.CMD_SPLITVIEW_VERTICAL);
        },

        /**
         * Split the editor pane horizontally
         */
        splitHorizontal: function() {
            CommandManager.execute(Commands.CMD_SPLITVIEW_HORIZONTAL);
        },

        /**
         * Remove split pane and return to single pane view
         */
        splitNone: function() {
            CommandManager.execute(Commands.CMD_SPLITVIEW_NONE);
        },
        /**
         * Gets the editor in the first pane (left/top)
         * @return {?Editor} The editor in first pane or null if not available
         */
        getFirstPaneEditor: function() {
            return MainViewManager.getCurrentlyViewedEditor("first-pane");
        },

        /**
         * Gets the editor in the second pane (right/bottom)
         * @return {?Editor} The editor in second pane or null if not available
         */
        getSecondPaneEditor: function() {
            return MainViewManager.getCurrentlyViewedEditor("second-pane");
        },

        /**
         * Checks if the view is currently split
         * @return {boolean} True if view is split, false otherwise
         */
        isSplit: function() {
            return MainViewManager.getPaneCount() > 1;
        },
        /**
         * Opens a file in the first pane (left/top)
         * @param {string} filePath - Project relative or absolute file path
         * @returns {Promise} A promise that resolves when the file is opened
         */
        openFileInFirstPane: function(filePath) {
            return jsPromise(CommandManager.execute(Commands.FILE_OPEN, {
                fullPath: _getFullPath(filePath),
                paneId: "first-pane"
            }));
        },

        /**
         * Opens a file in the second pane (right/bottom)
         * @param {string} filePath - Project relative or absolute file path
         * @returns {Promise} A promise that resolves when the file is opened
         */
        openFileInSecondPane: function(filePath) {
            return jsPromise(CommandManager.execute(Commands.FILE_OPEN, {
                fullPath: _getFullPath(filePath),
                paneId: "second-pane"
            }));
        },
        /**
         * Focus the first pane (left/top)
         */
        focusFirstPane: function() {
            MainViewManager.setActivePaneId("first-pane");
        },

        /**
         * Focus the second pane (right/bottom)
         */
        focusSecondPane: function() {
            MainViewManager.setActivePaneId("second-pane");
        }
    };

    /**
     * Waits for a polling function to succeed or until a timeout is reached.
     * The polling function is periodically invoked to check for success, and
     * the function rejects with a timeout message if the timeout duration elapses.
     *
     * @param {function} pollFn - A function that returns `true` or a promise resolving to `true`/`false`
     *                            to indicate success and stop waiting.
     *                            The function will be called repeatedly until it succeeds or times out.
     * @param {string|function} _timeoutMessageOrMessageFn - A helpful string message or an async function
     *                                                       that returns a string message to reject with in case of timeout.
     *                                                       Example:
     *                                                       - String: "Condition not met within the allowed time."
     *                                                       - Function: `async () => "Timeout while waiting for the process to complete."`
     * @param {number} [timeoutms=2000] - The maximum time to wait in milliseconds before timing out. Defaults to 2 seconds.
     * @param {number} [pollInterval=10] - The interval in milliseconds at which `pollFn` is invoked. Defaults to 10ms.
     * @returns {Promise<void>} A promise that resolves when `pollFn` succeeds or rejects with a timeout message.
     *
     * @throws {Error} If `timeoutms` or `pollInterval` is not a number.
     *
     * @example
     * // Example 1: Using a string as the timeout message
     * awaitsFor(
     *   () => document.getElementById("element") !== null,
     *   "Element did not appear within the allowed time.",
     *   5000,
     *   100
     * ).then(() => {
     *   console.log("Element appeared!");
     * }).catch(err => {
     *   console.error(err.message);
     * });
     *
     * @example
     * // Example 2: Using a function as the timeout message
     * awaitsFor(
     *  () => document.getElementById("element") !== null,
     *   async () => {
     *     const el = document.getElementById("element");
     *     return `expected ${el} to be null`;
     *   },
     *   10000,
     *   500
     * ).then(() => {
     *   console.log("Element appeared!");
     * }).catch(err => {
     *   console.error(err.message);
     * });
     */
    function awaitsFor(pollFn, _timeoutMessageOrMessageFn, timeoutms = 2000, pollInterval = 10){
        if(typeof  _timeoutMessageOrMessageFn === "number"){
            timeoutms = _timeoutMessageOrMessageFn;
            pollInterval = timeoutms;
        }
        if(!(typeof  timeoutms === "number" && typeof  pollInterval === "number")){
            throw new Error("awaitsFor: invalid parameters when awaiting for " + _timeoutMessageOrMessageFn);
        }

        async function _getExpectMessage(_timeoutMessageOrMessageFn) {
            try{
                if(typeof _timeoutMessageOrMessageFn === "function") {
                    _timeoutMessageOrMessageFn = _timeoutMessageOrMessageFn();
                    if(_timeoutMessageOrMessageFn instanceof Promise){
                        _timeoutMessageOrMessageFn = await _timeoutMessageOrMessageFn;
                    }
                }
            } catch (e) {
                _timeoutMessageOrMessageFn = "Error executing expected message function:" + e.stack;
            }
            return _timeoutMessageOrMessageFn;
        }

        function _timeoutPromise(promise, ms) {
            const timeout = new Promise((_, reject) => {
                setTimeout(async () => {
                    _timeoutMessageOrMessageFn = await _getExpectMessage(_timeoutMessageOrMessageFn);
                    reject(new Error(_timeoutMessageOrMessageFn || `Promise timed out after ${ms}ms`));
                }, ms);
            });

            return Promise.race([promise, timeout]);
        }

        return new Promise((resolve, reject)=>{
            let startTime = Date.now(),
                lapsedTime;
            async function pollingFn() {
                try{
                    let result = pollFn();

                    // If pollFn returns a promise, await it
                    if (Object.prototype.toString.call(result) === "[object Promise]") {
                        // we cant simply check for result instanceof Promise as the Promise may be returned from
                        // an iframe and iframe has a different instance of Promise than this js context.
                        result = await _timeoutPromise(result, timeoutms);
                    }

                    if (result) {
                        resolve();
                        return;
                    }
                    lapsedTime = Date.now() - startTime;
                    if(lapsedTime>timeoutms){
                        _timeoutMessageOrMessageFn = await _getExpectMessage(_timeoutMessageOrMessageFn);
                        reject("awaitsFor timed out waiting for - " + _timeoutMessageOrMessageFn);
                        return;
                    }
                    setTimeout(pollingFn, pollInterval);
                } catch (e) {
                    reject(e);
                }
            }
            pollingFn();
        });
    }

    async function waitForModalDialog(dialogClass, friendlyName, timeout = 2000) {
        dialogClass = dialogClass || "";
        friendlyName = friendlyName || dialogClass || "Modal Dialog";
        await awaitsFor(()=>{
            let $dlg = $(`.modal.instance${dialogClass}`);
            return $dlg.length >= 1;
        }, `Waiting for Modal Dialog to show ${friendlyName}`, timeout);
    }

    async function waitForModalDialogClosed(dialogClass, friendlyName, timeout = 2000) {
        dialogClass = dialogClass || "";
        friendlyName = friendlyName || dialogClass || "Modal Dialog";
        await awaitsFor(()=>{
            let $dlg = $(`.modal.instance${dialogClass}`);
            return $dlg.length === 0;
        }, `Waiting for Modal Dialog to not there ${friendlyName}`, timeout);
    }

    /** Clicks on a button within a specified dialog.
     * This function identifies a dialog using its class and locates a button either by its selector or button ID.
     * Validation to ensure the dialog and button exist and that the button is enabled before attempting to click.
     *
     * @param {string} selectorOrButtonID - The selector or button ID to identify the button to be clicked.
     *                                       Example (as selector): ".my-button-class".
     *                                       Example (as button ID): "ok".
     * @param {string} dialogClass - The class of the dialog (optional). If omitted, defaults to an empty string.
     *                               Example: "my-dialog-class".
     * @param {boolean} isButtonID - If `true`, `selectorOrButtonid` is treated as a button ID.
     *                                If `false`, it is treated as a jQuery selector. Default is `false`.
     *
     * @throws {Error} Throws an error if:
     *   - The specified dialog does not exist.
     *   - Multiple buttons match the given selector or ID.
     *   - No button matches the given selector or ID.
     *   - The button is disabled and cannot be clicked.
     *
     */
    function _clickDialogButtonWithSelector(selectorOrButtonID, dialogClass, isButtonID) {
        dialogClass = dialogClass || "";
        const $dlg = $(`.modal.instance${dialogClass}`);

        if(!$dlg.length){
            throw new Error(`No such dialog present: "${dialogClass}"`);
        }

        const $button = isButtonID ?
            $dlg.find(".dialog-button[data-button-id='" + selectorOrButtonID + "']") :
            $dlg.find(selectorOrButtonID);
        if($button.length > 1){
            throw new Error(`Multiple button in dialog "${selectorOrButtonID}"`);
        } else if(!$button.length){
            throw new Error(`No such button in dialog "${selectorOrButtonID}"`);
        }

        if($button.prop("disabled")) {
            throw new Error(`Cannot click, button is disabled. "${selectorOrButtonID}"`);
        }

        $button.click();
    }

    /**
     * Clicks on a button within a specified dialog using its button ID.
     *
     * @param {string} buttonID - The unique ID of the button to be clicked. usually One of the
     *                            __PR.Dialogs.DIALOG_BTN_* symbolic constants or a custom id. You can find the button
     *                            id in the dialog by inspecting the button and checking its `data-button-id` attribute
     *                            Example: __PR.Dialogs.DIALOG_BTN_OK.
     * @param {string} [dialogClass] - The class of the dialog containing the button. Optional, if only one dialog
     *                               is present, you can omit this.
     *                               Example: "my-dialog-class".
     * @throws {Error} Throws an error if:
     *   - The specified dialog does not exist.
     *   - No button matches the given button ID.
     *   - Multiple buttons match the given button ID.
     *   - The button is disabled and cannot be clicked.
     *
     * @example
     * // Example: Click a button by its ID
     * __PR.clickDialogButtonID(__PR.Dialogs.DIALOG_BTN_OK, "my-dialog-class");
     * __PR.clickDialogButtonID(__PR.Dialogs.DIALOG_BTN_OK); // if only 1 dialog is present, can omit the dialog class
     * __PR.clickDialogButtonID("customBtnID", "my-dialog-class");
     */
    function clickDialogButtonID(buttonID, dialogClass) {
        _clickDialogButtonWithSelector(buttonID, dialogClass, true);
    }

    /**
     * Clicks on a button within a specified dialog using a selector.
     *
     * @param {string} buttonSelector - A jQuery selector to identify the button to be clicked.
     *                                   Example: ".showImageBtn".
     * @param {string} [dialogClass] - The class of the dialog containing the button. Optional, if only one dialog
     *                               is present, you can omit this.
     *                               Example: "my-dialog-class".
     * @throws {Error} Throws an error if:
     *   - The specified dialog does not exist.
     *   - No button matches the given selector.
     *   - Multiple buttons match the given selector.
     *   - The button is disabled and cannot be clicked.
     *
     * @example
     * // Example: Click a button using a selector
     * __PR.clickDialogButton(".showImageBtn", "my-dialog-class");
     * __PR.clickDialogButton(".showImageBtn"); // if only 1 dialog is present, can omit the dialog class
     */
    function clickDialogButton(buttonSelector, dialogClass) {
        _clickDialogButtonWithSelector(buttonSelector, dialogClass, false);
    }

    /**
     * Saves the currently active file
     * @returns {Promise<void>} A promise that resolves when file is saved to disc
     */
    function saveActiveFile() {
        return jsPromise(CommandManager.execute(Commands.FILE_SAVE));
    }

    const __PR= {
        readTextFile, writeTextFile, deletePath,
        openFile, setCursors, expectCursorsToBe, keydown, typeAtCursor, validateText, validateAllMarks, validateMarks,
        closeFile, closeAll, undo, redo, setPreference, getPreference, validateEqual, validateNotEqual, execCommand,
        saveActiveFile,
        awaitsFor, waitForModalDialog, waitForModalDialogClosed, clickDialogButtonID, clickDialogButton,
        EDITING, $, Commands, Dialogs
    };

    async function runMacro(macroText) {
        let errors = [];
        try{
            const AsyncFunction = async function () {}.constructor;
            const macroAsync = new AsyncFunction("__PR", "KeyEvent", macroText);
            await macroAsync(__PR, KeyEvent);
        } catch (e) {
            console.error("Error executing macro: ", macroText, e);
            errors.push({
                lineNo: 0, line: '',
                errorCode: `ERROR_EXEC`,
                errorText: `${e}`
            });
        }
        return errors;
    }

    if(Phoenix.isTestWindow) {
        window.__PR = __PR;
    }
    exports.computeCursors = computeCursors;
    exports.runMacro = runMacro;
});

/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2012 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

/*globals path, logger*/

define("extensionDevelopment", function (require, exports, module) {
    const ProjectManager         = brackets.getModule("project/ProjectManager"),
        Commands                 = brackets.getModule("command/Commands"),
        CommandManager           = brackets.getModule("command/CommandManager"),
        Strings                  = brackets.getModule("strings"),
        StringUtils              = brackets.getModule("utils/StringUtils"),
        DocumentManager          = brackets.getModule("document/DocumentManager"),
        DefaultDialogs           = brackets.getModule("widgets/DefaultDialogs"),
        Dialogs                  = brackets.getModule("widgets/Dialogs"),
        UrlParams                = brackets.getModule("utils/UrlParams").UrlParams,
        FileSystem               = brackets.getModule("filesystem/FileSystem");

    function _showError(message, title = Strings.ERROR_LOADING_EXTENSION) {
        Dialogs.showModalDialog(
            DefaultDialogs.DIALOG_ID_ERROR,
            title, message
        );
    }

    function _validatePackageJson(docText) {
        try {
            let packageJson = JSON.parse(docText);
            let requiredFields = ["name", "title", "description", "homepage", "version", "author", "license",
                "engines"];
            let missingFields = [];
            for(let requiredField of requiredFields){
                if(!packageJson[requiredField]){
                    missingFields.push(requiredField);
                }
            }
            if(packageJson.engines && !packageJson.engines.brackets){
                missingFields.push(`engines:{"brackets": ">=2.0.0"}`);
            }
            if(missingFields.length){
                _showError(StringUtils.format(Strings.ERROR_INVALID_EXTENSION_PACKAGE_FIELDS, missingFields));
                return false;
            }
            return true;
        } catch (e) {
            console.log("Cannot load extension", Strings.ERROR_INVALID_EXTENSION_PACKAGE);
            _showError(Strings.ERROR_INVALID_EXTENSION_PACKAGE);
            return false;
        }
    }

    function loadCurrentExtension() {
        const projectRoot = ProjectManager.getProjectRoot().fullPath;
        const file = FileSystem.getFileForPath(projectRoot + "package.json");
        DocumentManager.getDocumentText(file).done(function (docText) {
            console.log(docText);
            if(!_validatePackageJson(docText)){
                return;
            }
            CommandManager.execute(Commands.APP_RELOAD, false, projectRoot);
        }).fail((err)=>{
            console.log("No extension package.json in ", file.fullPath, err);
            Dialogs.showModalDialog(
                DefaultDialogs.DIALOG_ID_ERROR,
                Strings.ERROR_LOADING_EXTENSION,
                Strings.ERROR_NO_EXTENSION_PACKAGE
            );
        });
    }

    function unloadCurrentExtension() {
        CommandManager.execute(Commands.APP_RELOAD, false, []);
    }

    function isProjectLoadedAsExtension() {
        const params  = new UrlParams();

        // Make sure the Reload Without User Extensions parameter is removed
        params.parse();
        return !!params.get("loadDevExtensionPath");
    }

    exports.loadCurrentExtension = loadCurrentExtension;
    exports.unloadCurrentExtension = unloadCurrentExtension;
    exports.isProjectLoadedAsExtension = isProjectLoadedAsExtension;
});

/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

/*globals path*/

define("testBuilder", function (require, exports, module) {
    const AppInit = brackets.getModule("utils/AppInit"),
        DocumentManager = brackets.getModule("document/DocumentManager"),
        EditorManager = brackets.getModule("editor/EditorManager"),
        FileSystem = brackets.getModule("filesystem/FileSystem"),
        Editor = brackets.getModule("editor/Editor"),
        Dialogs = brackets.getModule("widgets/Dialogs"),
        CommandManager = brackets.getModule("command/CommandManager"),
        Commands = brackets.getModule("command/Commands"),
        WorkspaceManager = brackets.getModule("view/WorkspaceManager"),
        MacroRunner = require("./MacroRunner");

    const BUILD_SCRATCH_FILE = path.join(brackets.app.getApplicationSupportDirectory(), "testBuilder.js");
    let builderPanel, $panel, builderEditor;

    function toggleTestBuilder() {
        if(!$panel){
            $panel = $(panelHTML);
            builderPanel = WorkspaceManager.createBottomPanel("phcode-test-builder-panel", $panel, 100);
            builderPanel.hide();
            _setupPanel().then(()=>{
                builderPanel.setVisible(!builderPanel.isVisible());
            });
            return;
        }
        builderPanel.setVisible(!builderPanel.isVisible());
    }
    const panelHTML = `
<div id="test-builder-panel-phcode" class="bottom-panel vert-resizable top-resizer">
    <div class="toolbar" style="display: flex; justify-content: space-between;">
      <div style="display: flex">
         <div class="title">Test Builder</div>
         <button class="btn btn-mini no-focus save-test-builder">Save</button>
         <button class="btn btn-mini primary no-focus run-test-builder">Run</button>
         <button class="btn btn-mini no-focus run-selected">Run Selected</button>
      </div>
      <div>
         <button class="btn btn-mini no-focus mark-validate" title="Validate marks at cursor">Marks</button>
         <button class="btn btn-mini no-focus cursor-locate">cursor</button>
         <button class="btn btn-mini no-focus text-validate" title="validate text" style="margin-right: 20px;">
            Text</button>
         <a href="#" class="close" style="right: 0;margin-right: 10px;">&times;</a>
      </div>  
    </div>
    <div style="display: flex; height: 100%; overflow: scroll;">
<!--27 px is status bar height. If this is not set, the preview code mirror editor gives weird layout issues at times-->
        <div class="test_builder-editor" style="width: 100%; height: 100%;"></div>
    </div>
</div>`;

    function saveFile() {
        return new Promise((resolve, reject) => {
            CommandManager.execute(Commands.FILE_SAVE,
                {doc: builderEditor.document})
                .done(resolve)
                .fail(function (openErr) {
                    console.error("error saving test builder file: ", BUILD_SCRATCH_FILE, openErr);
                    reject();
                });
        });
    }

    async function runTests(macroText) {
        saveFile();
        const errors = await MacroRunner.runMacro(macroText || builderEditor.document.getText());
        if(errors.length) {
            let errorHTML = "";
            for (let error of errors) {
                errorHTML += `${error.errorText}<br>`;
            }
            Dialogs.showErrorDialog("Error running macro: ", errorHTML);
        }
    }

    function runSelection() {
        return runTests(builderEditor.getSelectedText());
    }

    function _locateCursor() {
        const editor = EditorManager.getActiveEditor();
        if(!editor) {
            return;
        }
        const formattedSelections = MacroRunner.computeCursors(editor, true);
        builderEditor.replaceRange(`\n__PR.setCursors([${formattedSelections.join(", ")}]);`,
            builderEditor.getCursorPos());
        editor.focus();
    }

    function _validateText() {
        const editor = EditorManager.getActiveEditor();
        if(!editor) {
            return;
        }
        const selection = editor.getSelection();
        const start = selection.start, end = selection.end;
        const selectionText = `${start.line+1}:${start.ch+1}-${end.line+1}:${end.ch+1}`;
        let quotedString = editor.getSelectedText().replaceAll("\n", "\\n");
        builderEditor.replaceRange(`\n__PR.validateText(\`${quotedString}\`, "${selectionText}");`,
            builderEditor.getCursorPos());
        editor.focus();
    }

    function _validateMarks(){
        const editor = EditorManager.getActiveEditor();
        if(!editor) {
            return;
        }
        const marks = editor.findMarksAt(editor.getCursorPos()).filter(mark => mark.markType);
        const markTypeMap = {};
        for(let mark of marks){
            if(!markTypeMap[mark.markType]){
                markTypeMap[mark.markType] = [];
            }
            const loc = mark.find();
            markTypeMap[mark.markType].push(`"${loc.from.line+1}:${loc.from.ch+1}-${loc.to.line+1}:${loc.to.ch+1}"`);
        }
        for(let markType of Object.keys(markTypeMap)) {
            const selections = markTypeMap[markType];
            builderEditor.replaceRange(`\n__PR.validateMarks("${markType}", [${selections.join(", ")}]);`,
                builderEditor.getCursorPos());
        }
    }

    async function _setupPanel() {
        let file = FileSystem.getFileForPath(BUILD_SCRATCH_FILE);
        let isExists = await file.existsAsync();
        if(!isExists) {
            await new Promise(resolve => {
                file.write("", {blind: true}, resolve);
            });
        }
        DocumentManager.getDocumentForPath(BUILD_SCRATCH_FILE).done(function (doc) {
            const _$editor   = $panel.find(".test_builder-editor");
            builderEditor = new Editor.Editor(doc, false, _$editor, null, {});
            builderEditor.updateLayout();
        });
        new ResizeObserver(()=>{
            builderEditor && builderEditor.updateLayout();
        }).observe($panel[0]);

        $panel.find(".close").click(toggleTestBuilder);
        $panel.find(".save-test-builder").click(saveFile);
        $panel.find(".run-test-builder").click(()=>{
            runTests();
        });
        $panel.find(".run-selected").click(runSelection);
        $panel.find(".cursor-locate").click(_locateCursor);
        $panel.find(".text-validate").click(_validateText);
        $panel.find(".mark-validate").click(_validateMarks);
    }

    AppInit.appReady(function () {
        if(Phoenix.isTestWindow) {
            return;
        }
        $panel = $(panelHTML);
        builderPanel = WorkspaceManager.createBottomPanel("phcode-test-builder-panel", $panel, 100);
        builderPanel.hide();
        _setupPanel();
    });

    exports.toggleTestBuilder = toggleTestBuilder;
});
