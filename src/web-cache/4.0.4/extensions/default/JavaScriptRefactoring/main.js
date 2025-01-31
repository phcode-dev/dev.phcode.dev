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

define(function (require, exports, module) {



    var AppInit              = brackets.getModule("utils/AppInit"),
        PreferencesManager   = brackets.getModule("preferences/PreferencesManager"),
        Strings              = brackets.getModule("strings"),
        RenameIdentifier     = require("RenameIdentifier"),
        ExtractToVariable    = require("ExtractToVariable"),
        ExtractToFunction    = require("ExtractToFunction"),
        WrapSelection        = require("WrapSelection"),
        CommandManager       = brackets.getModule("command/CommandManager"),
        Menus                = brackets.getModule("command/Menus"),
        Metrics              = brackets.getModule("utils/Metrics"),
        _                    = brackets.getModule("thirdparty/lodash"),
        EditorManager        = brackets.getModule("editor/EditorManager");

    require("HighLightReferences");

    var jsRefactoringEnabled     = true;

    var KeyboardPrefs = JSON.parse(require("text!keyboard.json"));

    // Command ids
    var EXTRACTTO_VARIABLE       = "refactoring.extractToVariable",
        EXTRACTTO_FUNCTION       = "refactoring.extractToFunction",
        REFACTOR_RENAME          = "refactoring.renamereference",
        REFACTORWRAPINTRYCATCH   = "refactoring.wrapintrycatch",
        REFACTORWRAPINCONDITION  = "refactoring.wrapincondition",
        REFACTORCONVERTTOARROWFN = "refactoring.converttoarrowfunction",
        REFACTORCREATEGETSET     = "refactoring.creategettersandsetters";

    // This preference controls whether to create a session and process all JS files or not.
    PreferencesManager.definePreference("refactoring.JSRefactoring", "boolean", true, {
        description: Strings.DESCRIPTION_CODE_REFACTORING
    });


    /**
     * Check whether any of refactoring hints preferences for JS Refactoring is disabled
     * @return {boolean} enabled/disabled
     */
    function _isRefactoringEnabled() {
        return (PreferencesManager.get("refactoring.JSRefactoring") !== false);
    }

    PreferencesManager.on("change", "refactoring.JSRefactoring", function () {
        jsRefactoringEnabled = _isRefactoringEnabled();
    });

    function _handleRefactor(functionName) {
        var eventName, eventType = "";

        switch (functionName) {
        case REFACTOR_RENAME:
            eventName = REFACTOR_RENAME;
            eventType = "rename";
            RenameIdentifier.handleRename();
            break;
        case EXTRACTTO_VARIABLE:
            eventName = EXTRACTTO_VARIABLE;
            eventType = "extractToVariable";
            ExtractToVariable.handleExtractToVariable();
            break;
        case EXTRACTTO_FUNCTION:
            eventName = EXTRACTTO_FUNCTION;
            eventType = "extractToFunction";
            ExtractToFunction.handleExtractToFunction();
            break;
        case REFACTORWRAPINTRYCATCH:
            eventName = REFACTORWRAPINTRYCATCH;
            eventType = "wrapInTryCatch";
            WrapSelection.wrapInTryCatch();
            break;
        case REFACTORWRAPINCONDITION:
            eventName = REFACTORWRAPINCONDITION;
            eventType = "wrapInCondition";
            WrapSelection.wrapInCondition();
            break;
        case REFACTORCONVERTTOARROWFN:
            eventName = REFACTORCONVERTTOARROWFN;
            eventType = "convertToFunction";
            WrapSelection.convertToArrowFunction();
            break;
        case REFACTORCREATEGETSET:
            eventName = REFACTORCREATEGETSET;
            eventType = "createGetterSetter";
            WrapSelection.createGettersAndSetters();
            break;
        }
        if (eventName) {
            var editor = EditorManager.getActiveEditor();

            // Logging should be done only when the context is javascript
            if (!editor || editor.getModeForSelection() !== "javascript") {
                return;
            }
            // Send analytics data for js refactoring
            Metrics.countEvent(
                Metrics.EVENT_TYPE.CODE_HINTS,
                "jsRefactor",
                eventType
            );
        }
    }

    AppInit.appReady(function () {

        if (jsRefactoringEnabled) {
            var subMenu = Menus.getContextMenu(Menus.ContextMenuIds.EDITOR_MENU).addSubMenu(Strings.CMD_REFACTOR, "refactor-submenu");

            var menuLocation = Menus.AppMenuBar.EDIT_MENU;

            Menus.getMenu(menuLocation).addMenuDivider();

            // Rename Identifier
            CommandManager.register(Strings.CMD_REFACTORING_RENAME, REFACTOR_RENAME, _.partial(_handleRefactor, REFACTOR_RENAME));
            subMenu.addMenuItem(REFACTOR_RENAME);
            Menus.getMenu(menuLocation).addMenuItem(REFACTOR_RENAME, KeyboardPrefs.renameIdentifier);

            // Extract to Variable
            CommandManager.register(Strings.CMD_EXTRACTTO_VARIABLE, EXTRACTTO_VARIABLE, _.partial(_handleRefactor, EXTRACTTO_VARIABLE));
            subMenu.addMenuItem(EXTRACTTO_VARIABLE);
            Menus.getMenu(menuLocation).addMenuItem(EXTRACTTO_VARIABLE, KeyboardPrefs.extractToVariable);

            // Extract to Function
            CommandManager.register(Strings.CMD_EXTRACTTO_FUNCTION, EXTRACTTO_FUNCTION, _.partial(_handleRefactor, EXTRACTTO_FUNCTION));
            subMenu.addMenuItem(EXTRACTTO_FUNCTION);
            Menus.getMenu(menuLocation).addMenuItem(EXTRACTTO_FUNCTION, KeyboardPrefs.extractToFunction);

            // Wrap Selection
            CommandManager.register(Strings.CMD_REFACTORING_TRY_CATCH, REFACTORWRAPINTRYCATCH, _.partial(_handleRefactor, REFACTORWRAPINTRYCATCH));
            subMenu.addMenuItem(REFACTORWRAPINTRYCATCH);
            Menus.getMenu(menuLocation).addMenuItem(REFACTORWRAPINTRYCATCH);

            CommandManager.register(Strings.CMD_REFACTORING_CONDITION, REFACTORWRAPINCONDITION, _.partial(_handleRefactor, REFACTORWRAPINCONDITION));
            subMenu.addMenuItem(REFACTORWRAPINCONDITION);
            Menus.getMenu(menuLocation).addMenuItem(REFACTORWRAPINCONDITION);

            CommandManager.register(Strings.CMD_REFACTORING_ARROW_FUNCTION, REFACTORCONVERTTOARROWFN, _.partial(_handleRefactor, REFACTORCONVERTTOARROWFN));
            subMenu.addMenuItem(REFACTORCONVERTTOARROWFN);
            Menus.getMenu(menuLocation).addMenuItem(REFACTORCONVERTTOARROWFN);

            CommandManager.register(Strings.CMD_REFACTORING_GETTERS_SETTERS, REFACTORCREATEGETSET, _.partial(_handleRefactor, REFACTORCREATEGETSET));
            subMenu.addMenuItem(REFACTORCREATEGETSET);
            Menus.getMenu(menuLocation).addMenuItem(REFACTORCREATEGETSET);
        }
    });
});

