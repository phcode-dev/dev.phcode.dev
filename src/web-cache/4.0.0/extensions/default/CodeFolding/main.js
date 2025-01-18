/*
* Copyright (c) 2013 Patrick Oladimeji. All rights reserved.
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
/**
 * Code folding extension for brackets
 * @author Patrick Oladimeji
 * @date 10/24/13 9:35:26 AM
 */

define(function (require, exports, module) {


    var CodeMirror              = brackets.getModule("thirdparty/CodeMirror/lib/codemirror"),
        Strings                 = brackets.getModule("strings"),
        AppInit                 = brackets.getModule("utils/AppInit"),
        CommandManager          = brackets.getModule("command/CommandManager"),
        DocumentManager         = brackets.getModule("document/DocumentManager"),
        Editor                  = brackets.getModule("editor/Editor").Editor,
        EditorManager           = brackets.getModule("editor/EditorManager"),
        ProjectManager          = brackets.getModule("project/ProjectManager"),
        ViewStateManager        = brackets.getModule("view/ViewStateManager"),
        KeyBindingManager       = brackets.getModule("command/KeyBindingManager"),
        ExtensionUtils          = brackets.getModule("utils/ExtensionUtils"),
        Menus                   = brackets.getModule("command/Menus"),
        prefs                   = require("Prefs"),
        COLLAPSE_ALL            = "codefolding.collapse.all",
        COLLAPSE                = "codefolding.collapse",
        EXPAND                  = "codefolding.expand",
        EXPAND_ALL              = "codefolding.expand.all",
        GUTTER_NAME             = "CodeMirror-foldgutter",
        CODE_FOLDING_GUTTER_PRIORITY   = Editor.CODE_FOLDING_GUTTER_PRIORITY,
        codeFoldingMenuDivider  = "codefolding.divider",
        collapseKey             = "Ctrl-Shift-{",
        expandKey               = "Ctrl-Shift-}";

    ExtensionUtils.loadStyleSheet(module, "main.less");

    // Load CodeMirror addons
    brackets.getModule(["thirdparty/CodeMirror/addon/fold/brace-fold"]);
    brackets.getModule(["thirdparty/CodeMirror/addon/fold/comment-fold"]);
    brackets.getModule(["thirdparty/CodeMirror/addon/fold/markdown-fold"]);

    // Still using slightly modified versions of the foldcode.js and foldgutter.js since we
    // need to modify the gutter click handler to take care of some collapse and expand features
    // e.g. collapsing all children when 'alt' key is pressed
    var foldGutter              = require("foldhelpers/foldgutter"),
        foldCode                = require("foldhelpers/foldcode"),
        indentFold              = require("foldhelpers/indentFold"),
        handlebarsFold          = require("foldhelpers/handlebarsFold"),
        selectionFold           = require("foldhelpers/foldSelected");


    /** Set to true when init() has run; set back to false after deinit() has run */
    var _isInitialized = false;

    /** Used to keep track of files for which line folds have been restored.*/

    /**
      * Restores the linefolds in the editor using values fetched from the preference store
      * Checks the document to ensure that changes have not been made (e.g., in a different editor)
      * to invalidate the saved line folds.
      * Selection Folds are found by comparing the line folds in the preference store with the
      * selection ranges in the viewState of the current document. Any selection range in the view state
      * that is folded in the prefs will be folded. Unlike other fold range finder, the only validation
      * on selection folds is to check that they satisfy the minimum fold range.
      * @param {Editor} editor  the editor whose saved line folds should be restored
      */
    function restoreLineFolds(editor) {
        /**
         * Checks if the range from and to Pos is the same as the selection start and end Pos
         * @param   {Object}  range     {from, to} where from and to are CodeMirror.Pos objects
         * @param   {Object}  selection {start, end} where start and end are CodeMirror.Pos objects
         * @returns {Boolean} true if the range and selection span the same region and false otherwise
         */
        function rangeEqualsSelection(range, selection) {
            return range.from.line === selection.start.line && range.from.ch === selection.start.ch &&
                range.to.line === selection.end.line && range.to.ch === selection.end.ch;
        }

        /**
         * Checks if the range is equal to one of the selections in the viewState
         * @param   {Object}  range     {from, to} where from and to are CodeMirror.Pos objects.
         * @param   {Object}  viewState The current editor's ViewState object
         * @returns {Boolean} true if the range is found in the list of selections or false if not.
         */
        function isInViewStateSelection(range, viewState) {
            if (!viewState || !viewState.selections) {
                return false;
            }

            return viewState.selections.some(function (selection) {
                return rangeEqualsSelection(range, selection);
            });
        }

        var saveFolds = prefs.getSetting("saveFoldStates");

        if (!editor || !saveFolds) {
            if (editor) {
                editor._codeMirror._lineFolds = editor._codeMirror._lineFolds || {};
            }
            return;
        }

        var cm = editor._codeMirror;
        var viewState = ViewStateManager.getViewState(editor.document.file);
        var path = editor.document.file.fullPath;
        var folds = cm._lineFolds || prefs.getFolds(path) || {};

        //separate out selection folds from non-selection folds
        var nonSelectionFolds = {}, selectionFolds = {}, range;
        Object.keys(folds).forEach(function (line) {
            range = folds[line];
            if (isInViewStateSelection(range, viewState)) {
                selectionFolds[line] = range;
            } else {
                nonSelectionFolds[line] = range;
            }
        });
        nonSelectionFolds = cm.getValidFolds(nonSelectionFolds);
        //add the selection folds
        Object.keys(selectionFolds).forEach(function (line) {
            nonSelectionFolds[line] = selectionFolds[line];
        });
        cm._lineFolds = nonSelectionFolds;
        prefs.setFolds(path, cm._lineFolds);
        Object.keys(cm._lineFolds).forEach(function (line) {
            cm.foldCode(Number(line), {range: cm._lineFolds[line]});
        });
    }

    /**
      * Saves the line folds in the editor using the preference storage
      * @param {Editor} editor the editor whose line folds should be saved
      */
    function saveLineFolds(editor) {
        var saveFolds = prefs.getSetting("saveFoldStates");
        if (!editor || !saveFolds) {
            return;
        }
        var folds = editor._codeMirror._lineFolds || {};
        var path = editor.document.file.fullPath;
        if (Object.keys(folds).length) {
            prefs.setFolds(path, folds);
        } else {
            prefs.setFolds(path, undefined);
        }
    }

    /**
      * Event handler for gutter click. Manages folding and unfolding code regions. If the Alt key
      * is pressed while clicking the fold gutter, child code fragments are also folded/unfolded
      * up to a level defined in the `maxFoldLevel' preference.
      * @param {!CodeMirror} cm the CodeMirror object
      * @param {number} line the line number for the clicked gutter
      * @param {string} gutter the name of the gutter element clicked
      * @param {!KeyboardEvent} event the underlying dom event triggered for the gutter click
      */
    function onGutterClick(cm, line, gutter, event) {
        var opts = cm.state.foldGutter.options, pos = CodeMirror.Pos(line);
        if (gutter !== opts.gutter) { return; }
        var range;
        var _lineFolds = cm._lineFolds;
        if (cm.isFolded(line)) {
            if (event.altKey) { // unfold code including children
                range = _lineFolds[line];
                CodeMirror.commands.unfoldAll(cm, range.from.line, range.to.line);
            } else {
                cm.unfoldCode(line, {range: _lineFolds[line]});
            }
        } else {
            if (event.altKey) {
                range = CodeMirror.fold.auto(cm, pos);
                if (range) {
                    CodeMirror.commands.foldToLevel(cm, range.from.line, range.to.line);
                }
            } else {
                cm.foldCode(line);
            }
        }
    }

    /**
      * Collapses the code region nearest the current cursor position.
      * Nearest is found by searching from the current line and moving up the document until an
      * opening code-folding region is found.
      */
    function collapseCurrent() {
        var editor = EditorManager.getFocusedEditor();
        if (!editor) {
            return;
        }
        var cm = editor._codeMirror;
        var cursor = editor.getCursorPos(), i;
        // Move cursor up until a collapsible line is found
        for (i = cursor.line; i >= 0; i--) {
            if (cm.foldCode(i)) {
                editor.setCursorPos(i);
                return;
            }
        }
    }

    /**
      * Expands the code region at the current cursor position.
      */
    function expandCurrent() {
        var editor = EditorManager.getFocusedEditor();
        if (editor) {
            var cursor = editor.getCursorPos(), cm = editor._codeMirror;
            cm.unfoldCode(cursor.line);
        }
    }

    /**
      * Collapses all foldable regions in the current document. Folding is done up to a level 'n'
      * which is defined in the `maxFoldLevel` preference. Levels refer to fold heirarchies e.g., for the following
      * code fragment, the function is level 1, the if statement is level 2 and the forEach is level 3
      *
      *     function sample() {
      *         if (debug) {
      *             logMessages.forEach(function (m) {
      *                 console.debug(m);
      *             });
      *         }
      *     }
      */
    function collapseAll() {
        var editor = EditorManager.getFocusedEditor();
        if (editor) {
            var cm = editor._codeMirror;
            CodeMirror.commands.foldAll(cm);
        }
    }

    /**
      * Expands all folded regions in the current document
      */
    function expandAll() {
        var editor = EditorManager.getFocusedEditor();
        if (editor) {
            var cm = editor._codeMirror;
            CodeMirror.commands.unfoldAll(cm);
        }
    }

    function clearGutter(editor) {
        var cm = editor._codeMirror;
        var BLANK_GUTTER_CLASS = "CodeMirror-foldgutter-blank";
        editor.clearGutter(GUTTER_NAME);
        var blank = window.document.createElement("div");
        blank.className = BLANK_GUTTER_CLASS;
        var vp = cm.getViewport();
        cm.operation(function () {
            cm.eachLine(vp.from, vp.to, function (line) {
                editor.setGutterMarker(line.lineNo(), GUTTER_NAME, blank);
            });
        });
    }

    /**
      * Renders and sets up event listeners the code-folding gutter.
      * @param {Editor} editor the editor on which to initialise the fold gutter
      */
    function setupGutterEventListeners(editor) {
        var cm = editor._codeMirror;
        $(editor.getRootElement()).addClass("folding-enabled");
        cm.setOption("foldGutter", {onGutterClick: onGutterClick});

        $(cm.getGutterElement()).on({
            mouseenter: function () {
                if (prefs.getSetting("hideUntilMouseover")) {
                    foldGutter.updateInViewport(cm);
                } else {
                    $(editor.getRootElement()).addClass("over-gutter");
                }
            },
            mouseleave: function () {
                if (prefs.getSetting("hideUntilMouseover")) {
                    clearGutter(editor);
                } else {
                    $(editor.getRootElement()).removeClass("over-gutter");
                }
            }
        });
    }

    /**
      * Remove the fold gutter for a given CodeMirror instance.
      * @param {Editor} editor the editor instance whose gutter should be removed
      */
    function removeGutters(editor) {
        Editor.unregisterGutter(GUTTER_NAME);
        $(editor.getRootElement()).removeClass("folding-enabled");
        CodeMirror.defineOption("foldGutter", false, null);
    }

    /**
      * Add gutter and restore saved expand/collapse state.
      * @param {Editor} editor the editor instance where gutter should be added.
      */
    function enableFoldingInEditor(editor) {
        restoreLineFolds(editor);
        setupGutterEventListeners(editor);
        editor._codeMirror.refresh();
    }

    /**
      * When a brand new editor is seen, initialise fold-gutter and restore line folds in it.
      * Save line folds in departing editor in case it's getting closed.
      * @param {object} event the event object
      * @param {Editor} current the current editor
      * @param {Editor} previous the previous editor
      */
    function onActiveEditorChanged(event, current, previous) {
        if (current && !current._codeMirror._lineFolds) {
            enableFoldingInEditor(current);
        }
        if (previous) {
            saveLineFolds(previous);
        }
    }

    /**
      * Saves the line folds in the current full editor before it is closed.
      */
    function saveBeforeClose() {
        // We've already saved all other open editors when they go active->inactive
        saveLineFolds(EditorManager.getActiveEditor());
    }

    /**
     * Remove code-folding functionality
     */
    function deinit() {
        _isInitialized = false;

        KeyBindingManager.removeBinding(collapseKey);
        KeyBindingManager.removeBinding(expandKey);

        //remove menus
        Menus.getMenu(Menus.AppMenuBar.VIEW_MENU).removeMenuDivider(codeFoldingMenuDivider.id);
        Menus.getMenu(Menus.AppMenuBar.VIEW_MENU).removeMenuItem(COLLAPSE);
        Menus.getMenu(Menus.AppMenuBar.VIEW_MENU).removeMenuItem(EXPAND);
        Menus.getMenu(Menus.AppMenuBar.VIEW_MENU).removeMenuItem(COLLAPSE_ALL);
        Menus.getMenu(Menus.AppMenuBar.VIEW_MENU).removeMenuItem(EXPAND_ALL);

        EditorManager.off(".CodeFolding");
        DocumentManager.off(".CodeFolding");
        ProjectManager.off(".CodeFolding");

        // Remove gutter & revert collapsed sections in all currently open editors
        Editor.forEveryEditor(function (editor) {
            CodeMirror.commands.unfoldAll(editor._codeMirror);
        });
        removeGutters();
    }

    /**
     * Enable code-folding functionality
     */
    function init() {
        _isInitialized = true;

        foldCode.init();
        foldGutter.init();

        // Many CodeMirror modes specify which fold helper should be used for that language. For a few that
        // don't, we register helpers explicitly here. We also register a global helper for generic indent-based
        // folding, which cuts across all languages if enabled via preference.
        CodeMirror.registerGlobalHelper("fold", "selectionFold", function (mode, cm) {
            return prefs.getSetting("makeSelectionsFoldable");
        }, selectionFold);
        CodeMirror.registerGlobalHelper("fold", "indent", function (mode, cm) {
            return prefs.getSetting("alwaysUseIndentFold");
        }, indentFold);

        CodeMirror.registerHelper("fold", "handlebars", handlebarsFold);
        CodeMirror.registerHelper("fold", "htmlhandlebars", handlebarsFold);
        CodeMirror.registerHelper("fold", "htmlmixed", handlebarsFold);

        EditorManager.on("activeEditorChange.CodeFolding", onActiveEditorChanged);
        DocumentManager.on("documentRefreshed.CodeFolding", function (event, doc) {
            restoreLineFolds(doc._masterEditor);
        });

        ProjectManager.on("beforeProjectClose.CodeFolding beforeAppClose.CodeFolding", saveBeforeClose);

        //create menus
        codeFoldingMenuDivider = Menus.getMenu(Menus.AppMenuBar.VIEW_MENU).addMenuDivider();
        Menus.getMenu(Menus.AppMenuBar.VIEW_MENU).addMenuItem(COLLAPSE_ALL);
        Menus.getMenu(Menus.AppMenuBar.VIEW_MENU).addMenuItem(EXPAND_ALL);
        Menus.getMenu(Menus.AppMenuBar.VIEW_MENU).addMenuItem(COLLAPSE);
        Menus.getMenu(Menus.AppMenuBar.VIEW_MENU).addMenuItem(EXPAND);

        //register keybindings
        KeyBindingManager.addBinding(COLLAPSE, [{key: collapseKey}, {key: collapseKey, platform: "mac"}]);
        KeyBindingManager.addBinding(EXPAND, [{key:expandKey}, {key:expandKey, platform: "mac"}]);


        // Add gutters & restore saved expand/collapse state in all currently open editors
        Editor.registerGutter(GUTTER_NAME, CODE_FOLDING_GUTTER_PRIORITY);
        Editor.forEveryEditor(function (editor) {
            enableFoldingInEditor(editor);
        });
    }

    /**
      * Register change listener for the preferences file.
      */
    function watchPrefsForChanges() {
        prefs.prefsObject.on("change", function (e, data) {
            if (data.ids.indexOf("enabled") > -1) {
                // Check if enabled state mismatches whether code-folding is actually initialized (can't assume
                // since preference change events can occur when the value hasn't really changed)
                var isEnabled = prefs.getSetting("enabled");
                if (isEnabled && !_isInitialized) {
                    init();
                } else if (!isEnabled && _isInitialized) {
                    deinit();
                }
            }
        });
    }

    AppInit.htmlReady(function () {
        CommandManager.register(Strings.COLLAPSE_ALL, COLLAPSE_ALL, collapseAll);
        CommandManager.register(Strings.EXPAND_ALL, EXPAND_ALL, expandAll);
        CommandManager.register(Strings.COLLAPSE_CURRENT, COLLAPSE, collapseCurrent);
        CommandManager.register(Strings.EXPAND_CURRENT, EXPAND, expandCurrent);

        if (prefs.getSetting("enabled")) {
            init();
        }
        watchPrefsForChanges();
    });
});

