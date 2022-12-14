/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2013 - 2021 Adobe Systems Incorporated. All rights reserved.
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

/*global jsPromise*/

/**
 * Manages linters and other code inspections on a per-language basis. Provides a UI and status indicator for
 * the resulting errors/warnings.
 *
 * Currently, inspection providers are only invoked on the current file and only when it is opened, switched to,
 * or saved. But in the future, inspectors may be invoked as part of a global scan, at intervals while typing, etc.
 * Currently, results are only displayed in a bottom panel list and in a status bar icon. But in the future,
 * results may also be displayed inline in the editor (as gutter markers, etc.).
 * In the future, support may also be added for error/warning providers that cannot process a single file at a time
 * (e.g. a full-project compiler).
 */
define(function (require, exports, module) {


    const _ = require("thirdparty/lodash");

    // Load dependent modules
    const Commands                = require("command/Commands"),
        WorkspaceManager        = require("view/WorkspaceManager"),
        CommandManager          = require("command/CommandManager"),
        DocumentManager         = require("document/DocumentManager"),
        EditorManager           = require("editor/EditorManager"),
        Editor                  = require("editor/Editor").Editor,
        MainViewManager         = require("view/MainViewManager"),
        LanguageManager         = require("language/LanguageManager"),
        PreferencesManager      = require("preferences/PreferencesManager"),
        PerfUtils               = require("utils/PerfUtils"),
        Strings                 = require("strings"),
        StringUtils             = require("utils/StringUtils"),
        AppInit                 = require("utils/AppInit"),
        StatusBar               = require("widgets/StatusBar"),
        Async                   = require("utils/Async"),
        PanelTemplate           = require("text!htmlContent/problems-panel.html"),
        ResultsTemplate         = require("text!htmlContent/problems-panel-table.html"),
        Mustache                = require("thirdparty/mustache/mustache"),
        QuickViewManager        = require("features/QuickViewManager");

    const CODE_INSPECTION_GUTTER_PRIORITY      = 500,
        CODE_INSPECTION_GUTTER = "code-inspection-gutter";

    const INDICATOR_ID = "status-inspection";

    /** Values for problem's 'type' property */
    const Type = {
        /** Unambiguous error, such as a syntax error */
        ERROR: "error",
        /** Maintainability issue, probable error / bad smell, etc. */
        WARNING: "warning",
        /** Inspector unable to continue, code too complex for static analysis, etc. Not counted in err/warn tally. */
        META: "meta"
    };

    function _getIconClassForType(type) {
        switch (type) {
        case Type.ERROR: return "line-icon-problem_type_error fa-solid fa-times-circle";
        case Type.WARNING: return "line-icon-problem_type_warning fa-solid fa-exclamation-triangle";
        case Type.META: return "line-icon-problem_type_info fa-solid fa-info-circle";
        default: return "line-icon-problem_type_info fa-solid fa-info-circle";
        }
    }

    const CODE_MARK_TYPE_INSPECTOR = "codeInspector";

    /**
     * Constants for the preferences defined in this file.
     */
    const PREF_ENABLED            = "enabled",
        PREF_COLLAPSED          = "collapsed",
        PREF_ASYNC_TIMEOUT      = "asyncTimeout",
        PREF_PREFER_PROVIDERS   = "prefer",
        PREF_PREFERRED_ONLY     = "usePreferredOnly";

    const prefs = PreferencesManager.getExtensionPrefs("linting");

    /**
     * When disabled, the errors panel is closed and the status bar icon is grayed out.
     * Takes precedence over _collapsed.
     * @private
     * @type {boolean}
     */
    var _enabled = false;

    /**
     * When collapsed, the errors panel is closed but the status bar icon is kept up to date.
     * @private
     * @type {boolean}
     */
    var _collapsed = false;

    /**
     * @private
     * @type {$.Element}
     */
    var $problemsPanel;

    /**
     * @private the panelView
     * @type {Panel}
     */
    var problemsPanel;

    /**
     * @private
     * @type {$.Element}
     */
    var $problemsPanelTable;

    /**
     * @private
     * @type {boolean}
     */
    var _gotoEnabled = false;

    /**
     * @private
     * @type {{languageId:string, Array.<{name:string, scanFileAsync:?function(string, string):!{$.Promise}, scanFile:?function(string, string):Object}>}}
     */
    var _providers = {};

    /**
     * @private
     * @type
     */
    let _registeredLanguageIDs = [];

    /**
     * @private
     * @type {boolean}
     */
    var _hasErrors;

    /**
     * Promise of the returned by the last call to inspectFile or null if linting is disabled. Used to prevent any stale promises
     * to cause updates of the UI.
     *
     * @private
     * @type {$.Promise}
     */
    var _currentPromise = null;

    /**
     * Enable or disable the "Go to First Error" command
     * @param {boolean} gotoEnabled Whether it is enabled.
     */
    function setGotoEnabled(gotoEnabled) {
        CommandManager.get(Commands.NAVIGATE_GOTO_FIRST_PROBLEM).setEnabled(gotoEnabled);
        _gotoEnabled = gotoEnabled;
    }

    function _unregisterAll() {
        _providers = {};
    }

    /**
     * Returns a list of provider for given file path, if available.
     * Decision is made depending on the file extension.
     *
     * @param {!string} filePath
     * @return {Array.<{name:string, scanFileAsync:?function(string, string):!{$.Promise}, scanFile:?function(string, string):?{errors:!Array, aborted:boolean}}>}
     */
    function getProvidersForPath(filePath) {
        var language            = LanguageManager.getLanguageForPath(filePath).getId(),
            context             = PreferencesManager._buildContext(filePath, language),
            installedProviders  = getProvidersForLanguageId(language),
            preferredProviders,

            prefPreferredProviderNames  = prefs.get(PREF_PREFER_PROVIDERS, context),
            prefPreferredOnly           = prefs.get(PREF_PREFERRED_ONLY, context),

            providers;

        if (prefPreferredProviderNames && prefPreferredProviderNames.length) {
            if (typeof prefPreferredProviderNames === "string") {
                prefPreferredProviderNames = [prefPreferredProviderNames];
            }
            preferredProviders = prefPreferredProviderNames.reduce(function (result, key) {
                var provider = _.find(installedProviders, {name: key});
                if (provider) {
                    result.push(provider);
                }
                return result;
            }, []);
            if (prefPreferredOnly) {
                providers = preferredProviders;
            } else {
                providers = _.union(preferredProviders, installedProviders);
            }
        } else {
            providers = installedProviders;
        }
        return providers;
    }

    /**
     * Returns an array of the IDs of providers registered for a specific language
     *
     * @param {!string} languageId
     * @return {Array.<string>} Names of registered providers.
     */
    function getProviderIDsForLanguage(languageId) {
        if (!_providers[languageId]) {
            return [];
        }
        return _providers[languageId].map(function (provider) {
            return provider.name;
        });
    }

    /**
     * Runs a file inspection over passed file. Uses the given list of providers if specified, otherwise uses
     * the set of providers that are registered for the file's language.
     * This method doesn't update the Brackets UI, just provides inspection results.
     * These results will reflect any unsaved changes present in the file if currently open.
     *
     * The Promise yields an array of provider-result pair objects (the result is the return value of the
     * provider's scanFile() - see register() for details). The result object may be null if there were no
     * errors from that provider.
     * If there are no providers registered for this file, the Promise yields null instead.
     *
     * @param {!File} file File that will be inspected for errors.
     * @param {?Array.<{name:string, scanFileAsync:?function(string, string):!{$.Promise}, scanFile:?function(string, string):?{errors:!Array, aborted:boolean}}>} providerList
     * @return {$.Promise} a jQuery promise that will be resolved with ?Array.<{provider:Object, result: ?{errors:!Array, aborted:boolean}}>
     */
    function inspectFile(file, providerList) {
        var response = new $.Deferred(),
            results = [];

        providerList = providerList || getProvidersForPath(file.fullPath);

        if (!providerList.length) {
            response.resolve(null);
            return response.promise();
        }

        DocumentManager.getDocumentText(file)
            .done(function (fileText) {
                var perfTimerInspector = PerfUtils.markStart("CodeInspection:\t" + file.fullPath),
                    masterPromise;

                masterPromise = Async.doInParallel(providerList, function (provider) {
                    var perfTimerProvider = PerfUtils.markStart("CodeInspection '" + provider.name + "':\t" + file.fullPath),
                        runPromise = new $.Deferred();

                    runPromise.done(function (scanResult) {
                        results.push({provider: provider, result: scanResult});
                    });

                    if (provider.scanFileAsync) {
                        window.setTimeout(function () {
                            // timeout error
                            var errTimeout = {
                                pos: { line: -1, col: 0},
                                message: StringUtils.format(Strings.LINTER_TIMED_OUT, provider.name, prefs.get(PREF_ASYNC_TIMEOUT)),
                                type: Type.ERROR
                            };
                            runPromise.resolve({errors: [errTimeout]});
                        }, prefs.get(PREF_ASYNC_TIMEOUT));
                        jsPromise(provider.scanFileAsync(fileText, file.fullPath))
                            .then(function (scanResult) {
                                PerfUtils.addMeasurement(perfTimerProvider);
                                runPromise.resolve(scanResult);
                            })
                            .catch(function (err) {
                                PerfUtils.finalizeMeasurement(perfTimerProvider);
                                var errError = {
                                    pos: {line: -1, col: 0},
                                    message: StringUtils.format(Strings.LINTER_FAILED, provider.name, err),
                                    type: Type.ERROR
                                };
                                console.error("[CodeInspection] Provider " + provider.name + " (async) failed: " + err.stack);
                                runPromise.resolve({errors: [errError]});
                            });
                    } else {
                        try {
                            var scanResult = provider.scanFile(fileText, file.fullPath);
                            PerfUtils.addMeasurement(perfTimerProvider);
                            runPromise.resolve(scanResult);
                        } catch (err) {
                            PerfUtils.finalizeMeasurement(perfTimerProvider);
                            var errError = {
                                pos: {line: -1, col: 0},
                                message: StringUtils.format(Strings.LINTER_FAILED, provider.name, err),
                                type: Type.ERROR
                            };
                            console.error("[CodeInspection] Provider " + provider.name + " (sync) threw an error: " + err.stack);
                            runPromise.resolve({errors: [errError]});
                        }
                    }
                    return runPromise.promise();

                }, false);

                masterPromise.then(function () {
                    // sync async may have pushed results in different order, restore the original order
                    results.sort(function (a, b) {
                        return providerList.indexOf(a.provider) - providerList.indexOf(b.provider);
                    });
                    PerfUtils.addMeasurement(perfTimerInspector);
                    response.resolve(results);
                });

            })
            .fail(function (err) {
                console.error("[CodeInspection] Could not read file for inspection: " + file.fullPath);
                response.reject(err);
            });

        return response.promise();
    }

    /**
     * Update the title of the problem panel and the tooltip of the status bar icon. The title and the tooltip will
     * change based on the number of problems reported and how many provider reported problems.
     *
     * @param {Number} numProblems - total number of problems across all providers
     * @param {Array.<{name:string, scanFileAsync:?function(string, string):!{$.Promise}, scanFile:?function(string, string):Object}>} providersReportingProblems - providers that reported problems
     * @param {boolean} aborted - true if any provider returned a result with the 'aborted' flag set
     */
    function updatePanelTitleAndStatusBar(numProblems, providersReportingProblems, aborted) {
        var message, tooltip;

        if (providersReportingProblems.length === 1) {
            // don't show a header if there is only one provider available for this file type
            $problemsPanelTable.find(".inspector-section").hide();
            $problemsPanelTable.find("tr").removeClass("forced-hidden");

            if (numProblems === 1 && !aborted) {
                message = StringUtils.format(Strings.SINGLE_ERROR, providersReportingProblems[0].name);
            } else {
                if (aborted) {
                    numProblems += "+";
                }

                message = StringUtils.format(Strings.MULTIPLE_ERRORS, providersReportingProblems[0].name, numProblems);
            }
        } else if (providersReportingProblems.length > 1) {
            $problemsPanelTable.find(".inspector-section").show();

            if (aborted) {
                numProblems += "+";
            }

            message = StringUtils.format(Strings.ERRORS_PANEL_TITLE_MULTIPLE, numProblems);
        } else {
            return;
        }

        $problemsPanel.find(".title").text(message);
        tooltip = StringUtils.format(Strings.STATUSBAR_CODE_INSPECTION_TOOLTIP, message);
        StatusBar.updateIndicator(INDICATOR_ID, true, "inspection-errors", tooltip);
    }

    function _getMarkOptions(error){
        switch (error.type) {
        case Type.ERROR: return Editor.MARK_OPTION_UNDERLINE_ERROR;
        case Type.WARNING: return Editor.MARK_OPTION_UNDERLINE_WARN;
        case Type.META: return Editor.MARK_OPTION_UNDERLINE_INFO;
        }
    }

    function _getMarkTypePriority(type){
        switch (type) {
        case Type.ERROR: return 3;
        case Type.WARNING: return 2;
        case Type.META: return 1;
        }
    }

    function _shouldMarkTokenAtPosition(editor, error) {
        if(isNaN(error.pos.line) || isNaN(error.pos.ch) || error.pos.line < 0 || error.pos.ch < 0){
            console.warn("CodeInspector: Invalid error position: ", error);
            return false;
        }
        // now we only apply a style if there is not already a higher priority style applied to it.
        // Ie. If an error style is applied, we don't apply an info style over it as error takes precedence.
        let markings = editor.findMarksAt(error.pos, CODE_MARK_TYPE_INSPECTOR);
        let MarkToApplyPriority = _getMarkTypePriority(error.type);
        let shouldMark = true;
        for(let mark of markings){
            let markTypePriority = _getMarkTypePriority(mark.type);
            if(markTypePriority<=MarkToApplyPriority){
                mark.clear();
            } else {
                // there's something with a higher priority marking the token
                shouldMark = false;
            }
        }
        return shouldMark;
    }

    /**
     * It creates a div element with a span element inside it, and then adds a click handler to move cursor to the
     * error position.
     * @param editor - the editor instance
     * @param line - the line number of the error
     * @param ch - the character position of the error
     * @param type - The type of the marker. This is a string that can be one of the error types
     * @param message - The message that will be displayed when you hover over the marker.
     * @returns A DOM element.
     */
    function _createMarkerElement(editor, line, ch, type, message) {
        let $marker = $('<div><span>')
            .attr('title', message)
            .addClass(CODE_INSPECTION_GUTTER);
        $marker.click(function (){
            editor.setCursorPos(line, ch);
        });
        $marker.find('span')
            .addClass(_getIconClassForType(type))
            .addClass("brackets-inspection-gutter-marker")
            .html('&nbsp;');
        return $marker[0];
    }

    /**
     * We have to draw empty gutter markers if it doesnt exist, else there is a visual gap in the gutter when
     * codemirror renders gutter with lines having no gutter icons
     * @param editor
     * @param line
     * @private
     */
    function _addDummyGutterMarkerIfNotExist(editor, line) {
        let marker = editor.getGutterMarker(line, CODE_INSPECTION_GUTTER);
        if(!marker){
            let $marker = $('<div>')
                .addClass(CODE_INSPECTION_GUTTER);
            editor.setGutterMarker(line, CODE_INSPECTION_GUTTER, $marker[0]);
        }
    }

    function _populateDummyGutterElements(editor, from, to) {
        for(let line=from; line <= to; line++) {
            _addDummyGutterMarkerIfNotExist(editor, line);
        }
    }

    function _updateGutterMarks(editor, gutterErrorMessages) {
        // add gutter icons
        for(let lineno of Object.keys(gutterErrorMessages)){
            // We mark the line with the Highest priority icon. (Eg. error icon if same line has warnings and info)
            let highestPriorityMarkTypeSeen = Type.META;
            let gutterMessage = gutterErrorMessages[lineno].reduce((prev, current)=>{
                if(_getMarkTypePriority(current.type) > _getMarkTypePriority(highestPriorityMarkTypeSeen)){
                    highestPriorityMarkTypeSeen = current.type;
                }
                return {message: `${prev.message}\n${current.message} at column: ${current.ch+1}`};
            }, {message: ''});
            let line = gutterErrorMessages[lineno][0].line,
                ch = gutterErrorMessages[lineno][0].ch,
                message = gutterMessage.message;
            let marker = _createMarkerElement(editor, line, ch, highestPriorityMarkTypeSeen, message);
            editor.setGutterMarker(line, CODE_INSPECTION_GUTTER, marker);
        }
        _populateDummyGutterElements(editor, 0, editor.getLastVisibleLine());
    }

    function _editorVieportChangeHandler(_evt, editor, from, to) {
        _populateDummyGutterElements(editor, from, to);
    }

    function getQuickView(editor, pos, token, line) {
        return new Promise((resolve, reject)=>{
            let codeInspectionMarks = editor.findMarksAt(pos, CODE_MARK_TYPE_INSPECTOR) || [];
            let hoverMessage = '';
            for(let mark of codeInspectionMarks){
                hoverMessage = `${hoverMessage}${mark.message}\n`;
            }
            if(hoverMessage){
                resolve({
                    start: {line: pos.line, ch: token.start},
                    end: {line: pos.line, ch: token.end},
                    content: hoverMessage
                });
                return;
            }
            reject();
        });
    }


    /**
     * Adds gutter icons and squiggly lines under err/warn/info to editor after lint.
     * @param resultProviderEntries
     * @private
     */
    function _updateEditorMarks(resultProviderEntries) {
        let editor = EditorManager.getCurrentFullEditor();
        if(!(editor && resultProviderEntries && resultProviderEntries.length)) {
            return;
        }
        editor.operation(function () {
            editor.clearAllMarks(CODE_MARK_TYPE_INSPECTOR);
            editor.clearGutter(CODE_INSPECTION_GUTTER);
            editor.off("viewportChange.codeInspection");
            editor.on("viewportChange.codeInspection", _editorVieportChangeHandler);
            let gutterErrorMessages = {};
            for (let resultProvider of resultProviderEntries) {
                let errors = (resultProvider.result && resultProvider.result.errors) || [];
                for (let error of errors) {
                    // todo: add error.message on hover
                    // add gutter markers
                    let line = error.pos.line || 0;
                    let ch = error.pos.ch || 0;
                    let gutterMessage = gutterErrorMessages[line] || [];
                    gutterMessage.push({message: error.message, type: error.type, line, ch});
                    gutterErrorMessages[line] = gutterMessage;
                    // add squiggly lines
                    if (_shouldMarkTokenAtPosition(editor, error)) {
                        let mark = editor.markToken(CODE_MARK_TYPE_INSPECTOR, error.pos, _getMarkOptions(error));
                        mark.type = error.type;
                        mark.message = error.message;
                    }
                }
            }
            _updateGutterMarks(editor, gutterErrorMessages);
        });
    }

    /**
     * Run inspector applicable to current document. Updates status bar indicator and refreshes error list in
     * bottom panel. Does not run if inspection is disabled or if a providerName is given and does not
     * match the current doc's provider name.
     *
     * @param {?string} providerName name of the provider that is requesting a run
     */
    function run() {
        if (!_enabled) {
            _hasErrors = false;
            _currentPromise = null;
            problemsPanel.hide();
            StatusBar.updateIndicator(INDICATOR_ID, true, "inspection-disabled", Strings.LINT_DISABLED);
            setGotoEnabled(false);
            return;
        }

        var currentDoc = DocumentManager.getCurrentDocument(),
            providerList = currentDoc && getProvidersForPath(currentDoc.file.fullPath);

        if (providerList && providerList.length) {
            var numProblems = 0;
            var aborted = false;
            var allErrors = [];
            var html;
            var providersReportingProblems = [];
            $problemsPanelTable.empty();

            // run all the providers registered for this file type
            (_currentPromise = inspectFile(currentDoc.file, providerList)).then(function (results) {
                _updateEditorMarks(results);
                // check if promise has not changed while inspectFile was running
                if (this !== _currentPromise) {
                    return;
                }

                // how many errors in total?
                var errors = results.reduce(function (a, item) { return a + (item.result ? item.result.errors.length : 0); }, 0);

                _hasErrors = Boolean(errors);

                if (!errors) {
                    problemsPanel.hide();

                    var message = Strings.NO_ERRORS_MULTIPLE_PROVIDER;
                    if (providerList.length === 1) {
                        message = StringUtils.format(Strings.NO_ERRORS, providerList[0].name);
                    }

                    StatusBar.updateIndicator(INDICATOR_ID, true, "inspection-valid", message);

                    setGotoEnabled(false);
                    return;
                }

                var perfTimerDOM = PerfUtils.markStart("ProblemsPanel render:\t" + currentDoc.file.fullPath);

                // Augment error objects with additional fields needed by Mustache template
                results.forEach(function (inspectionResult) {
                    var provider = inspectionResult.provider;
                    var isExpanded = prefs.get(provider.name + ".collapsed") !== false;

                    if (inspectionResult.result) {
                        inspectionResult.result.errors.forEach(function (error) {
                            // some inspectors don't always provide a line number or report a negative line number
                            if (!isNaN(error.pos.line) &&
                                    (error.pos.line + 1) > 0 &&
                                    (error.codeSnippet = currentDoc.getLine(error.pos.line)) !== undefined) {
                                error.friendlyLine = error.pos.line + 1;
                                error.codeSnippet = error.codeSnippet.substr(0, 175);  // limit snippet width
                            }

                            if (error.type !== Type.META) {
                                numProblems++;
                            }

                            error.iconClass = _getIconClassForType(error.type);

                            // Hide the errors when the provider is collapsed.
                            error.display = isExpanded ? "" : "forced-hidden";
                        });

                        // if the code inspector was unable to process the whole file, we keep track to show a different status
                        if (inspectionResult.result.aborted) {
                            aborted = true;
                        }

                        if (inspectionResult.result.errors.length) {
                            allErrors.push({
                                isExpanded: isExpanded,
                                providerName: provider.name,
                                results: inspectionResult.result.errors
                            });

                            providersReportingProblems.push(provider);
                        }
                    }
                });

                // Update results table
                html = Mustache.render(ResultsTemplate, {reportList: allErrors});

                $problemsPanelTable
                    .empty()
                    .append(html)
                    .scrollTop(0);  // otherwise scroll pos from previous contents is remembered

                if (!_collapsed) {
                    problemsPanel.show();
                }

                updatePanelTitleAndStatusBar(numProblems, providersReportingProblems, aborted);
                setGotoEnabled(true);

                PerfUtils.addMeasurement(perfTimerDOM);
            });

        } else {
            // No provider for current file
            _hasErrors = false;
            _currentPromise = null;
            if(problemsPanel){
                problemsPanel.hide();
            }
            var language = currentDoc && LanguageManager.getLanguageForPath(currentDoc.file.fullPath);
            if (language) {
                StatusBar.updateIndicator(INDICATOR_ID, true, "inspection-disabled", StringUtils.format(Strings.NO_LINT_AVAILABLE, language.getName()));
            } else {
                StatusBar.updateIndicator(INDICATOR_ID, true, "inspection-disabled", Strings.NOTHING_TO_LINT);
            }
            setGotoEnabled(false);
        }
    }

    /**
     * The provider is passed the text of the file and its fullPath. Providers should not assume
     * that the file is open (i.e. DocumentManager.getOpenDocumentForPath() may return null) or
     * that the file on disk matches the text given (file may have unsaved changes).
     *
     * Registering any provider for the "javascript" language automatically unregisters the built-in
     * Brackets JSLint provider. This is a temporary convenience until UI exists for disabling
     * registered providers.
     *
     * Providers implement scanFile() if results are available synchronously, or scanFileAsync() if results
     * may require an async wait (if both are implemented, scanFile() is ignored). scanFileAsync() returns
     * a {$.Promise} object resolved with the same type of value as scanFile() is expected to return.
     * Rejecting the promise is treated as an internal error in the provider.
     *
     * @param {string} languageId
     * @param {{name:string, scanFileAsync:?function(string, string):!{$.Promise},
     *         scanFile:?function(string, string):?{errors:!Array, aborted:boolean}}} provider
     *
     * Each error is: { pos:{line,ch}, endPos:?{line,ch}, message:string, type:?Type }
     * If type is unspecified, Type.WARNING is assumed.
     * If no errors found, return either null or an object with a zero-length `errors` array.
     */
    function register(languageId, provider) {
        if (!_providers[languageId]) {
            _providers[languageId] = [];
        } else {
            // Check if provider with same name exists for the given language
            // If yes, remove the provider before inserting the most recently loaded one
            var indexOfProvider = _.findIndex(_providers[languageId], function(entry) { return entry.name === provider.name; });
            if (indexOfProvider !== -1) {
                _providers[languageId].splice(indexOfProvider, 1);
            }
        }

        _providers[languageId].push(provider);

        if(!_registeredLanguageIDs.includes(languageId)){
            _registeredLanguageIDs.push(languageId);
            Editor.unregisterGutter(CODE_INSPECTION_GUTTER);
            Editor.registerGutter(CODE_INSPECTION_GUTTER, CODE_INSPECTION_GUTTER_PRIORITY, _registeredLanguageIDs);
        }

        run();  // in case a file of this type is open currently
    }

    /**
     * Returns a list of providers registered for given languageId through register function
     */
    function getProvidersForLanguageId(languageId) {
        var result = [];
        if (_providers[languageId]) {
            result = result.concat(_providers[languageId]);
        }
        if (_providers['*']) {
            result = result.concat(_providers['*']);
        }
        return result;
    }

    /**
     * Update DocumentManager listeners.
     */
    function updateListeners() {
        if (_enabled) {
            // register our event listeners
            MainViewManager
                .on("currentFileChange.codeInspection", function () {
                    run();
                });
            DocumentManager
                .on("currentDocumentLanguageChanged.codeInspection", function () {
                    run();
                })
                .on("documentSaved.codeInspection documentRefreshed.codeInspection", function (event, document) {
                    if (document === DocumentManager.getCurrentDocument()) {
                        run();
                    }
                });
        } else {
            DocumentManager.off(".codeInspection");
            MainViewManager.off(".codeInspection");
        }
    }

    /**
     * Enable or disable all inspection.
     * @param {?boolean} enabled Enabled state. If omitted, the state is toggled.
     * @param {?boolean} doNotSave true if the preference should not be saved to user settings. This is generally for events triggered by project-level settings.
     */
    function toggleEnabled(enabled, doNotSave) {
        if (enabled === undefined) {
            enabled = !_enabled;
        }

        // Take no action when there is no change.
        if (enabled === _enabled) {
            return;
        }

        _enabled = enabled;

        CommandManager.get(Commands.VIEW_TOGGLE_INSPECTION).setChecked(_enabled);
        updateListeners();
        if (!doNotSave) {
            prefs.set(PREF_ENABLED, _enabled);
            prefs.save();
        }

        // run immediately
        run();
    }

    /**
     * Toggle the collapsed state for the panel. This explicitly collapses the panel (as opposed to
     * the auto collapse due to files with no errors & filetypes with no provider). When explicitly
     * collapsed, the panel will not reopen automatically on switch files or save.
     *
     * @param {?boolean} collapsed Collapsed state. If omitted, the state is toggled.
     * @param {?boolean} doNotSave true if the preference should not be saved to user settings. This is generally for events triggered by project-level settings.
     */
    function toggleCollapsed(collapsed, doNotSave) {
        if (collapsed === undefined) {
            collapsed = !_collapsed;
        }

        if (collapsed === _collapsed) {
            return;
        }

        _collapsed = collapsed;
        if (!doNotSave) {
            prefs.set(PREF_COLLAPSED, _collapsed);
            prefs.save();
        }

        if (_collapsed) {
            problemsPanel.hide();
        } else {
            if (_hasErrors) {
                problemsPanel.show();
            }
        }
    }

    /** Command to go to the first Problem */
    function handleGotoFirstProblem() {
        run();
        if (_gotoEnabled) {
            $problemsPanel.find("tr:not(.inspector-section)").first().trigger("click");
        }
    }

    // Register command handlers
    CommandManager.register(Strings.CMD_VIEW_TOGGLE_INSPECTION, Commands.VIEW_TOGGLE_INSPECTION,        toggleEnabled);
    CommandManager.register(Strings.CMD_GOTO_FIRST_PROBLEM,     Commands.NAVIGATE_GOTO_FIRST_PROBLEM,   handleGotoFirstProblem);

    // Register preferences
    prefs.definePreference(PREF_ENABLED, "boolean", brackets.config["linting.enabled_by_default"], {
        description: Strings.DESCRIPTION_LINTING_ENABLED
    })
        .on("change", function (e, data) {
            toggleEnabled(prefs.get(PREF_ENABLED), true);
        });

    prefs.definePreference(PREF_COLLAPSED, "boolean", false, {
        description: Strings.DESCRIPTION_LINTING_COLLAPSED
    })
        .on("change", function (e, data) {
            toggleCollapsed(prefs.get(PREF_COLLAPSED), true);
        });

    prefs.definePreference(PREF_ASYNC_TIMEOUT, "number", 10000, {
        description: Strings.DESCRIPTION_ASYNC_TIMEOUT
    });

    prefs.definePreference(PREF_PREFER_PROVIDERS, "array", [], {
        description: Strings.DESCRIPTION_LINTING_PREFER,
        valueType: "string"
    });

    prefs.definePreference(PREF_PREFERRED_ONLY, "boolean", false, {
        description: Strings.DESCRIPTION_USE_PREFERED_ONLY
    });

    // Initialize items dependent on HTML DOM
    AppInit.htmlReady(function () {
        Editor.registerGutter(CODE_INSPECTION_GUTTER, CODE_INSPECTION_GUTTER_PRIORITY);
        // Create bottom panel to list error details
        var panelHtml = Mustache.render(PanelTemplate, Strings);
        problemsPanel = WorkspaceManager.createBottomPanel("errors", $(panelHtml), 100);
        $problemsPanel = $("#problems-panel");

        var $selectedRow;
        $problemsPanelTable = $problemsPanel.find(".table-container")
            .on("click", "tr", function (e) {
                if ($selectedRow) {
                    $selectedRow.removeClass("selected");
                }

                $selectedRow  = $(e.currentTarget);
                $selectedRow.addClass("selected");

                // This is a inspector title row, expand/collapse on click
                if ($selectedRow.hasClass("inspector-section")) {
                    var $triangle = $(".disclosure-triangle", $selectedRow);
                    var isExpanded = $triangle.hasClass("expanded");

                    // Clicking the inspector title section header collapses/expands result rows
                    if (isExpanded) {
                        $selectedRow.nextUntil(".inspector-section").addClass("forced-hidden");
                    } else {
                        $selectedRow.nextUntil(".inspector-section").removeClass("forced-hidden");
                    }
                    $triangle.toggleClass("expanded");

                    var providerName = $selectedRow.find("input[type='hidden']").val();
                    prefs.set(providerName + ".collapsed", !isExpanded);
                    prefs.save();
                } else {
                    // This is a problem marker row, show the result on click
                    // Grab the required position data
                    var lineTd    = $selectedRow.find(".line-number");
                    var line      = parseInt(lineTd.text(), 10) - 1;  // convert friendlyLine back to pos.line
                    // if there is no line number available, don't do anything
                    if (!isNaN(line)) {
                        var character = lineTd.data("character");

                        var editor = EditorManager.getCurrentFullEditor();
                        editor.setCursorPos(line, character, true);
                        MainViewManager.focusActivePane();
                    }
                }
            });

        $("#problems-panel .close").click(function () {
            toggleCollapsed(true);
            MainViewManager.focusActivePane();
        });

        // Status bar indicator - icon & tooltip updated by run()
        var statusIconHtml = Mustache.render("<div id=\"status-inspection\">&nbsp;</div>", Strings);
        StatusBar.addIndicator(INDICATOR_ID, $(statusIconHtml), true, "", "", "status-indent");

        $("#status-inspection").click(function () {
            // Clicking indicator toggles error panel, if any errors in current file
            if (_hasErrors) {
                toggleCollapsed();
            }
        });

        // Set initial UI state
        toggleEnabled(prefs.get(PREF_ENABLED), true);
        toggleCollapsed(prefs.get(PREF_COLLAPSED), true);

        QuickViewManager.registerQuickViewProvider({
            getQuickView,
            QUICK_VIEW_NAME: "CodeInspection"
        }, ["all"]);
    });

    // Testing
    exports._unregisterAll          = _unregisterAll;
    exports._PREF_ASYNC_TIMEOUT     = PREF_ASYNC_TIMEOUT;
    exports._PREF_PREFER_PROVIDERS  = PREF_PREFER_PROVIDERS;
    exports._PREF_PREFERRED_ONLY    = PREF_PREFERRED_ONLY;

    // Public API
    exports.CODE_INSPECTION_GUTTER      = CODE_INSPECTION_GUTTER;
    exports.register                    = register;
    exports.Type                        = Type;
    exports.toggleEnabled               = toggleEnabled;
    exports.inspectFile                 = inspectFile;
    exports.requestRun                  = run;
    exports.getProvidersForPath         = getProvidersForPath;
    exports.getProviderIDsForLanguage   = getProviderIDsForLanguage;
});