/*
*  Copyright (c) 2021 - present core.ai . All rights reserved.
 *  Original work Copyright (c) 2013 - 2021 Adobe Systems Incorporated. All rights reserved.
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

define("ExtractToFunction", function(require, exports, module) {


    var ASTWalker           = brackets.getModule("thirdparty/acorn/dist/walk"),
        EditorManager       = brackets.getModule("editor/EditorManager"),
        _                   = brackets.getModule("thirdparty/lodash"),
        StringUtils         = brackets.getModule("utils/StringUtils"),
        Session             = brackets.getModule("JSUtils/Session"),
        RefactoringUtils    = require("RefactoringUtils"),
        Strings             = brackets.getModule("strings"),
        InlineMenu          = brackets.getModule("widgets/InlineMenu").InlineMenu;

    var template = JSON.parse(require("text!Templates.json"));

    var session = null;

    /**
     * Analyzes the code and finds values required for extract to function
     * @param {!string} text - text to be extracted
     * @param {!Array.<Scope>} - scopes
     * @param {!Scope} srcScope - source scope of the extraction
     * @param {!Scope} destScope - destination scope of the extraction
     * @param {!number} start - the start offset
     * @param {!number} end - the end offset
     * @return {!{
     *          passParams: Array.<string>,
     *          retParams: Array.<string>,
     *          thisPointerUsed: boolean,
     *          varaibleDeclarations: {} // variable-name: kind
     * }}
     */
    function analyzeCode(text, scopes, srcScope, destScope, start, end) {
        var identifiers          = {},
            inThisScope          = {},
            thisPointerUsed      = false,
            returnStatementUsed  = false,
            variableDeclarations = {},
            changedValues        = {},
            dependentValues      = {},
            ast                  = RefactoringUtils.getAST(text),
            doc                  = session.editor.document,
            restScopeStr;

        ASTWalker.full(ast, function(node) {
            var value, name;
            switch (node.type) {
            case "AssignmentExpression":
                value = node.left;
                break;
            case "VariableDeclarator":
                inThisScope[node.id.name] = true;
                value = node.init && node.id;
                var variableDeclarationNode = RefactoringUtils.findSurroundASTNode(ast, node, ["VariableDeclaration"]);
                variableDeclarations[node.id.name] = variableDeclarationNode.kind;
                break;
            case "ThisExpression":
                thisPointerUsed = true;
                break;
            case "UpdateExpression":
                value = node.argument;
                break;
            case "Identifier":
                identifiers[node.name] = true;
                break;
            case "ReturnStatement":
                returnStatementUsed = true;
                break;
            }
            if (value){
                if (value.type === "MemberExpression") {
                    name = value.object.name;
                } else {
                    name = value.name;
                }
                changedValues[name] = true;
            }
        });

        if (srcScope.originNode) {
            restScopeStr = doc.getText().substr(end, srcScope.originNode.end - end);
        } else {
            restScopeStr = doc.getText().substr(end);
        }

        ASTWalker.simple(RefactoringUtils.getAST(restScopeStr), {
            Identifier: function(node) {
                var name = node.name;
                dependentValues[name] = true;
            },
            Expression: function(node) {
                if (node.type === "MemberExpression") {
                    var name = node.object.name;
                    dependentValues[name] = true;
                }
            }
        });

        var passProps = scopes.slice(srcScope.id, destScope.id).reduce(function(props, scope) {
            return _.union(props, _.keys(scope.props));
        }, []);

        var retProps = scopes.slice(srcScope.id, destScope.id + 1).reduce(function(props, scope) {
            return _.union(props, _.keys(scope.props));
        }, []);

        return {
            passParams: _.intersection(_.difference(_.keys(identifiers), _.keys(inThisScope)), passProps),
            retParams: _.intersection( _.keys(changedValues), _.keys(dependentValues), retProps),
            thisPointerUsed: thisPointerUsed,
            returnStatementUsed: returnStatementUsed,
            variableDeclarations: variableDeclarations
        };
    }

    /**
     * Does the actual extraction. i.e Replacing the text, Creating a function
     * and multi select function names
     */
    function extract(ast, text, scopes, srcScope, destScope, start, end, isExpression) {
        var retObj               = analyzeCode(text, scopes, srcScope, destScope, start, end),
            passParams           = retObj.passParams,
            retParams            = retObj.retParams,
            thisPointerUsed      = retObj.thisPointerUsed,
            returnStatementUsed  = retObj.returnStatementUsed,
            variableDeclarations = retObj.variableDeclarations,
            doc                  = session.editor.document,
            fnBody               = text,
            fnName               = RefactoringUtils.getUniqueIdentifierName(scopes, "extracted"),
            fnDeclaration,
            fnCall;

        function appendVarDeclaration(identifier) {
            if (variableDeclarations.hasOwnProperty(identifier)) {
                return variableDeclarations[identifier] + " " + identifier;
            }

            return identifier;

        }

        if (destScope.isClass) {
            fnCall = StringUtils.format(template.functionCall.class, fnName, passParams.join(", "));
        } else if (thisPointerUsed) {
            passParams.unshift("this");
            fnCall = StringUtils.format(template.functionCall.thisPointer, fnName, passParams.join(", "));
            passParams.shift();
        } else {
            fnCall = StringUtils.format(template.functionCall.normal, fnName, passParams.join(", "));
        }

        // Append return to the fnCall, if the extracted text contains return statement
        // Ideally in this case retParams should be empty.
        if (returnStatementUsed) {
            fnCall = "return " + fnCall;
        }

        if (isExpression) {
            fnBody = StringUtils.format(template.returnStatement.single, fnBody);
        } else {

            var retParamsStr = "";
            if (retParams.length > 1) {
                retParamsStr = StringUtils.format(template.returnStatement.multiple, retParams.join(", "));
                fnCall = "var ret = " + fnCall + ";\n";
                fnCall += retParams.map(function (param) {
                    return StringUtils.format(template.assignment, appendVarDeclaration(param),  "ret." + param);
                }).join("\n");
            } else if (retParams.length === 1) {
                retParamsStr = StringUtils.format(template.returnStatement.single, retParams.join(", "));
                fnCall = StringUtils.format(template.assignment, appendVarDeclaration(retParams[0]), fnCall);
            } else {
                fnCall += ";";
            }

            fnBody = fnBody + "\n" + retParamsStr;
        }

        if (destScope.isClass) {
            fnDeclaration = StringUtils.format(template.functionDeclaration.class, fnName, passParams.join(", "), fnBody);
        } else {
            fnDeclaration = StringUtils.format(template.functionDeclaration.normal, fnName, passParams.join(", "), fnBody);
        }

        start = session.editor.posFromIndex(start);
        end   = session.editor.posFromIndex(end);

        // Get the insertion pos for function declaration
        var insertPos = _.clone(start);
        var fnScopes = scopes.filter(RefactoringUtils.isFnScope);

        for (var i = 0; i < fnScopes.length; ++i) {
            if (fnScopes[i].id === destScope.id) {
                if (fnScopes[i - 1]) {
                    insertPos = session.editor.posFromIndex(fnScopes[i - 1].originNode.start);
                     // If the origin node of the destination scope is a function expression or a arrow function expression,
                     // get the surrounding statement to get the position
                    if (fnScopes[i - 1].originNode.type === "FunctionExpression" || fnScopes[i - 1].originNode.type === "ArrowFunctionExpression") {
                        var surroundStatement = RefactoringUtils.findSurroundASTNode(ast, { start: session.editor.indexFromPos(insertPos)}, ["Statement"]);
                        insertPos = session.editor.posFromIndex(surroundStatement.start);
                    }
                }
                break;
            }
        }

        insertPos.ch = 0;

        // Replace and multi-select and indent
        doc.batchOperation(function() {
            // Replace
            doc.replaceRange(fnCall, start, end);
            doc.replaceRange(fnDeclaration, insertPos);

            // Set selections
            start = doc.adjustPosForChange(start, fnDeclaration.split("\n"), insertPos, insertPos);
            end   = doc.adjustPosForChange(end, fnDeclaration.split("\n"), insertPos, insertPos);

            session.editor.setSelections([
                {
                    start: session.editor.posFromIndex(session.editor.indexFromPos(start) + fnCall.indexOf(fnName)),
                    end: session.editor.posFromIndex(session.editor.indexFromPos(start) + fnCall.indexOf(fnName) + fnName.length)
                },
                {
                    start: session.editor.posFromIndex(session.editor.indexFromPos(insertPos) + fnDeclaration.indexOf(fnName)),
                    end: session.editor.posFromIndex(session.editor.indexFromPos(insertPos) + fnDeclaration.indexOf(fnName) + fnName.length)
                }
            ]);

            // indent
            for (var i = start.line; i < start.line + RefactoringUtils.numLines(fnCall); ++i) {
                session.editor._codeMirror.indentLine(i, "smart");
            }
            for (var i = insertPos.line; i < insertPos.line + RefactoringUtils.numLines(fnDeclaration); ++i) {
                session.editor._codeMirror.indentLine(i, "smart");
            }
        });
    }

    /**
     * Main function that handles extract to function
     */
    function handleExtractToFunction() {
        var editor = EditorManager.getActiveEditor();
        var result = new $.Deferred(); // used only for testing purpose

        if (editor.getSelections().length > 1) {
            editor.displayErrorMessageAtCursor(Strings.ERROR_EXTRACTTO_FUNCTION_MULTICURSORS);
            result.resolve(Strings.ERROR_EXTRACTTO_FUNCTION_MULTICURSORS);
            return;
        }
        initializeSession(editor);

        var selection = editor.getSelection(),
            doc       = editor.document,
            retObj    = RefactoringUtils.normalizeText(editor.getSelectedText(), editor.indexFromPos(selection.start), editor.indexFromPos(selection.end)),
            text      = retObj.text,
            start     = retObj.start,
            end       = retObj.end,
            ast,
            scopes,
            expns,
            inlineMenu;

        RefactoringUtils.getScopeData(session, editor.posFromIndex(start)).done(function(scope) {
            ast = RefactoringUtils.getAST(doc.getText());

            var isExpression = false;
            if (!RefactoringUtils.checkStatement(ast, start, end, doc.getText())) {
                isExpression = RefactoringUtils.getExpression(ast, start, end, doc.getText());
                if (!isExpression) {
                    editor.displayErrorMessageAtCursor(Strings.ERROR_EXTRACTTO_FUNCTION_NOT_VALID);
                    result.resolve(Strings.ERROR_EXTRACTTO_FUNCTION_NOT_VALID);
                    return;
                }
            }
            scopes = RefactoringUtils.getAllScopes(ast, scope, doc.getText());

            // if only one scope, extract without menu
            if (scopes.length === 1) {
                extract(ast, text, scopes, scopes[0], scopes[0], start, end, isExpression);
                result.resolve();
                return;
            }

            inlineMenu = new InlineMenu(editor, Strings.EXTRACTTO_FUNCTION_SELECT_SCOPE);

            inlineMenu.open(scopes.filter(RefactoringUtils.isFnScope));

            result.resolve(inlineMenu);

            inlineMenu.onSelect(function (scopeId) {
                extract(ast, text, scopes, scopes[0], scopes[scopeId], start, end, isExpression);
                inlineMenu.close();
            });

            inlineMenu.onClose(function(){
                inlineMenu.close();
            });
        }).fail(function() {
            editor.displayErrorMessageAtCursor(Strings.ERROR_TERN_FAILED);
            result.resolve(Strings.ERROR_TERN_FAILED);
        });

        return result.promise();
    }

    /**
     * Creates a new session from editor and stores it in session global variable
     */
    function initializeSession(editor) {
        session = new Session(editor);
    }

    exports.handleExtractToFunction = handleExtractToFunction;
});