/**
 * Wrapper around brackets pref system to ensure preferences are stored in in one single object instead of using multiple keys.
 * This is to make it easy for the user who edits their preferences file to easily manage the potentially numerous lines of preferences generated by the persisting code-folding state.
 * @author Patrick Oladimeji
 * @date 3/22/14 20:39:53 PM
 */

define("Prefs", function (require, exports, module) {


    var ProjectManager              = brackets.getModule("project/ProjectManager"),
        PreferencesManager          = brackets.getModule("preferences/PreferencesManager"),
        Strings                     = brackets.getModule("strings"),
        prefs                       = PreferencesManager.getExtensionPrefs("code-folding"),
        FOLDS_PREF_KEY              = "code-folding-folds",
        // preference key strings are here for now since they are not used in any UI
        ENABLE_CODE_FOLDING         = "Enable code folding",
        MIN_FOLD_SIZE               = "Minimum fold size",
        SAVE_FOLD_STATES            = "Save fold states",
        ALWAYS_USE_INDENT_FOLD      = "Always use indent fold",
        HIDE_FOLD_BUTTONS           = "Hide fold triangles",
        MAX_FOLD_LEVEL              = "Max fold level",
        MAKE_SELECTIONS_FOLDABLE     = "Makes selections foldable";

    //default preference values
    prefs.definePreference("enabled", "boolean", true,
                           {name: ENABLE_CODE_FOLDING, description: Strings.DESCRIPTION_CODE_FOLDING_ENABLED});
    prefs.definePreference("minFoldSize", "number", 2,
                           {name: MIN_FOLD_SIZE, description: Strings.DESCRIPTION_CODE_FOLDING_MIN_FOLD_SIZE});
    prefs.definePreference("saveFoldStates", "boolean", true,
                           {name: SAVE_FOLD_STATES, description: Strings.DESCRIPTION_CODE_FOLDING_SAVE_FOLD_STATES});
    prefs.definePreference("alwaysUseIndentFold", "boolean", false,
                           {name: ALWAYS_USE_INDENT_FOLD, description: Strings.DESCRIPTION_CODE_FOLDING_ALWAY_USE_INDENT_FOLD});
    prefs.definePreference("hideUntilMouseover", "boolean", false,
                           {name: HIDE_FOLD_BUTTONS, description: Strings.DESCRIPTION_CODE_FOLDING_HIDE_UNTIL_MOUSEOVER});
    prefs.definePreference("maxFoldLevel", "number", 2,
                           {name: MAX_FOLD_LEVEL, description: Strings.DESCRIPTION_CODE_FOLDING_MAX_FOLD_LEVEL});
    prefs.definePreference("makeSelectionsFoldable", "boolean", true,
                           {name: MAKE_SELECTIONS_FOLDABLE, description: Strings.DESCRIPTION_CODE_FOLDING_MAKE_SELECTIONS_FOLDABLE});

    PreferencesManager.stateManager.definePreference(FOLDS_PREF_KEY, "object", {});

    /**
      * Simplifies the fold ranges into an array of pairs of numbers.
      * @param {!Object} folds the raw fold ranges indexed by line numbers
      * @return {Object} an object whose keys are line numbers and the values are array
      * of two 2-element arrays. First array contains [from.line, from.ch] and the second contains [to.line, to.ch]
      */
    function simplify(folds) {
        if (!folds) {
            return;
        }
        var res = {}, range;
        Object.keys(folds).forEach(function (line) {
            range = folds[line];
            res[line] = Array.isArray(range) ? range : [[range.from.line, range.from.ch], [range.to.line, range.to.ch]];
        });
        return res;
    }

    /**
      * Inflates the fold ranges stored as simplified numeric arrays. The inflation converts the data into
      * objects whose keys are line numbers and whose values are objects in the format {from: {line, ch}, to: {line, ch}}.
      * @param {Object}  folds the simplified fold ranges
      * @return {Object} the converted fold ranges
      */
    function inflate(folds) {
        if (!folds) {
            return;
        }
         //transform the folds into objects with from and to properties
        var ranges = {}, obj;
        Object.keys(folds).forEach(function (line) {
            obj = folds[line];
            ranges[line] = {from: {line: obj[0][0], ch: obj[0][1]}, to: {line: obj[1][0], ch: obj[1][1]}};
        });

        return ranges;
    }

    /**
      * Gets the line folds saved for the specified path.
      * @param {string} path the document path
      * @return {Object} the line folds for the document at the specified path
      */
    function getFolds(path) {
        var folds = PreferencesManager.getViewState(FOLDS_PREF_KEY, PreferencesManager.STATE_PROJECT_CONTEXT);
        return inflate(folds[path]);
    }

    /**
      * Saves the line folds for the specified path
      * @param {!string} path the path to the document
      * @param {Object} folds the fold ranges to save for the current document
      */
    function setFolds(path, folds) {
        const allFolds = PreferencesManager.getViewState(FOLDS_PREF_KEY, PreferencesManager.STATE_PROJECT_CONTEXT);
        allFolds[path] = simplify(folds);
        PreferencesManager.setViewState(FOLDS_PREF_KEY, allFolds, PreferencesManager.STATE_PROJECT_CONTEXT);
    }

    /**
      * Get the code folding setting with the specified key from the store
      * @param {!string} key The key for the setting to retrieve
      * @return {string} the setting with the specified key
      */
    function getSetting(key) {
        return prefs.get(key);
    }

    /**
      * Clears all the saved line folds for all documents.
      */
    function clearAllFolds() {
        PreferencesManager.setViewState(FOLDS_PREF_KEY, {});
    }

    module.exports.getFolds = getFolds;
    module.exports.setFolds = setFolds;
    module.exports.getSetting = getSetting;
    module.exports.clearAllFolds = clearAllFolds;
    module.exports.prefsObject = prefs;
});

/**
 * Selection range helper for code folding.
 * @author Patrick Oladimeji
 * @date 31/07/2015 00:11:53
 */

define("foldhelpers/foldSelected", function (require, exports, module) {


    /**
     * This helper returns the start and end range representing the current selection in the editor.
     * @param   {Object} cm    The Codemirror instance
     * @param   {Object} start A Codemirror.Pos object {line, ch} representing the current line we are
     *                          checking for fold ranges
     * @returns {Object} The fold range, {from, to} representing the current selection.
     */
    function SelectionFold(cm, start) {
        if (!cm.somethingSelected()) {
            return;
        }

        var from = cm.getCursor("from"),
            to  = cm.getCursor("to");
        if (from.line === start.line) {
            return {from: from, to: to};
        }
    }

    module.exports = SelectionFold;
});

// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE
// Based on http://codemirror.net/addon/fold/foldcode.js
// Modified by Patrick Oladimeji for Brackets

define("foldhelpers/foldcode", function (require, exports, module) {

    var CodeMirror          = brackets.getModule("thirdparty/CodeMirror/lib/codemirror"),
        prefs               = require("Prefs");

    /**
      * Performs the folding and unfolding of code regions.
      * @param {CodeMirror} cm the CodeMirror instance
      * @param {number| Object} pos
      */
    function doFold(cm, pos, options, force) {
        options = options || {};
        force = force || "fold";
        if (typeof pos === "number") {
            pos = CodeMirror.Pos(pos, 0);
        }

        var finder = options.rangeFinder || CodeMirror.fold.auto,
            range,
            widget,
            textRange;

        function getRange(allowFolded) {
            var range = options.range || finder(cm, pos);
            if (!range || range.to.line - range.from.line < prefs.getSetting("minFoldSize")) {
                return null;
            }
            var marks = cm.findMarksAt(range.from),
                i,
                lastMark,
                foldMarks;
            for (i = 0; i < marks.length; ++i) {
                if (marks[i].__isFold && force !== "fold") {
                    if (!allowFolded) {
                        return null;
                    }
                    range.cleared = true;
                    marks[i].clear();
                }
            }
            //check for overlapping folds
            if (marks && marks.length) {
                foldMarks = marks.filter(function (d) {
                    return d.__isFold;
                });
                if (foldMarks && foldMarks.length) {
                    lastMark = foldMarks[foldMarks.length - 1].find();
                    if (lastMark && range.from.line <= lastMark.to.line && lastMark.to.line < range.to.line) {
                        return null;
                    }
                }
            }
            return range;
        }

        function makeWidget() {
            var widget = window.document.createElement("span");
            widget.className = "CodeMirror-foldmarker";
            return widget;
        }

        range = getRange(true);
        if (options.scanUp) {
            while (!range && pos.line > cm.firstLine()) {
                pos = CodeMirror.Pos(pos.line - 1, 0);
                range = getRange(false);
            }
        }
        if (!range || range.cleared || force === "unfold" || range.to.line - range.from.line < prefs.getSetting("minFoldSize")) {
            if (range) { range.cleared = false; }
            return;
        }

        widget = makeWidget();
        textRange = cm.markText(range.from, range.to, {
            replacedWith: widget,
            clearOnEnter: true,
            __isFold: true
        });

        CodeMirror.on(widget, "mousedown", function (e) {
            textRange.clear();
            e.preventDefault();
        });

        textRange.on("clear", function (from, to) {
            delete cm._lineFolds[from.line];
            CodeMirror.signal(cm, "unfold", cm, from, to);
        });

        if (force === "fold") {
            delete range.cleared;
            // In some cases such as in xml style files, the start of  line folds can span multiple lines.
            // For instance the attributes of an element can span multiple lines. In these cases when folding
            // we want to render a gutter marker for both the beginning and end of the opening xml tag.
            if (pos.line < range.from.line) {
                cm._lineFolds[range.from.line] = range;
            } else {
                cm._lineFolds[pos.line] = range;
            }
        } else {
            delete cm._lineFolds[pos.line];
        }

        CodeMirror.signal(cm, force, cm, range.from, range.to);
        return range;
    }

    /**
        Initialises extensions and helpers on the CodeMirror object
    */
    function init() {
        CodeMirror.defineExtension("foldCode", function (pos, options, force) {
            return doFold(this, pos, options, force);
        });

        CodeMirror.defineExtension("unfoldCode", function (pos, options) {
            return doFold(this, pos, options, "unfold");
        });

        CodeMirror.defineExtension("isFolded", function (line) {
            return this._lineFolds && this._lineFolds[line];
        });

        /**
          * Checks the validity of the ranges passed in the parameter and returns the foldranges
          * that are still valid in the current document
          * @param {object} folds the dictionary of lines in the current document that should be folded
          * @returns {object} valid folds found in those passed in parameter
          */
        CodeMirror.defineExtension("getValidFolds", function (folds) {
            var keys, rf = CodeMirror.fold.auto, cm = this, result = {}, range, cachedRange;
            if (folds && (keys = Object.keys(folds)).length) {
                keys.forEach(function (lineNumber) {
                    lineNumber = +lineNumber;
                    if (lineNumber >= cm.firstLine() && lineNumber <= cm.lastLine()) {
                        range = rf(cm, CodeMirror.Pos(lineNumber, 0));
                        cachedRange = folds[lineNumber];
                        if (range && cachedRange && range.from.line === cachedRange.from.line &&
                                range.to.line === cachedRange.to.line) {
                            result[lineNumber] = folds[lineNumber];
                        }
                    }
                });
            }
            return result;
        });

        /**
          * Utility function to fold the region at the current cursor position in  a document
          * @param {CodeMirror} cm the CodeMirror instance
          * @param {?options} options extra options to pass to the fold function
          */
        CodeMirror.commands.fold = function (cm, options) {
            cm.foldCode(cm.getCursor(), options, "fold");
        };

        /**
          * Utility function to unfold the region at the current cursor position in  a document
          * @param {CodeMirror} cm the CodeMirror instance
          * @param {?options} options extra options to pass to the fold function
          */
        CodeMirror.commands.unfold = function (cm, options) {
            cm.foldCode(cm.getCursor(), options, "unfold");
        };

        /**
          * Utility function to fold all foldable regions in a document
          * @param {CodeMirror} cm the CodeMirror instance
          */
        CodeMirror.commands.foldAll = function (cm) {
            cm.operation(function () {
                var i, e;
                for (i = cm.firstLine(), e = cm.lastLine(); i <= e; i++) {
                    cm.foldCode(CodeMirror.Pos(i, 0), null, "fold");
                }
            });
        };

        /**
          * Utility function to unfold all folded regions in a document
          * @param {CodeMirror} cm the CodeMirror instance
          * @param {?number} from the line number for the beginning of the region to unfold
          * @param {?number} to the line number for the end of the region to unfold
          */
        CodeMirror.commands.unfoldAll = function (cm, from, to) {
            from = from || cm.firstLine();
            to = to || cm.lastLine();
            cm.operation(function () {
                var i, e;
                for (i = from, e = to; i <= e; i++) {
                    if (cm.isFolded(i)) { cm.unfoldCode(i, {range: cm._lineFolds[i]}); }
                }
            });
        };

        /**
          * Folds the specified range. The descendants of any fold regions within the range are also folded up to
          * a level set globally in the `maxFoldLevel' preferences
          * @param {CodeMirror} cm the CodeMirror instance
          * @param {?number} start the line number for the beginning of the region to fold
          * @param {?number} end the line number for the end of the region to fold
          */
        CodeMirror.commands.foldToLevel = function (cm, start, end) {
            var rf = CodeMirror.fold.auto;
            function foldLevel(n, from, to) {
                if (n > 0) {
                    var i = from, range;
                    while (i < to) {
                        range = rf(cm, CodeMirror.Pos(i, 0));
                        if (range) {
                            //call fold level for the range just folded
                            foldLevel(n - 1, range.from.line + 1, range.to.line - 1);
                            cm.foldCode(CodeMirror.Pos(i, 0), null, "fold");
                            i = range.to.line + 1;
                        } else {
                            i++;
                        }
                    }
                }
            }
            cm.operation(function () {
                start = start === undefined ? cm.firstLine() : start;
                end = end || cm.lastLine();
                foldLevel(prefs.getSetting("maxFoldLevel"), start, end);
            });
        };

        /**
          * Helper to combine an array of fold range finders into one. This goes through the
          * list of fold helpers in the parameter arguments and returns the first non-null
          * range found from calling the fold helpers in order.
          */
        CodeMirror.registerHelper("fold", "combine", function () {
            var funcs = Array.prototype.slice.call(arguments, 0);
            return function (cm, start) {
                var i;
                for (i = 0; i < funcs.length; ++i) {
                    var found = funcs[i] && funcs[i](cm, start);
                    if (found) {
                        return found;
                    }
                }
            };
        });

        /**
          * Creates a helper which returns the appropriate fold function based on the mode of the current position in
          * a document.
          * @param {CodeMirror} cm the CodeMirror instance
          * @param {number} start the current position in the document
          */
        CodeMirror.registerHelper("fold", "auto", function (cm, start) {
            var helpers = cm.getHelpers(start, "fold"), i, range;
            //ensure mode helper is loaded if there is one
            var mode = cm.getMode().name;
            var modeHelper = CodeMirror.fold[mode];
            if (modeHelper && helpers.indexOf(modeHelper) < 0) {
                helpers.push(modeHelper);
            }
            for (i = 0; i < helpers.length; i++) {
                range = helpers[i](cm, start);
                if (range && range.to.line - range.from.line >= prefs.getSetting("minFoldSize")) { return range; }
            }
        });
    }

    exports.init = init;
});

// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE
// Based on http://codemirror.net/addon/fold/foldgutter.js
// Modified by Patrick Oladimeji for Brackets

define("foldhelpers/foldgutter", function (require, exports, module) {

    var CodeMirror      = brackets.getModule("thirdparty/CodeMirror/lib/codemirror"),
        prefs           = require("Prefs");

    function State(options) {
        this.options = options;
        this.from = this.to = 0;
    }

    function parseOptions(opts) {
        if (opts === true) { opts = {}; }
        if (!opts.gutter) { opts.gutter = "CodeMirror-foldgutter"; }
        if (!opts.indicatorOpen) { opts.indicatorOpen = "CodeMirror-foldgutter-open"; }
        if (!opts.indicatorFolded) { opts.indicatorFolded = "CodeMirror-foldgutter-folded"; }
        return opts;
    }

    /**
      * Utility for creating fold markers in fold gutter
      * @param {string} spec the className for the marker
      * @return {HTMLElement} a htmlelement representing the fold marker
      */
    function marker(spec) {
        var elt = window.document.createElement("div");
        elt.className = spec;
        return elt;
    }

    /**
     * Checks whether or not a marker is a code-folding marker
     * @param   {Object}   m a CodeMirror TextMarker object
     * @returns {boolean} true if the marker is a codefolding range marker or false otherwise
     */
    function isFold(m) {
        return m.__isFold;
    }

    /**
      * Updates the gutter markers for the specified range
      * @param {!CodeMirror} cm the CodeMirror instance for the active editor
      * @param {!number} from the starting line for the update
      * @param {!number} to the ending line for the update
      */
    function updateFoldInfo(cm, from, to) {
        var minFoldSize = prefs.getSetting("minFoldSize") || 2;
        var opts = cm.state.foldGutter.options;
        var fade = prefs.getSetting("hideUntilMouseover");
        var $gutter = $(cm.getGutterElement());
        var i = from;

        function clear(m) {
            return m.clear();
        }

        /**
          * @private
          * helper function to check if the given line is in a folded region in the editor.
          * @param {number} line the
          * @return {Object} the range that hides the specified line or undefine if the line is not hidden
          */
        function _isCurrentlyFolded(line) {
            var keys = Object.keys(cm._lineFolds), i = 0, range;
            while (i < keys.length) {
                range = cm._lineFolds[keys[i]];
                if (range.from.line < line && range.to.line >= line) {
                    return range;
                }
                i++;
            }
        }

        /**
            This case is needed when unfolding a region that does not cause the viewport to change.
            For instance in a file with about 15 lines, if some code regions are folded and unfolded, the
            viewport change event isn't fired by CodeMirror. The setTimeout is a workaround to trigger the
            gutter update after the viewport has been drawn.
        */
        if (i === to) {
            window.setTimeout(function () {
                var vp = cm.getViewport();
                updateFoldInfo(cm, vp.from, vp.to);
            }, 200);
        }

        while (i < to) {
            var sr = _isCurrentlyFolded(i), // surrounding range for the current line if one exists
                range;
            var mark = marker("CodeMirror-foldgutter-blank");
            var pos = CodeMirror.Pos(i, 0),
                func = opts.rangeFinder || CodeMirror.fold.auto;
            // don't look inside collapsed ranges
            if (sr) {
                i = sr.to.line + 1;
            } else {
                range = cm._lineFolds[i] || (func && func(cm, pos));

                if (!fade || (fade && $gutter.is(":hover"))) {
                    if (cm.isFolded(i)) {
                        // expand fold if invalid
                        if (range) {
                            mark = marker(opts.indicatorFolded);
                        } else {
                            cm.findMarksAt(pos).filter(isFold)
                                .forEach(clear);
                        }
                    } else {
                        if (range && range.to.line - range.from.line >= minFoldSize) {
                            mark = marker(opts.indicatorOpen);
                        }
                    }
                }
                cm.setGutterMarker(i, opts.gutter, mark);
                i++;
            }
        }
    }

    /**
      * Updates the fold information in the viewport for the specified range
      * @param {CodeMirror} cm the instance of the CodeMirror object
      * @param {?number} from the starting line number for the update
      * @param {?number} to the end line number for the update
      */
    function updateInViewport(cm, from, to) {
        var vp = cm.getViewport(), state = cm.state.foldGutter;
        from = isNaN(from) ? vp.from : from;
        to = isNaN(to) ? vp.to : to;

        if (!state) { return; }
        cm.operation(function () {
            updateFoldInfo(cm, from, to);
        });
        state.from = from;
        state.to = to;
    }

    /**
     * Helper function to return the fold text marker on a line in an editor
     * @param   {CodeMirror} cm   The CodeMirror instance for the active editor
     * @param   {Number}     line The line number representing the position of the fold marker
     * @returns {TextMarker} A CodeMirror TextMarker object
     */
    function getFoldOnLine(cm, line) {
        var pos = CodeMirror.Pos(line, 0);
        var folds = cm.findMarksAt(pos) || [];
        folds = folds.filter(isFold);
        return folds.length ? folds[0] : undefined;
    }

    /**
     * Synchronises the code folding states in the CM doc to cm._lineFolds cache.
     * When an undo operation is done, if folded code fragments are restored, then
     * we need to update cm._lineFolds with the fragments
     * @param {Object}   cm       cm the CodeMirror instance for the active  editor
     * @param {Object}   from     starting position in the doc to sync the fold states from
     * @param {[[Type]]} lineAdded a number to show how many lines where added to the document
     */
    function syncDocToFoldsCache(cm, from, lineAdded) {
        var minFoldSize = prefs.getSetting("minFoldSize") || 2;
        var i, fold, range;
        if (lineAdded <= 0) {
            return;
        }

        for (i = from; i <= from + lineAdded; i = i + 1) {
            fold = getFoldOnLine(cm, i);
            if (fold) {
                range = fold.find();
                if (range && range.to.line - range.from.line >= minFoldSize) {
                    cm._lineFolds[i] = range;
                    i = range.to.line;
                } else {
                    delete cm._lineFolds[i];
                }
            }
        }
    }

    /**
     * Helper function to move a fold range object by the specified number of lines
     * @param {Object} range    An object specifying the fold range to move. It contains {from, to} which are CodeMirror.Pos objects.
     * @param {Number} numLines A positive or negative number representing the numbe of lines to move the range by
     */
    function moveRange(range, numLines) {
        return {from: CodeMirror.Pos(range.from.line + numLines, range.from.ch),
            to: CodeMirror.Pos(range.to.line + numLines, range.to.ch)};
    }

    /**
      * Updates the line folds cache usually when the document changes.
      * The following cases are accounted for:
      * 1.  When the change does not add a new line to the document we check if the line being modified
      *     is folded. If that is the case, changes to this line might affect the range stored in the cache
      *     so we update the range using the range finder function.
      * 2.  If lines have been added, we need to update the records for all lines in the folds cache
      *     which are greater than the line position at which we are adding the new line(s). When existing
      *     folds are above the addition we keep the original position in the cache.
      * 3.  If lines are being removed, we need to update the records for all lines in the folds cache which are
      *     greater than the line position at which we are removing the new lines, while making sure to
      *     not include any folded lines in the cache that are part of the removed chunk.
      * @param {!CodeMirror} cm        the CodeMirror instance for the active editor
      * @param {!number}     from      the line number designating the start position of the change
      * @param {!number}     linesDiff a number to show how many lines where removed or added to the document.
      *                                This value is negative for deletions and positive for additions.
      */
    function updateFoldsCache(cm, from, linesDiff) {
        var oldRange, newRange;
        var minFoldSize = prefs.getSetting("minFoldSize") || 2;
        var foldedLines = Object.keys(cm._lineFolds).map(function (d) {
            return +d;
        });
        var opts = cm.state.foldGutter.options || {};
        var rf = opts.rangeFinder || CodeMirror.fold.auto;

        if (linesDiff === 0) {
            if (foldedLines.indexOf(from) >= 0) {
                newRange = rf(cm, CodeMirror.Pos(from, 0));
                if (newRange && newRange.to.line - newRange.from.line >= minFoldSize) {
                    cm._lineFolds[from] = newRange;
                } else {
                    delete cm._lineFolds[from];
                }
            }
        } else if (foldedLines.length) {
            var newFolds = {};
            foldedLines.forEach(function (line) {
                oldRange = cm._lineFolds[line];
                //update range with lines-diff
                newRange = moveRange(oldRange, linesDiff);
                // for removed lines we want to check lines that lie outside the deleted range
                if (linesDiff < 0) {
                    if (line < from) {
                        newFolds[line] = oldRange;
                    } else if (line >= from + Math.abs(linesDiff)) {
                        newFolds[line + linesDiff] = newRange;
                    }
                } else {
                    if (line < from) {
                        newFolds[line] = oldRange;
                    } else if (line >= from) {
                        newFolds[line + linesDiff] = newRange;
                    }
                }
            });
            cm._lineFolds = newFolds;
        }
    }

    /**
      * Triggered when the content of the document changes. When the entire content of the document
      * is changed - e.g., changes made from a different editor, the same lineFolds are kept only if
      * they are still valid in the context of the new document content.
      * @param {!CodeMirror} cm the CodeMirror instance for the active editor
      * @param {!Object} changeObj detailed information about the change that occurred in the document
      */
    function onChange(cm, changeObj) {
        if (changeObj.origin === "setValue") { //text content has changed outside of brackets
            var folds = cm.getValidFolds(cm._lineFolds);
            cm._lineFolds = folds;
            Object.keys(folds).forEach(function (line) {
                cm.foldCode(+line);
            });
        } else {
            var state = cm.state.foldGutter;
            var lineChanges = changeObj.text.length - changeObj.removed.length;
            // for undo actions that add new line(s) to the document first update the folds cache as normal
            // and then update the folds cache with any line folds that exist in the new lines
            if (changeObj.origin === "undo" && lineChanges > 0) {
                updateFoldsCache(cm, changeObj.from.line, lineChanges);
                syncDocToFoldsCache(cm, changeObj.from.line, lineChanges);
            } else {
                updateFoldsCache(cm, changeObj.from.line, lineChanges);
            }
            if (lineChanges !== 0) {
                updateFoldInfo(cm, Math.max(0, changeObj.from.line + lineChanges), Math.max(0, changeObj.from.line + lineChanges) + 1);
            }
            state.from = changeObj.from.line;
            state.to = 0;
            window.clearTimeout(state.changeUpdate);
            state.changeUpdate = window.setTimeout(function () {
                updateInViewport(cm);
            }, 600);
        }
    }

    /**
      * Triggered on viewport changes e.g., user scrolls or resizes the viewport.
      * @param {!CodeMirror} cm the CodeMirror instance for the active editor
      */
    function onViewportChange(cm) {
        var state = cm.state.foldGutter;
        window.clearTimeout(state.changeUpdate);
        state.changeUpdate = window.setTimeout(function () {
            var vp = cm.getViewport();
            if (state.from === state.to || vp.from - state.to > 20 || state.from - vp.to > 20) {
                updateInViewport(cm);
            } else {
                cm.operation(function () {
                    if (vp.from < state.from) {
                        updateFoldInfo(cm, vp.from, state.from);
                        state.from = vp.from;
                    }
                    if (vp.to > state.to) {
                        updateFoldInfo(cm, state.to, vp.to);
                        state.to = vp.to;
                    } else {
                        updateFoldInfo(cm, vp.from, vp.to);
                        state.to = vp.to;
                        state.from = vp.from;
                    }
                });
            }
        }, 400);
    }

    /**
     * Triggered when the cursor moves in the editor and used to detect text selection changes
     * in the editor.
     * @param {!CodeMirror} cm the CodeMirror instance for the active editor
     */
    function onCursorActivity(cm) {
        var state = cm.state.foldGutter;
        var vp = cm.getViewport();
        window.clearTimeout(state.changeUpdate);
        state.changeUpdate = window.setTimeout(function () {
            //need to render the entire visible viewport to remove fold marks rendered from previous selections if any
            updateInViewport(cm, vp.from, vp.to);
        }, 400);
    }

    /**
      * Triggered when a code segment is folded.
      * @param {!CodeMirror} cm the CodeMirror instance for the active editor
      * @param {!Object} from  the ch and line position that designates the start of the region
      * @param {!Object} to the ch and line position that designates the end of the region
      */
    function onFold(cm, from, to) {
        var state = cm.state.foldGutter;
        updateFoldInfo(cm, from.line, from.line + 1);
    }

    /**
      * Triggered when a folded code segment is unfolded.
      * @param {!CodeMirror} cm the CodeMirror instance for the active editor
      * @param {!{line:number, ch:number}} from  the ch and line position that designates the start of the region
      * @param {!{line:number, ch:number}} to the ch and line position that designates the end of the region
      */
    function onUnFold(cm, from, to) {
        var state = cm.state.foldGutter;
        var vp = cm.getViewport();
        delete cm._lineFolds[from.line];
        updateFoldInfo(cm, from.line, to.line || vp.to);
    }

    /**
      * Initialises the fold gutter and registers event handlers for changes to document, viewport
      * and user interactions.
      */
    function init() {
        CodeMirror.defineOption("foldGutter", false, function (cm, val, old) {
            if (old && old !== CodeMirror.Init) {
                cm.clearGutter(cm.state.foldGutter.options.gutter);
                cm.state.foldGutter = null;
                cm.off("gutterClick", old.onGutterClick);
                cm.off("change", onChange);
                cm.off("viewportChange", onViewportChange);
                cm.off("cursorActivity", onCursorActivity);

                cm.off("fold", onFold);
                cm.off("unfold", onUnFold);
                cm.off("swapDoc", updateInViewport);
            }
            if (val) {
                cm.state.foldGutter = new State(parseOptions(val));
                updateInViewport(cm);
                cm.on("gutterClick", val.onGutterClick);
                cm.on("change", onChange);
                cm.on("viewportChange", onViewportChange);
                cm.on("cursorActivity", onCursorActivity);
                cm.on("fold", onFold);
                cm.on("unfold", onUnFold);
                cm.on("swapDoc", updateInViewport);
            }
        });
    }

    exports.init = init;
    exports.updateInViewport = updateInViewport;

});