/*
*  Copyright (c) 2021 - present core.ai . All rights reserved.
 *  Original work Copyright (c) 2013 - 2021 Adobe Systems Incorporated. All rights reserved.
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

define("ExtractToVariable", function(require, exports, module) {


    var ASTWalker           = brackets.getModule("thirdparty/acorn/dist/walk"),
        EditorManager       = brackets.getModule("editor/EditorManager"),
        Session             = brackets.getModule("JSUtils/Session"),
        RefactoringUtils    = require("RefactoringUtils"),
        Strings             = brackets.getModule("strings"),
        InlineMenu          = brackets.getModule("widgets/InlineMenu").InlineMenu;

    var session = null;

    /**
     * Does the actual extraction. i.e Replacing the text, Creating a variable
     * and multi select variable names
     */
    function extract(scopes, parentStatement, expns, text, insertPosition) {
        var varType          = "var",
            varName          = RefactoringUtils.getUniqueIdentifierName(scopes, "extracted"),
            varDeclaration   = varType + " " + varName + " = " + text + ";\n",
            parentStatementStartPos = session.editor.posFromIndex(parentStatement.start),
            insertStartPos   = insertPosition || parentStatementStartPos,
            selections       = [],
            doc              = session.editor.document,
            replaceExpnIndex = 0,
            posToIndent,
            edits            = [];

        // If parent statement is expression statement, then just append var declaration
        // Ex: "add(1, 2)" will become "var extracted = add(1, 2)"
        if (parentStatement.type === "ExpressionStatement" &&
                RefactoringUtils.isEqual(parentStatement.expression, expns[0]) &&
                insertStartPos.line === parentStatementStartPos.line &&
                insertStartPos.ch === parentStatementStartPos.ch) {
            varDeclaration = varType + " " + varName + " = ";
            replaceExpnIndex = 1;
        }

        posToIndent = doc.adjustPosForChange(insertStartPos, varDeclaration.split("\n"), insertStartPos, insertStartPos);

        // adjust pos for change
        for (var i = replaceExpnIndex; i < expns.length; ++i) {
            expns[i].start  = session.editor.posFromIndex(expns[i].start);
            expns[i].end    = session.editor.posFromIndex(expns[i].end);
            expns[i].start  = doc.adjustPosForChange(expns[i].start, varDeclaration.split("\n"), insertStartPos, insertStartPos);
            expns[i].end    = doc.adjustPosForChange(expns[i].end, varDeclaration.split("\n"), insertStartPos, insertStartPos);

            edits.push({
                edit: {
                    text: varName,
                    start: expns[i].start,
                    end: expns[i].end
                },
                selection: {
                    start: expns[i].start,
                    end: {line: expns[i].start.line, ch: expns[i].start.ch + varName.length}
                }
            });
        }

        // Replace and multi-select
        doc.batchOperation(function() {
            doc.replaceRange(varDeclaration, insertStartPos);

            selections = doc.doMultipleEdits(edits);
            selections.push({
                start: {line: insertStartPos.line, ch: insertStartPos.ch + varType.length + 1},
                end: {line: insertStartPos.line, ch: insertStartPos.ch + varType.length + varName.length + 1},
                primary: true
            });
            session.editor.setSelections(selections);
            session.editor._codeMirror.indentLine(posToIndent.line, "smart");
        });
    }

    /**
     * Find all expressions in the parentBlockStatement that are same as expn
     * @param {!ASTNode} parentBlockStatement
     * @param {!ASTNode} expn
     * @param {!string} text - text of the expression
     * @return {!Array.<ASTNode>}
     */
    function findAllExpressions(parentBlockStatement, expn, text) {
        var doc   = session.editor.document,
            obj   = {},
            expns = [];

        // find all references of the expression
        obj[expn.type] = function(node) {
            if (text === doc.getText().substr(node.start, node.end - node.start)) {
                expns.push(node);
            }
        };
        ASTWalker.simple(parentBlockStatement, obj);

        return expns;
    }

    /**
     * Gets the surrounding expressions of start and end offset
     * @param {!ASTNode} ast - the ast of the complete file
     * @param {!number} start - the start offset
     * @param {!number} end - the end offset
     * @return {!Array.<ASTNode>}
     */
    function getExpressions(ast, start, end) {
        var expns = [],
            s     = start,
            e     = end,
            expn;

        while (true) {
            expn = RefactoringUtils.findSurroundExpression(ast, {start: s, end: e});
            if (!expn) {
                break;
            }
            expns.push(expn);
            s = expn.start - 1;
        }

        s = start;
        e = end;

        function checkExpnEquality(e) {
            return e.start === expn.start && e.end === expn.end;
        }

        while (true) {
            expn = RefactoringUtils.findSurroundExpression(ast, {start: s, end: e});
            if (!expn) {
                break;
            }
            e = expn.end + 1;

            // if expn already added, continue
            if (expns.find(checkExpnEquality)) {
                continue;
            }

            expns.push(expn);
        }

        return expns;
    }

    /**
     * Creates params needed for extraction and calls extract
     * extract() does the actual extraction
     */
    function extractToVariable(ast, start, end, text, scopes) {
        var doc                   = session.editor.document,
            editor = EditorManager.getActiveEditor(),
            parentExpn            = RefactoringUtils.getExpression(ast, start, end, doc.getText()),
            expns                 = [],
            parentBlockStatement,
            parentStatement;

        if (!parentExpn) {
            session.editor.displayErrorMessageAtCursor(Strings.ERROR_EXTRACTTO_VARIABLE_NOT_VALID);
            return;
        }

        // Find all expressions only if selected expn is not a subexpression
        // In case of subexpressions, ast cannot be used to find all expressions
        if (doc.getText().substr(parentExpn.start, parentExpn.end - parentExpn.start) === text) {
            parentBlockStatement = RefactoringUtils.findSurroundASTNode(ast, parentExpn, ["BlockStatement", "Program"]);
            expns                = findAllExpressions(parentBlockStatement, parentExpn, text);

            RefactoringUtils.getScopeData(session, editor.posFromIndex(expns[0].start)).done(function(scope) {
                var firstExpnsScopes = RefactoringUtils.getAllScopes(ast, scope, doc.getText()),
                    insertPostion;
                parentStatement = RefactoringUtils.findSurroundASTNode(ast, expns[0], ["Statement"]);
                if (scopes.length < firstExpnsScopes.length) {
                    var parentScope;
                    if (expns[0].body && expns[0].body.type === "BlockStatement") {
                        parentScope = firstExpnsScopes[firstExpnsScopes.length - scopes.length];
                    } else {
                        parentScope = firstExpnsScopes[firstExpnsScopes.length - scopes.length - 1];
                    }

                    var insertNode = RefactoringUtils.findSurroundASTNode(ast, parentScope.originNode, ["Statement"]);
                    if (insertNode) {
                        insertPostion = session.editor.posFromIndex(insertNode.start);
                    }
                }
                extract(scopes, parentStatement, expns, text, insertPostion);
            });
        } else {
            parentStatement = RefactoringUtils.findSurroundASTNode(ast, parentExpn, ["Statement"]);
            extract(scopes, parentStatement, [{ start: start, end: end }], text);
        }
    }


    /**
     * Main function that handles extract to variable
     */
    function handleExtractToVariable() {
        var editor = EditorManager.getActiveEditor();

        if (editor.getSelections().length > 1) {
            editor.displayErrorMessageAtCursor(Strings.ERROR_EXTRACTTO_VARIABLE_MULTICURSORS);
            return;
        }

        initializeSession(editor);

        var selection = editor.getSelection(),
            doc       = editor.document,
            retObj    = RefactoringUtils.normalizeText(editor.getSelectedText(), editor.indexFromPos(selection.start),
                        editor.indexFromPos(selection.end), true),
            text      = retObj.text,
            start     = retObj.start,
            end       = retObj.end,
            ast,
            scopes,
            expns,
            inlineMenu;

        function callExtractToVariable(startPos, endPos, value) {
            RefactoringUtils.getScopeData(session, editor.posFromIndex(startPos))
                .done(function(expnscope) {
                    scopes = RefactoringUtils.getAllScopes(ast, expnscope, doc.getText());
                    extractToVariable(ast, startPos, endPos, value, scopes);
                }).fail(function() {
                    editor.displayErrorMessageAtCursor(Strings.ERROR_TERN_FAILED);
                });
        }

        RefactoringUtils.getScopeData(session, editor.posFromIndex(start)).done(function(scope) {
            ast = RefactoringUtils.getAST(doc.getText());
            scopes = RefactoringUtils.getAllScopes(ast, scope, doc.getText());

            if (editor.hasSelection()) {
                extractToVariable(ast, start, end, text, scopes);
            } else {
                expns = getExpressions(ast, start, end);

                expns.forEach(function(expn, index) {
                    expn.value = doc.getText().substr(expn.start, expn.end - expn.start);
                });

                // Sort expressions by their length
                expns.sort(function(a, b) {
                    return a.value.length - b.value.length;
                });

                if (!expns || !expns.length) {
                    session.editor.displayErrorMessageAtCursor(Strings.ERROR_EXTRACTTO_VARIABLE_NOT_VALID);
                    return;
                }

                // Filter expns based on length of first surrounding expression
                var firstExpnLength = RefactoringUtils.numLines(expns[0].value);
                expns = expns.filter(function(expn) {
                    return RefactoringUtils.numLines(expn.value) === firstExpnLength;
                });

                // Add name for the expression based on its value
                expns.forEach(function(expn, index) {
                    // If expn name is multi-line, display only first line
                    if (RefactoringUtils.numLines(expn.value) > 1) {
                        expn.name = expn.value.substr(0, expn.value.indexOf("\n")) + "...";
                    } else {
                        expn.name = expn.value;
                    }
                });

                // If only one surround expression, extract
                if (expns.length === 1) {
                    callExtractToVariable(expns[0].start, expns[0].end, expns[0].value);
                    return;
                }

                expns.forEach(function(expn, index) {
                    expn.id = index;
                });

                // UI for extract to variable
                inlineMenu = new InlineMenu(session.editor, Strings.EXTRACTTO_VARIABLE_SELECT_EXPRESSION);

                inlineMenu.onHover(function (expnId) {
                    // Remove the scroll Handlers If already Attached.
                    editor.off("scroll.inlinemenu");
                    // Add a scroll handler If Selection Range is not View.
                    // This is Added for a Bug, where Menu used not to open for the first Time
                    if(!editor.isLineVisible(editor.posFromIndex(expns[expnId].end).line)) {
                        editor.on("scroll.inlinemenu", function() {
                            // Remove the Handlers so that If scroll event is triggerd again by any other operation
                            // Menu should not be reopened.
                            // Menu Should be reopened only if Scroll event is triggered by onHover.
                            editor.off("scroll.inlinemenu");
                            inlineMenu.openRemovedMenu();
                        });
                    }
                    editor.setSelection(editor.posFromIndex(expns[expnId].start), editor.posFromIndex(expns[expnId].end));
                });

                inlineMenu.open(expns);

                inlineMenu.onSelect(function (expnId) {
                    callExtractToVariable(expns[expnId].start, expns[expnId].end, expns[expnId].value);
                    inlineMenu.close();
                });

                inlineMenu.onClose(function () {
                    inlineMenu.close();
                });
            }
        }).fail(function() {
            editor.displayErrorMessageAtCursor(Strings.ERROR_TERN_FAILED);
        });
    }

    /**
     * Creates a new session from editor and stores it in session global variable
     */
    function initializeSession(editor) {
        session = new Session(editor);
    }

    exports.handleExtractToVariable = handleExtractToVariable;
});

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