/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2016 - 2021 Adobe Systems Incorporated. All rights reserved.
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

/**
 * Fold range finder for handlebars/mustache template type files.
 * @author Patrick Oladimeji
 * @date 14/08/2016 22:04:21
 */

define("foldhelpers/handlebarsFold", function (require, exports, module) {

    var CodeMirror  = brackets.getModule("thirdparty/CodeMirror/lib/codemirror"),
        _           = brackets.getModule("thirdparty/lodash"),
        StringUtils = brackets.getModule("utils/StringUtils");

    /**
     * Utility function for scanning the text in a document until a certain condition is met
     * @param {object}  cm  The code mirror object representing the document
     * @param {string}  startCh  The start character position for the scan operation
     * @param {number}  startLine The start line position for the scan operation
     * @param {function (string): boolean} condition A predicate function that takes in the text seen so far and returns true if the scanning process should be halted
     * @returns {{from:CodeMirror.Pos, to: CodeMirror.Pos, string: string}} An object representing the range of text scanned.
     */
    function scanTextUntil(cm, startCh, startLine, condition) {
        var line = cm.getLine(startLine),
            seen = "",
            characterIndex = startCh,
            currentLine = startLine,
            range;
        while (currentLine <= cm.lastLine()) {
            if (line.length === 0) {
                characterIndex = 0;
                line = cm.getLine(++currentLine);
            } else {
                seen = seen.concat(line[characterIndex] || "");
                if (condition(seen)) {
                    range = {
                        from: {ch: startCh, line: startLine},
                        to: {ch: characterIndex, line: currentLine},
                        string: seen
                    };
                    return range;
                } else if (characterIndex >= line.length) {
                    seen = seen.concat(cm.lineSeparator());
                    if (condition(seen)) {
                        range = {
                            from: {ch: startCh, line: startLine},
                            to: {ch: characterIndex, line: currentLine},
                            string: seen
                        };
                        return range;
                    }
                    characterIndex = 0;
                    line = cm.getLine(++currentLine);
                } else {
                    ++characterIndex;
                }
            }
        }
    }

    /**
     * Utility function used to detect the end of a helper name when scanning a series of text.
     * The end of a helper name is signalled by a space character or the `}`
     * @param   {string}  seen The string seen so far
     * @returns {boolean} True when the end of a helper name has been detected.
     */
    function endHelperName(seen) {
        return (/\s$/).test(seen) || StringUtils.endsWith(seen, "}");
    }

    /**
     * Returns a predicate function that returns true when a specific character is found
     * @param   {string}   character the character to use in the match function
     * @returns {function} A function that checks if the last character of the parameter string matches the parameter character
     */
    function readUntil(character) {
        return function (seen) {
            return seen[seen.length - 1] === character;
        };
    }

    function getRange(cm, start) {
        var currentLine = start.line,
            text = cm.getLine(currentLine) || "",
            i = 0,
            tagStack = [],
            braceStack = [],
            found,
            openTag,
            openPos,
            currentCharacter,
            openTagIndex = text.indexOf("{{"),
            range;

        if (openTagIndex < 0 || text[openTagIndex + 2] === "/") {
            return;
        }

        found = scanTextUntil(cm, openTagIndex + 2, currentLine, endHelperName);
        if (!found) {
            return;
        }

        openPos = {
            from: {line: currentLine, ch: openTagIndex},
            to: found.to
        };
        openTag = found.string.substring(0, found.string.length - 1);
        if (openTag[0] === "#" || openTag[0] === "~" || openTag[0] === "^") {
            found = scanTextUntil(cm, openPos.to.ch, openPos.to.line, function (seen) {
                return seen.length > 1 && seen.substr(-2) === "}}";
            });
            if (found) {
                openPos.to = {line: found.to.line, ch: found.to.ch + 1};
            }
            tagStack.push(openTag.substr(1));
        } else {
            braceStack.push("{{");
        }

        i = found.to.ch;
        currentLine = found.to.line;

        while (currentLine <= cm.lastLine()) {
            text = cm.getLine(currentLine);
            currentCharacter = (text && text[i]) || "";
            switch (currentCharacter) {
            case "{":
                if (text[i + 1] === "{") {
                    found = scanTextUntil(cm, i + 2, currentLine, endHelperName);
                    if (found) {
                        var tag = found.string.substring(0, found.string.length - 1);
                        if (tag[0] === "#" || tag[0] === "~" || tag[0] === "^") {
                            tagStack.push(tag.substr(1));
                        } else if (tag[0] === "/" &&
                                   (_.last(tagStack) === tag.substr(1) || _.last(tagStack) === "*" + tag.substr(1))) {
                            tagStack.pop();
                            if (tagStack.length === 0 && braceStack.length === 0) {
                                range = {
                                    from: openPos.to,
                                    to: {ch: i, line: currentLine}
                                };
                                return range;
                            }
                        } else {
                            braceStack.push("{{");
                        }
                    }
                }
                break;
            case "}":
                if (text[i + 1] === "}") {
                    braceStack.pop();
                    if (braceStack.length === 0 && tagStack.length === 0) {
                        range = {
                            from: openPos.to,
                            to: {ch: i, line: currentLine}
                        };
                        return range;
                    }
                }
                break;
            case "\"":
            case "'":
                found = scanTextUntil(cm, i + 1, currentLine, readUntil(text[i]));
                if (found) {
                    i = found.to.ch;
                    currentLine = found.to.line;
                }
                break;
            default:
                break;
            }

            ++i;
            if (i >= text.length) {
                ++currentLine;
                i = 0;
            }
        }
    }

    module.exports = getRange;
});

/**
 * Fold range finder based on line indentations. Ignores blank lines and commented lines
 * @author Patrick Oladimeji
 * @date 12/27/13 21:54:41 PM
 */

define("foldhelpers/indentFold", function (require, exports, module) {

    var CodeMirror  = brackets.getModule("thirdparty/CodeMirror/lib/codemirror"),
        cols        = CodeMirror.countColumn,
        pos         = CodeMirror.Pos;

    function lastNonEmptyLineNumber(cm) {
        var lc = cm.lastLine(), line = cm.getLine(lc);
        while (lc > 0 && line.trim().length === 0) {
            lc--;
            line = cm.getLine(lc);
        }
        return lc;
    }

    function indentFold(cm, start) {
        var lineText = cm.getLine(start.line), tabSize = cm.getOption("tabSize");

        var lineIndent = cols(lineText, null, tabSize), collapsible = false, lineCount = cm.lineCount();
        var token = cm.getTokenAt(pos(start.line, lineIndent + 1));
        //no folding for blank lines or commented lines
        if (lineText.trim().length === 0 || (token && token.type === "comment")) {
            return;
        }
        var i, indent, currentLine;
        for (i = start.line + 1; i < lineCount; i++) {
            currentLine = cm.getLine(i);
            indent = cols(currentLine, null, tabSize);

            token = cm.getTokenAt(pos(i, indent + 1));
            //only fold for non blank lines or non commented lines
            if (currentLine.trim().length !== 0 && (token && token.type !== "comment")) {
                if (!collapsible) {
                    if (indent > lineIndent) {
                        collapsible = true;
                    }
                } else {
                    if (indent <= lineIndent) {
                        return {from: pos(start.line, lineText.length),
                            to: pos(i - 1, cm.getLine(i - 1).length)};
                    }
                }

                if (indent === lineIndent || indent < lineIndent) {
                    return;
                }
            }
        }
        //use last nonempty line as the end of the folding region if there is no explicit end to this indent
        if (collapsible) {
            i = lastNonEmptyLineNumber(cm);
            return {from: pos(start.line, lineText.length), to: pos(i, cm.getLine(i).length)};
        }
    }

    module.exports = indentFold;
});