define("HighLightReferences", function (require, exports, module) {


    let EditorManager        = brackets.getModule("editor/EditorManager"),
        ScopeManager         = brackets.getModule("JSUtils/ScopeManager"),
        Session              = brackets.getModule("JSUtils/Session"),
        MessageIds           = JSON.parse(brackets.getModule("text!JSUtils/MessageIds.json")),
        Editor               = brackets.getModule("editor/Editor").Editor;

    let session             = null;

    //Create new session
    function initializeSession(editor) {
        session = new Session(editor);
    }

    //Post message to tern node domain that will request tern server to find refs
    function getRefs(fileInfo, offset) {
        ScopeManager.postMessage({
            type: MessageIds.TERN_REFS,
            fileInfo: fileInfo,
            offset: offset
        });

        return ScopeManager.addPendingRequest(fileInfo.name, offset, MessageIds.TERN_REFS);
    }

    //Create info required to find reference
    function requestFindRefs(session, document, offset) {
        if (!document || !session) {
            return;
        }
        let path    = document.file.fullPath,
            fileInfo = {
                type: MessageIds.TERN_FILE_INFO_TYPE_FULL,
                name: path,
                offsetLines: 0,
                text: ScopeManager.filterText(session.getJavascriptText())
            };
        let ternPromise = getRefs(fileInfo, offset);

        return {promise: ternPromise};
    }

    // This is the highlight references under cursor feature. We should ideally move this to
    // features/findReferencesManager

    const HIGHLIGHT_REFS_MARKER = "JS_REFS";

    function _handleHighLightRefs(editor, refsResp) {
        if (!refsResp || !refsResp.references || !refsResp.references.refs) {
            return;
        }
        editor.operation(function () {
            for(let ref of refsResp.references.refs){
                if(editor.document.file.fullPath.endsWith(ref.file)){
                    editor.markText(HIGHLIGHT_REFS_MARKER, ref.start, ref.end, Editor.getMarkOptionMatchingRefs());
                }
            }
        });
    }

    function _hasASingleCursor(editor) {
        let selections = editor.getSelections();
        if(selections.length > 1){
            // multi cursor, no highlight
            return false;
        }
        let start = selections[0].start,
            end = selections[0].end;
        if(start.line !== end.line || start.ch !== end.ch){
            // has a range selection
            return false;
        }
        return true;
    }

    let allowedHighlightTypes = ["def", "variable", "variable-2", "variable-3", "property"];
    let lastHighlightToken = {};
    function _cursorActivity(_evt, editor) {
        // Only provide a JavaScript editor when cursor is in JavaScript content
        if (editor.getModeForSelection() !== "javascript") {
            return;
        }

        if(!_hasASingleCursor(editor)){
            editor.clearAllMarks(HIGHLIGHT_REFS_MARKER);
            return;
        }

        let token = editor.getToken();
        if(lastHighlightToken === token) {
            return;
        }

        editor.clearAllMarks(HIGHLIGHT_REFS_MARKER);
        lastHighlightToken = token;
        if(!allowedHighlightTypes.includes(token.type)){
            return;
        }

        let offset = session.getOffset();

        // only do this request if token under cursor is a variable type
        requestFindRefs(session, session.editor.document, offset).promise
            .done(response =>{
                _handleHighLightRefs(editor, response);
            })
            .fail(function (err) {
                console.error("find references failed with: ", err);
            });
    }

    function _activeEditorChanged(_evt,  current, previous) {
        if(previous){
            previous.off("cursorActivity.highlightRefs");
        }
        if(current){
            current.off("cursorActivity.highlightRefs");
            current.on("cursorActivity.highlightRefs", _cursorActivity);
            initializeSession(current);
            _cursorActivity(_evt, current);
        }
    }

    EditorManager.on("activeEditorChange", _activeEditorChanged);

    exports.HIGHLIGHT_REFS_MARKER = HIGHLIGHT_REFS_MARKER;
});

/*
*  Copyright (c) 2021 - present core.ai . All rights reserved.
 *  Original work Copyright (c) 2013 - 2021 Adobe Systems Incorporated. All rights reserved.
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

/*
 * Utilities functions related to refactoring
 */
define("RefactoringUtils", function (require, exports, module) {


    var Acorn         = brackets.getModule("thirdparty/acorn/dist/acorn"),
        ASTWalker     = brackets.getModule("thirdparty/acorn/dist/walk"),
        MessageIds    = JSON.parse(brackets.getModule("text!JSUtils/MessageIds.json")),
        _             = brackets.getModule("thirdparty/lodash"),
        AcornLoose    = brackets.getModule("thirdparty/acorn/dist/acorn_loose"),
        ScopeManager  = brackets.getModule("JSUtils/ScopeManager");


    var templates = JSON.parse(require("text!Templates.json"));



    // Length of the function body used as function name for nameless functions
    var FUNCTION_BODY_PREFIX_LENGTH = 30;

    /**
     * Checks whether two ast nodes are equal
     * @param {!ASTNode} a
     * @param {!ASTNode} b
     * @return {boolean}
     */
    function isEqual(a, b) {
        return a.start === b.start && a.end === b.end;
    }

    /**
     * Gets a expression surrounding start and end (if any)
     * @param {!ASTNode} ast - the ast of the complete file
     * @param {!number} start - the start offset
     * @param {!number} end - the end offset
     * @param {!string} fileText - the entire file text
     * @return {ASTNode|boolean}
     */
    function getExpression(ast, start, end, fileText) {
        var expn = findSurroundExpression(ast, {start: start, end: end});
        if (!expn) {
            return false;
        }

        // Class Expression also includes the trailing semicolon
        // Add special case for it
        if (expn.type === "ClassExpression" && expn.start === start && expn.end - end <= 1) {
            expn.end = end;
            return expn;
        }        else if (expn.start === start && expn.end === end) {
            return expn;
        }

        // Subexpressions are possible only for BinaryExpression, LogicalExpression and SequenceExpression
        if (!(["BinaryExpression", "LogicalExpression", "SequenceExpression"].includes(expn.type))) {
            return false;
        }

        // Check subexpression
        var parentExpn = expn;
        var parentExpStr = fileText.substr(parentExpn.start, parentExpn.end - parentExpn.start);

        // Check whether the parentExpn forms a valid expression after replacing the sub expression
        var str = parentExpStr.substr(0, start - parentExpn.start) + "placeHolder" + parentExpStr.substr(end - parentExpn.start);
        var node = isStandAloneExpression(str);
        if (node && node.type === parentExpn.type) {
            return parentExpn;
        }

        return false;
    }

    function getAST(text) {
        var ast;
        try {
            ast = Acorn.parse(text, {ecmaVersion: 9});
        } catch(e) {
            ast = AcornLoose.parse(text, {ecmaVersion: 9});
        }
        return ast;
    }

    /*
     * Checks whether the text between start and end offsets form a valid set of statements
     * @param {!ASTNode} ast - the ast of the complete file
     * @param {!number} start - the start offset
     * @param {!number} end - the end offset
     * @param {!string} fileText - the entire file text
     * @return {boolean}
     */
    function checkStatement(ast, start, end, fileText) {
        // Do not allow function or class nodes
        var notStatement = false;
        ASTWalker.simple(getAST(fileText.substr(start, end - start)), {
            FunctionDeclaration: function (node) {
                notStatement = true;
            },
            ClassDeclaration: function (node) {
                notStatement = true;
            }
        });

        if (notStatement) {
            return false;
        }

        var startStatement = findSurroundASTNode(ast, {start: start}, ["Statement"]);
        var endStatement   = findSurroundASTNode(ast, {start: end}, ["Statement"]);

        return startStatement && endStatement && startStatement.start === start &&
            startStatement.end <= end && endStatement.start >= start &&
            endStatement.end === end;
    }

    /**
     * Gets a unique identifier name in the scope that starts with prefix
     * @param {!Scope} scopes - an array of all scopes returned from tern (each element contains 'props' with identifiers
     *  in that scope)
     * @param {!string} prefix - prefix of the identifier
     * @param {number} num - number to start checking for
     * @return {!string} identifier name
     */
    function getUniqueIdentifierName(scopes, prefix, num) {
        if (!scopes) {
            return prefix;
        }

        var props = scopes.reduce(function(props, scope) {
            return _.union(props, _.keys(scope.props));
        }, []);

        if (!props) {
            return prefix;
        }

        num = num || "1";
        var name;
        while (num < 100) { // limit search length
            name = prefix + num;
            if (props.indexOf(name) === -1) {
                break;
            }
            ++num;
        }
        return name;
    }

    /**
     * Returns the no of lines in the text
     * @param {!string} text
     * @return {number}
     */
    function numLines(text) {
        return text.split("\n").length;
    }

    /**
     * Checks whether the text forms a stand alone expression without considering the context of text
     * @param {!string} text
     * @return {boolean}
     */
    function isStandAloneExpression(text) {
        var found = ASTWalker.findNodeAt(getAST(text), 0, text.length, function (nodeType, node) {
            if (nodeType === "Expression") {
                return true;
            }
            return false;
        });
        return found && found.node;
    }

    /**
     * Requests scope data from tern
     * @param {!Session} session
     * @param {!{line: number, ch: number}} offset
     * @return {!$.Promise} a jQuery promise that will be resolved with the scope data
     */
    function getScopeData(session, offset) {
        var path = session.path,
            fileInfo = {
                type: MessageIds.TERN_FILE_INFO_TYPE_FULL,
                name: path,
                offsetLines: 0,
                text: ScopeManager.filterText(session.getJavascriptText())
            };

        ScopeManager.postMessage({
            type: MessageIds.TERN_SCOPEDATA_MSG,
            fileInfo: fileInfo,
            offset: offset
        });

        var ternPromise = ScopeManager.addPendingRequest(fileInfo.name, offset, MessageIds.TERN_SCOPEDATA_MSG);

        var result = new $.Deferred();

        ternPromise.done(function (response) {
            result.resolveWith(null, [response.scope]);
        }).fail(function () {
            result.reject();
        });

        return result;
    }

    /**
    * Normalize text by removing leading and trailing whitespace characters
    * and moves the start and end offset to reflect the new offset
    * @param {!string} text - selected text
    * @param {!number} start - the start offset of the text
    * @param {!number} end - the end offset of the text
    * @param {!boolean} removeTrailingSemiColons - removes trailing semicolons also if true
    * @return {!{text: string, start: number, end: number}}
    */
    function normalizeText(text, start, end, removeTrailingSemiColons) {
        var trimmedText;

        // Remove leading spaces
        trimmedText = _.trimLeft(text);

        if (trimmedText.length < text.length) {
            start += (text.length - trimmedText.length);
        }

        text = trimmedText;

        // Remove trailing spaces
        trimmedText = _.trimRight(text);

        if (trimmedText.length < text.length) {
            end -= (text.length - trimmedText.length);
        }

        text = trimmedText;

        // Remove trailing semicolons
        if (removeTrailingSemiColons) {
            trimmedText = _.trimRight(text, ';');

            if (trimmedText.length < text.length) {
                end -= (text.length - trimmedText.length);
            }
        }

        return {
            text: trimmedText,
            start: start,
            end: end
        };
    }

    /**
     * Checks whether the scope is a function scope
     */
    function isFnScope(scope) {
        return !scope.isBlock && !scope.isCatch;
    }

    function findSurroundExpression(ast, expn) {
        var start = expn.start;
        var end = expn.end;
        var surroundExpn;

        while (true) {
            surroundExpn = findSurroundASTNode(ast, {start: start, end: end}, ["Expression"]);

            if (!surroundExpn) {
                return null;
            }

            // Do not allow sequence expressions
            if (surroundExpn.type === "SequenceExpression") {
                start = surroundExpn.start - 1;
            }            else if (surroundExpn.type === "FunctionExpression") { // Do not allow method definition expressions
                var methodDefinitionNode = findSurroundASTNode(ast, surroundExpn, ["MethodDefinition"]);
                if (methodDefinitionNode && isEqual(methodDefinitionNode.value, surroundExpn)) {
                    start = surroundExpn.start - 1;
                } else {
                    return surroundExpn;
                }
            } else {
                return surroundExpn;
            }
        }

        return surroundExpn;
    }

    /**
     * Finds the surrounding ast node of the given expression of any of the given types
     * @param {!ASTNode} ast
     * @param {!{start: number, end: number}} expn - contains start and end offsets of expn
     * @param {!Array.<string>} types
     * @return {?ASTNode}
     */
    function findSurroundASTNode(ast, expn, types) {
        var foundNode = ASTWalker.findNodeAround(ast, expn.start, function (nodeType, node) {
            if (expn.end) {
                return types.includes(nodeType) && node.end >= expn.end;
            }
            return types.includes(nodeType);

        });
        return foundNode && _.clone(foundNode.node);
    }

    /**
     * Converts the scopes returned from tern to an array of scopes and adds id and name to the scope
     * Also checks for class scopes
     * @param {!ASTNode} ast - ast of the complete file
     * @param {!Scope} scope - scope returned from tern
     * @param {!string} fullText - the complete text of a file
     * @return {!Array.<Scope>}
     */
    function getAllScopes(ast, scope, fullText) {
        var curScope = scope;
        var cnt = 0;
        var scopes = [];

        while (curScope) {
            curScope.id = cnt++;
            scopes.push(curScope);

            if (curScope.fnType) {
                // Check for class scopes surrounding the function
                if (curScope.fnType === "FunctionExpression") {
                    var methodDefinitionNode = findSurroundASTNode(ast, curScope.originNode, ["MethodDefinition"]);
                    // class scope found
                    if (methodDefinitionNode && isEqual(methodDefinitionNode.value, curScope.originNode)) {
                        // Change curScope name and originNode to that of methodDefinitionNode
                        curScope.name = methodDefinitionNode.key.name;
                        curScope.originNode = methodDefinitionNode;

                        var classNode = findSurroundASTNode(ast, methodDefinitionNode, ["ClassDeclaration", "ClassExpression"]);

                        if (classNode) {
                            // Class Declaration found add it to scopes
                            var temp = curScope.prev;
                            var newScope = {};
                            newScope.isClass = true;

                            // if the class is class expression, check if it has a name
                            if (classNode.type === "ClassExpression") {
                                var assignmentExpNode = findSurroundASTNode(ast, classNode, ["AssignmentExpression"]);
                                if (assignmentExpNode && assignmentExpNode.left && assignmentExpNode.left.name) {
                                    newScope.name = "class " + assignmentExpNode.left.name;
                                } else {
                                    var varDeclaratorNode = findSurroundASTNode(ast, classNode, ["VariableDeclarator"]);
                                    if (varDeclaratorNode && varDeclaratorNode.id && varDeclaratorNode.id.name) {
                                        newScope.name = "class " + varDeclaratorNode.id.name;
                                    } else {
                                        newScope.name = "class null";
                                    }
                                }
                            } else {
                                newScope.name = "class " + (classNode.id && classNode.id.name);
                            }
                            newScope.originNode = classNode;
                            curScope.prev = newScope;
                            newScope.prev = temp;
                        }
                    } else {
                        // For function expressions, assign name to prefix of the function body
                        curScope.name = "function starting with " +
                            fullText.substr(
                                curScope.originNode.body.start,
                                Math.min(
                                    FUNCTION_BODY_PREFIX_LENGTH,
                                    curScope.originNode.body.end - curScope.originNode.body.start
                                )
                            );
                    }
                } else {
                    // Acorn parse marks name with '✖' under erroneous declarations, check it
                    if (curScope.fnType === "✖") {
                        curScope.name = "function starting with " +
                            fullText.substr(
                                curScope.originNode.body.start,
                                Math.min(
                                    FUNCTION_BODY_PREFIX_LENGTH,
                                    curScope.originNode.body.end - curScope.originNode.body.start
                                )
                            );
                    } else {
                        curScope.name = curScope.fnType;
                    }
                }
            } else if (!curScope.originNode) {
                curScope.name = "global";
            }

            curScope = curScope.prev;
        }
        return scopes;
    }

    /**
     * Note - To use these state defined in Refactoring Session,
     * Please reinitialize this RefactoringSession after performing any of the below operations
     * (i.e. replaceRange, setSelection or indentLine)
     *
     * RefactoringSession objects encapsulate state associated with a refactoring session
     * and This will help finding information around documents, selection,
     * position, ast, and queries around AST nodes
     *
     * @constructor
     * @param {Editor} editor - the editor context for the session
     */
    function RefactoringSession(editor) {
        this.editor = editor;
        this.document = editor.document;
        this.selection = editor.getSelection();
        this.text = this.document.getText();
        this.selectedText = editor.getSelectedText();
        this.cm = editor._codeMirror;
        this.startIndex = editor.indexFromPos(this.selection.start);
        this.endIndex = editor.indexFromPos(this.selection.end);
        this.startPos = this.selection.start;
        this.endPos = this.selection.end;
        this.ast = this.createAstOfCurrentDoc();
    }

    /**
     * Get the end position of given line
     *
     * @param {number} line - line number
     * @return {{line: number, ch: number}} - line end position
     */
    RefactoringSession.prototype.lineEndPosition = function (line) {
        var lineText = this.document.getLine(line);

        return {
            line: line,
            ch: lineText.length
        };
    };

    /**
     * Get the ast of current opened document in focused editor
     *
     * @return {Object} - Ast of current opened doc
     */
    RefactoringSession.prototype.createAstOfCurrentDoc = function () {
        var ast,
            text = this.document.getText();
        try {
            ast = Acorn.parse(text);
        } catch(e) {
            ast = AcornLoose.parse(text);
        }
        return ast;
    };

    /**
     * This will add template at given position/selection
     *
     * @param {string} template - name of the template defined in templates.json
     * @param {Array} args- Check all arguments that exist in defined templated pass all that args as array
     * @param {{line: number, ch: number}} rangeToReplace - Range which we want to replace
     * @param {string} subTemplate - If template written under some category
     */
    RefactoringSession.prototype.replaceTextFromTemplate = function (template, args, rangeToReplace, subTemplate) {
        var templateText = templates[template];

        if (subTemplate) {
            templateText = templateText[subTemplate];
        }

        var compiled = _.template(templateText),
            formattedText = compiled(args);

        if (!rangeToReplace) {
            rangeToReplace = this.editor.getSelection();
        }

        this.document.replaceRange(formattedText, rangeToReplace.start, rangeToReplace.end);

        var startLine = rangeToReplace.start.line,
            endLine = startLine + formattedText.split("\n").length;

        for (var i = startLine + 1; i < endLine; i++) {
            this.cm.indentLine(i);
        }
    };

    /**
     * Get Params of selected function
     *
     * @param {number} start- start offset
     * @param {number} end - end offset
     * @param {string} selectedText - Create ast for only selected node
     * @return {Array} param - Array of all parameters in function
     */
    RefactoringSession.prototype.getParamsOfFunction = function getParamsOfFunction(start, end, selectedText) {
        var param = [];
        ASTWalker.simple(AcornLoose.parse(selectedText), {
            Function: function (node) {
                if (node.type === "FunctionDeclaration") {
                    node.params.forEach(function (item) {
                        param.push(item.name);
                    });
                }
            }
        });

        return param;
    };

    /**
     * Get the Parent node
     *
     * @param {Object} ast - ast of full document
     * @param {number} start - start Offset
     * @return {Object} node - Returns the parent node of node which is at offset start
     */
    RefactoringSession.prototype.getParentNode = function (ast, start) {
        var foundNode = ASTWalker.findNodeAround(ast, start, function(nodeType, node) {
            return (nodeType === "ObjectExpression");
        });
        return foundNode && foundNode.node;
    };

    /**
     * Checks weather the node at start is last in that scope or not
     *
     * @param {Object} ast - ast of full document
     * @param {number} start - start Offset
     * @return {boolean} - is last node in that scope
     */
    RefactoringSession.prototype.isLastNodeInScope = function (ast, start) {
        var parentNode = this.getParentNode(ast, start),
            currentNodeStart;

        ASTWalker.simple(parentNode, {
            Property: function (node) {
                currentNodeStart = node.start;
            }
        });

        return start >= currentNodeStart;
    };


    // Define public api
    exports.isEqual = isEqual;
    exports.getUniqueIdentifierName = getUniqueIdentifierName;
    exports.isStandAloneExpression = isStandAloneExpression;
    exports.numLines = numLines;
    exports.getScopeData = getScopeData;
    exports.normalizeText = normalizeText;
    exports.getExpression = getExpression;
    exports.isFnScope = isFnScope;
    exports.getAllScopes = getAllScopes;
    exports.checkStatement = checkStatement;
    exports.findSurroundASTNode = findSurroundASTNode;
    exports.getAST = getAST;
    exports.findSurroundExpression = findSurroundExpression;
    exports.RefactoringSession = RefactoringSession;
});

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

define("RenameIdentifier", function (require, exports, module) {


    const EditorManager        = brackets.getModule("editor/EditorManager"),
        ScopeManager         = brackets.getModule("JSUtils/ScopeManager"),
        Session              = brackets.getModule("JSUtils/Session"),
        MessageIds           = JSON.parse(brackets.getModule("text!JSUtils/MessageIds.json")),
        TokenUtils           = brackets.getModule("utils/TokenUtils"),
        Strings              = brackets.getModule("strings"),
        Keys                 = brackets.getModule("command/Keys"),
        Editor               = brackets.getModule("editor/Editor").Editor,
        ProjectManager       = brackets.getModule("project/ProjectManager");

    let session             = null,  // object that encapsulates the current session state
        keywords = ["define", "alert", "exports", "require", "module", "arguments"];

    const MARK_TYPE_RENAME = "renameVar";

    //Create new session
    function initializeSession(editor) {
        session = new Session(editor);
    }

    //Post message to tern node domain that will request tern server to find refs
    function getRefs(fileInfo, offset) {
        ScopeManager.postMessage({
            type: MessageIds.TERN_REFS,
            fileInfo: fileInfo,
            offset: offset
        });

        return ScopeManager.addPendingRequest(fileInfo.name, offset, MessageIds.TERN_REFS);
    }

    //Create info required to find reference
    function requestFindRefs(session, document, offset) {
        if (!document || !session) {
            return;
        }
        let path    = document.file.fullPath,
            fileInfo = {
                type: MessageIds.TERN_FILE_INFO_TYPE_FULL,
                name: path,
                offsetLines: 0,
                text: ScopeManager.filterText(session.getJavascriptText())
            };
        let ternPromise = getRefs(fileInfo, offset);

        return {promise: ternPromise};
    }

    //Do rename of identifier which is at cursor
    function handleRename() {
        let editor = EditorManager.getActiveEditor(),
            offset, token;

        if (!editor) {
            return;
        }

        if (editor.getSelections().length > 1) {
            editor.displayErrorMessageAtCursor(Strings.ERROR_RENAME_MULTICURSOR);
            return;
        }
        initializeSession(editor);


        if (!editor || editor.getModeForSelection() !== "javascript") {
            return;
        }

        token = TokenUtils.getTokenAt(editor._codeMirror, editor._codeMirror.posFromIndex(session.getOffset()));

        if (keywords.indexOf(token.string) >= 0) {
            editor.displayErrorMessageAtCursor(Strings.ERROR_RENAME_GENERAL);
            return;
        }

        let result = new $.Deferred();

        function isInSameFile(obj, refsResp) {
            let projectRoot = ProjectManager.getProjectRoot(),
                projectDir,
                fileName = "";
            if (projectRoot) {
                projectDir = projectRoot.fullPath;
            }

            // get the relative path of File as Tern can also return
            // references with file name as a relative path wrt projectRoot
            // so refernce file name will be compared with both relative and absolute path to check if it is same file
            if (projectDir && refsResp && refsResp.file && refsResp.file.indexOf(projectDir) === 0) {
                fileName = refsResp.file.slice(projectDir.length);
            }
            // In case of unsaved files, After renameing once Tern is returning filename without forward slash
            return (obj && (obj.file === refsResp.file || obj.file === fileName
                            || obj.file === refsResp.file.slice(1, refsResp.file.length)));
        }

        function _multiFileRename(refs) {
            // TODO: Multi file rename here
            // note that before we enable this, we should load tern with the full code base to identify all
            // references properly. This sadly needs refactoring the current tern integration heavily
        }

        function _isCursorWithinMark(cursorPos, marker) {
            if(!marker){
                return false;
            }
            // Get the position of the marker
            var pos = marker.find();
            if (!pos) {return false;} // The marker doesn't cover any range

            // Check if the cursor is within the mark's range
            var from = pos.from, to = pos.to;
            // Check if cursor line is between the start and end lines
            if (cursorPos.line < from.line || cursorPos.line > to.line) {
                return false;
            }
            // If cursor is on the same line as the start or end, check the character position
            if (cursorPos.line === from.line && cursorPos.ch < from.ch) {
                return false;
            }
            if (cursorPos.line === to.line && cursorPos.ch > to.ch) {
                return false;
            }

            return true; // The cursor is within the mark
        }


        function _outlineText(currentEditor) {
            let selections = currentEditor.getSelections();
            if(selections.length > 1 ){
                let primary = currentEditor.getSelection();
                currentEditor.markText(MARK_TYPE_RENAME, primary.start, primary.end, Editor.getMarkOptionRenameOutline());
                currentEditor.off(Editor.EVENT_BEFORE_SELECTION_CHANGE + ".renameVar");
                currentEditor.off(Editor.EVENT_CURSOR_ACTIVITY + ".renameVar");
                currentEditor.off(Editor.EVENT_KEY_DOWN + ".renameVar");
                currentEditor.on(Editor.EVENT_BEFORE_SELECTION_CHANGE + ".renameVar", function (_evt, newSelections) {
                    if(newSelections.ranges && newSelections.ranges.length === 1) {
                        currentEditor.clearAllMarks(MARK_TYPE_RENAME);
                        currentEditor.off(Editor.EVENT_BEFORE_SELECTION_CHANGE + ".renameVar");
                    }
                });
                currentEditor.on(Editor.EVENT_CURSOR_ACTIVITY + ".renameVar", function (_evt, newSelections) {
                    const mainCursor = currentEditor.getCursorPos();
                    let primaryMark = currentEditor.getAllMarks(MARK_TYPE_RENAME);
                    primaryMark = primaryMark && primaryMark[0];
                    if(primaryMark && !_isCursorWithinMark(mainCursor, primaryMark)) {
                        currentEditor.clearAllMarks(MARK_TYPE_RENAME);
                        currentEditor.off(Editor.EVENT_BEFORE_SELECTION_CHANGE + ".renameVar");
                        currentEditor.setCursorPos(mainCursor.line, mainCursor.ch);
                    }
                });
                currentEditor.on(Editor.EVENT_KEY_DOWN + ".renameVar", function (_evt, _editor, keyboardEvent) {
                    const mainCursor = currentEditor.getCursorPos();
                    let primaryMark = currentEditor.getAllMarks(MARK_TYPE_RENAME);
                    primaryMark = primaryMark && primaryMark[0];
                    if(primaryMark && (keyboardEvent.key === Keys.KEY.RETURN || keyboardEvent.key === Keys.KEY.ENTER)){
                        currentEditor.clearAllMarks(MARK_TYPE_RENAME);
                        currentEditor.off(Editor.EVENT_KEY_DOWN + ".renameVar");
                        currentEditor.setCursorPos(mainCursor.line, mainCursor.ch);
                        keyboardEvent.preventDefault();
                        keyboardEvent.stopPropagation();
                    }
                });
            }
        }

        /**
         * Check if references are in this file only
         * If yes then select all references
         */
        function handleFindRefs (refsResp) {
            if (!refsResp || !refsResp.references || !refsResp.references.refs) {
                return;
            }

            let inlineWidget = EditorManager.getFocusedInlineWidget(),
                editor = EditorManager.getActiveEditor(),
                refs = refsResp.references.refs;

            //In case of inline widget if some references are outside widget's text range then don't allow for rename
            if (inlineWidget) {
                let isInTextRange  = !refs.find(function(item) {
                    return (item.start.line < inlineWidget._startLine || item.end.line > inlineWidget._endLine);
                });

                if (!isInTextRange) {
                    editor.displayErrorMessageAtCursor(Strings.ERROR_RENAME_QUICKEDIT);
                    return;
                }
            }

            let currentPosition = editor.posFromIndex(refsResp.offset),
                refsArray;
            refsArray = refs.filter(function (element) {
                return isInSameFile(element, refsResp);
            });
            if (refsArray.length !== refs.length) {
                // There are references across multiple files, we are not ready to handle this yet
                _multiFileRename(refs);
                return;
            }

            // Finding the Primary Reference in Array
            let primaryRef = refsArray.find(function (element) {
                return ((element.start.line === currentPosition.line || element.end.line === currentPosition.line)
                        && currentPosition.ch <= element.end.ch && currentPosition.ch >= element.start.ch);
            });
            // Setting the primary flag of Primary Refence to true
            primaryRef.primary = true;

            editor.setSelections(refsArray);
            _outlineText(editor);
        }

        /**
         * Make a find ref request.
         * @param {Session} session - the session
         * @param {number} offset - the offset of where to jump from
         */
        function requestFindReferences(session, offset) {
            let response = requestFindRefs(session, session.editor.document, offset);

            if (response && response.hasOwnProperty("promise")) {
                response.promise.done(handleFindRefs).fail(function (errorMsg) {
                    EditorManager.getActiveEditor().displayErrorMessageAtCursor(errorMsg);
                    result.reject();
                });
            }
        }

        offset = session.getOffset();
        requestFindReferences(session, offset);

        return result.promise();
    }

    // for tests
    exports._MARK_TYPE_RENAME = MARK_TYPE_RENAME;

    // public api
    exports.handleRename = handleRename;
});

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

define("WrapSelection", function (require, exports, module) {


    var _ = brackets.getModule("thirdparty/lodash");

    var EditorManager        = brackets.getModule("editor/EditorManager"),
        TokenUtils           = brackets.getModule("utils/TokenUtils"),
        Strings              = brackets.getModule("strings"),
        RefactoringUtils     = require("RefactoringUtils"),
        RefactoringSession   = RefactoringUtils.RefactoringSession;

    //Template keys mentioned in Templates.json
    var WRAP_IN_CONDITION       = "wrapCondition",
        ARROW_FUNCTION          = "arrowFunction",
        GETTERS_SETTERS         = "gettersSetters",
        TRY_CATCH               = "tryCatch";

    //Active session which will contain information about editor, selection etc
    var current = null;

    /**
     * Initialize session
     */
    function initializeRefactoringSession(editor) {
        current = new RefactoringSession(editor);
    }

    /**
     * Wrap selected statements
     *
     * @param {string} wrapperName - template name where we want wrap selected statements
     * @param {string} err- error message if we can't wrap selected code
     */
    function _wrapSelectedStatements (wrapperName, err) {
        var editor = EditorManager.getActiveEditor();
        if (!editor) {
            return;
        }
        initializeRefactoringSession(editor);

        var startIndex = current.startIndex,
            endIndex = current.endIndex,
            selectedText = current.selectedText,
            pos;

        if (selectedText.length === 0) {
            var statementNode = RefactoringUtils.findSurroundASTNode(current.ast, {start: startIndex}, ["Statement"]);
            if (!statementNode) {
                current.editor.displayErrorMessageAtCursor(err);
                return;
            }
            selectedText = current.text.substr(statementNode.start, statementNode.end - statementNode.start);
            startIndex = statementNode.start;
            endIndex = statementNode.end;
        } else {
            var selectionDetails = RefactoringUtils.normalizeText(selectedText, startIndex, endIndex);
            selectedText = selectionDetails.text;
            startIndex = selectionDetails.start;
            endIndex = selectionDetails.end;
        }

        if (!RefactoringUtils.checkStatement(current.ast, startIndex, endIndex, selectedText)) {
            current.editor.displayErrorMessageAtCursor(err);
            return;
        }

        pos = {
            "start": current.cm.posFromIndex(startIndex),
            "end": current.cm.posFromIndex(endIndex)
        };

        current.document.batchOperation(function() {
            current.replaceTextFromTemplate(wrapperName, {body: selectedText}, pos);
        });

        if (wrapperName === TRY_CATCH) {
            var cursorLine = current.editor.getSelection().end.line - 1,
                startCursorCh = current.document.getLine(cursorLine).indexOf("\/\/"),
                endCursorCh = current.document.getLine(cursorLine).length;

            current.editor.setSelection({"line": cursorLine, "ch": startCursorCh}, {"line": cursorLine, "ch": endCursorCh});
        } else if (wrapperName === WRAP_IN_CONDITION) {
            current.editor.setSelection({"line": pos.start.line, "ch": pos.start.ch + 4}, {"line": pos.start.line, "ch": pos.start.ch + 13});
        }
    }


     //Wrap selected statements in try catch block
    function wrapInTryCatch() {
        _wrapSelectedStatements(TRY_CATCH, Strings.ERROR_TRY_CATCH);
    }

    //Wrap selected statements in try condition
    function wrapInCondition() {
        _wrapSelectedStatements(WRAP_IN_CONDITION, Strings.ERROR_WRAP_IN_CONDITION);
    }

    //Convert function to arrow function
    function convertToArrowFunction() {
        var editor = EditorManager.getActiveEditor();
        if (!editor) {
            return;
        }
        initializeRefactoringSession(editor);

        var funcExprNode = RefactoringUtils.findSurroundASTNode(current.ast, {start: current.startIndex}, ["Function"]);

        if (!funcExprNode || funcExprNode.type !== "FunctionExpression" || funcExprNode.id) {
            current.editor.displayErrorMessageAtCursor(Strings.ERROR_ARROW_FUNCTION);
            return;
        }

        if (funcExprNode === "FunctionDeclaration") {
            current.editor.displayErrorMessageAtCursor(Strings.ERROR_ARROW_FUNCTION);
            return;
        }

        if (!funcExprNode.body) {
            return;
        }

        var noOfStatements = funcExprNode.body.body.length,
            selectedText = current.text.substr(funcExprNode.start, funcExprNode.end - funcExprNode.start),
            param = [],
            dontChangeParam = false,
            numberOfParams = funcExprNode.params.length,
            treatAsManyParam = false;

        funcExprNode.params.forEach(function (item) {
            if (item.type === "Identifier") {
                param.push(item.name);
            } else if (item.type === "AssignmentPattern") {
                dontChangeParam = true;
            }
        });

        //In case defaults params keep params as it is
        if (dontChangeParam) {
            if (numberOfParams >= 1) {
                param.splice(0, param.length);
                param.push(current.text.substr(funcExprNode.params[0].start, funcExprNode.params[numberOfParams-1].end - funcExprNode.params[0].start));
                // In case default param, treat them as many paramater because to use
                // one parameter template, That param should be an identifier
                if (numberOfParams === 1) {
                    treatAsManyParam = true;
                }
            }
            dontChangeParam = false;
        }

        var loc = {
                "fullFunctionScope": {
                    start: funcExprNode.start,
                    end: funcExprNode.end
                },
                "functionsDeclOnly": {
                    start: funcExprNode.start,
                    end: funcExprNode.body.start
                }
            },
            locPos = {
                "fullFunctionScope": {
                    "start": current.cm.posFromIndex(loc.fullFunctionScope.start),
                    "end": current.cm.posFromIndex(loc.fullFunctionScope.end)
                },
                "functionsDeclOnly": {
                    "start": current.cm.posFromIndex(loc.functionsDeclOnly.start),
                    "end": current.cm.posFromIndex(loc.functionsDeclOnly.end)
                }
            },
            isReturnStatement = (noOfStatements >= 1 && funcExprNode.body.body[0].type === "ReturnStatement"),
            bodyStatements = funcExprNode.body.body[0],
            params;

            // If there is nothing in function body, then get the text b/w curly braces
            // In this case, We will update params only as per Arrow function expression
        if (!bodyStatements) {
            bodyStatements = funcExprNode.body;
        }
        params = {
            "params": param.join(", "),
            "statement": _.trimRight(current.text.substr(bodyStatements.start, bodyStatements.end - bodyStatements.start), ";")
        };

        if (isReturnStatement) {
            params.statement = params.statement.substr(7).trim();
        }

        if (noOfStatements === 1) {
            current.document.batchOperation(function() {
                (numberOfParams === 1 && !treatAsManyParam) ?  current.replaceTextFromTemplate(ARROW_FUNCTION, params, locPos.fullFunctionScope, "oneParamOneStament") :
                current.replaceTextFromTemplate(ARROW_FUNCTION, params, locPos.fullFunctionScope, "manyParamOneStament");

            });
        } else {
            current.document.batchOperation(function() {
                (numberOfParams === 1 && !treatAsManyParam) ?  current.replaceTextFromTemplate(ARROW_FUNCTION, {params: param},
                locPos.functionsDeclOnly, "oneParamManyStament") :
                current.replaceTextFromTemplate(ARROW_FUNCTION, {params: param.join(", ")}, locPos.functionsDeclOnly, "manyParamManyStament");
            });
        }

        current.editor.setCursorPos(locPos.functionsDeclOnly.end.line, locPos.functionsDeclOnly.end.ch, false);
    }

    // Create gtteres and setters for a property
    function createGettersAndSetters() {
        var editor = EditorManager.getActiveEditor();
        if (!editor) {
            return;
        }
        initializeRefactoringSession(editor);

        var startIndex = current.startIndex,
            endIndex = current.endIndex,
            selectedText = current.selectedText;

        if (selectedText.length >= 1) {
            var selectionDetails = RefactoringUtils.normalizeText(selectedText, startIndex, endIndex);
            selectedText = selectionDetails.text;
            startIndex = selectionDetails.start;
            endIndex = selectionDetails.end;
        }

        var token = TokenUtils.getTokenAt(current.cm, current.cm.posFromIndex(endIndex)),
            commaString = ",",
            isLastNode,
            templateParams,
            parentNode,
            propertyEndPos;

        //Create getters and setters only if selected reference is a property
        if (token.type !== "property") {
            current.editor.displayErrorMessageAtCursor(Strings.ERROR_GETTERS_SETTERS);
            return;
        }

        parentNode = current.getParentNode(current.ast, endIndex);
        // Check if selected propery is child of a object expression
        if (!parentNode || !parentNode.properties) {
            current.editor.displayErrorMessageAtCursor(Strings.ERROR_GETTERS_SETTERS);
            return;
        }


        var propertyNodeArray = parentNode.properties;
        // Find the last Propery Node before endIndex
        var properyNodeIndex = propertyNodeArray.findIndex(function (element) {
            return (endIndex >= element.start && endIndex < element.end);
        });

        var propertyNode = propertyNodeArray[properyNodeIndex];

        //Get Current Selected Property End Index;
        propertyEndPos = editor.posFromIndex(propertyNode.end);


        //We have to add ',' so we need to find position of current property selected
        isLastNode = current.isLastNodeInScope(current.ast, endIndex);
        var nextPropertNode, nextPropertyStartPos;
        if(!isLastNode && properyNodeIndex + 1 <= propertyNodeArray.length - 1) {
            nextPropertNode = propertyNodeArray[properyNodeIndex + 1];
            nextPropertyStartPos = editor.posFromIndex(nextPropertNode.start);

            if(propertyEndPos.line !== nextPropertyStartPos.line) {
                propertyEndPos = current.lineEndPosition(current.startPos.line);
            } else {
                propertyEndPos = nextPropertyStartPos;
                commaString = ", ";
            }
        }

        var getSetPos;
        if (isLastNode) {
            getSetPos = current.document.adjustPosForChange(propertyEndPos, commaString.split("\n"),
                                                            propertyEndPos, propertyEndPos);
        } else {
            getSetPos = propertyEndPos;
        }
        templateParams = {
            "getName": token.string,
            "setName": token.string,
            "tokenName": token.string
        };

        // Replace, setSelection, IndentLine
        // We need to call batchOperation as indentLine don't have option to add origin as like replaceRange
        current.document.batchOperation(function() {
            if (isLastNode) {
                //Add ',' in the end of current line
                current.document.replaceRange(commaString, propertyEndPos, propertyEndPos);
            }

            current.editor.setSelection(getSetPos); //Selection on line end

            // Add getters and setters for given token using template at current cursor position
            current.replaceTextFromTemplate(GETTERS_SETTERS, templateParams);

            if (!isLastNode) {
                // Add ',' at the end setter
                current.document.replaceRange(commaString, current.editor.getSelection().start, current.editor.getSelection().start);
            }
        });
    }

    exports.wrapInCondition         = wrapInCondition;
    exports.wrapInTryCatch          = wrapInTryCatch;
    exports.convertToArrowFunction  = convertToArrowFunction;
    exports.createGettersAndSetters = createGettersAndSetters;
});
