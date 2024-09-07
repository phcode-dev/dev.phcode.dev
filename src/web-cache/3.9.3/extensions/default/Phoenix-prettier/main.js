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
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global Phoenix*/
//jshint-ignore:no-start
/**
 * This module beautifies HTML/JS/other language code with the help of prettier plugin
 * See https://prettier.io/docs/en/api.html for how to use prettier API and other docs
 * To test variour prettier options, See https://prettier.io/playground/
 */

define(function (require, exports, module) {

    const AppInit = brackets.getModule("utils/AppInit"),
        Strings = brackets.getModule("strings"),
        FileUtils  = brackets.getModule("file/FileUtils"),
        LanguageManager = brackets.getModule("language/LanguageManager"),
        BeautificationManager = brackets.getModule("features/BeautificationManager"),
        PreferencesManager  = brackets.getModule("preferences/PreferencesManager"),
        Editor = brackets.getModule("editor/Editor").Editor,
        EditorOptionHandlers = brackets.getModule("editor/EditorOptionHandlers"),
        ExtensionsWorker = brackets.getModule("worker/ExtensionsWorker");

    const prefs = PreferencesManager.getExtensionPrefs("beautify");
    prefs.definePreference("options", "object", {
        semi: true,
        trailingComma: "none",
        singleQuote: false,
        quoteProps: "as-needed",
        bracketSameLine: true,
        singleAttributePerLine: false,
        proseWrap: "always"
    }, {
        description: Strings.BEAUTIFY_OPTIONS,
        keys: {
            printWidth: {
                type: "number",
                description: Strings.BEAUTIFY_OPTION_PRINT_WIDTH,
                initial: 120
            },
            semi: {
                type: "boolean",
                description: Strings.BEAUTIFY_OPTION_SEMICOLON,
                initial: true
            },
            trailingComma: {
                type: "string",
                description: Strings.BEAUTIFY_OPTION_PRINT_TRAILING_COMMAS,
                values: ["none", "es5", "all"],
                initial: "none"
            },
            singleQuote: {
                type: "boolean",
                description: Strings.BEAUTIFY_OPTION_SINGLE_QUOTE,
                initial: false
            },
            quoteProps: {
                type: "string",
                description: Strings.BEAUTIFY_OPTION_QUOTE_PROPS,
                values: ["as-needed", "consistent", "preserve"],
                initial: "as-needed"
            },
            proseWrap: {
                type: "string",
                description: Strings.BEAUTIFY_OPTION_PROSE_WRAP,
                values: ["always", "never", "preserve"],
                initial: "preserve"
            },
            bracketSameLine: {
                type: "boolean",
                description: Strings.BEAUTIFY_OPTION_BRACKET_SAME_LINE,
                initial: true
            },
            singleAttributePerLine: {
                type: "boolean",
                description: Strings.BEAUTIFY_OPTION_SINGLE_ATTRIBUTE_PER_LINE,
                initial: false
            }
        }
    });

    const parsersForLanguage = {
        html: "html",
        xml: "html",
        handlebars: "html",
        svg: "html",
        css: "css",
        less: "less",
        scss: "scss",
        javascript: "babel",
        jsx: "babel",
        tsx: "babel",
        json: "json-stringify",
        typescript: "typescript",
        php: "php",
        markdown: "markdown",
        gfm: "markdown",
        yaml: "yaml"
    };

    function _computePaddingForSelection(selectionLineText, chToStart) {
        let trimmedLine = selectionLineText.trim();
        let padding = selectionLineText.substring(0, chToStart),
            firstLinePadding = "";
        if(trimmedLine){
            let index = selectionLineText.indexOf(trimmedLine);
            if(index > chToStart){
                firstLinePadding = selectionLineText.substring(chToStart, index);
            }
            padding = selectionLineText.substring(0, index);
        }
        return {
            padding, firstLinePadding
        };
    }

    function _fixTabs(text, padding, firstLinePadding) {
        const result = text.split(/\r?\n/);
        if(!result || result.length === 0){
            return text;
        }

        let paddedText = firstLinePadding + result[0].trim();
        let length = result[result.length-1].trim() ? result.length : result.length - 1;
        let lineEndingChar = FileUtils.sniffLineEndings(text) === FileUtils.LINE_ENDINGS_LF ? '\n' : '\r\n';
        for(let i=1; i<length; i++){
            if(result[i].trim()){
                paddedText = `${paddedText}${lineEndingChar}${padding}${result[i]}`;
            } else {
                // empty line
                paddedText = `${paddedText}${lineEndingChar}${result[i]}`;
            }
        }
        return paddedText;
    }

    /**
     * In selections, we have to reduce line printWidth according to the padding before prettifying. We only do this
     * if padding takes less than 70% of total line width.
     * @param prettierParams
     * @param padding
     * @private
     */
    function _adjustPrintWidthOption(prettierParams, padding) {
        let paddingPercent = (padding.length/prettierParams.options.printWidth) * 100;
        if(paddingPercent < 70){
            prettierParams.options.printWidth = prettierParams.options.printWidth - padding.length;
        }
    }

    function _trySelectionWithPartialText(editor, prettierParams) {
        return new Promise((resolve, reject)=>{
            console.log("beautifying selection with partial text");
            let selection = editor.getSelection(),
                selectionLineText = editor.document.getLine(selection.start.line);
            let {padding, firstLinePadding} = _computePaddingForSelection(selectionLineText, selection.start.ch);
            _adjustPrintWidthOption(prettierParams, padding);
            let originalText = editor.document.getText();
            prettierParams.text = editor.getSelectedText();
            ExtensionsWorker.execPeer("prettify", prettierParams).then(response=>{
                if(!response || !response.text){
                    reject();
                    return;
                }
                resolve({
                    originalText: originalText,
                    changedText: _fixTabs(response.text, padding, firstLinePadding),
                    ranges: {
                        replaceStart: selection.start,
                        replaceEnd: selection.end
                    }
                });
            }).catch(reject);
        });
    }

    function _clone(obj) {
        return Object.assign({}, obj);
    }

    function beautifyEditorProvider(editor) {
        return new Promise((resolve, reject)=>{
            let filepath = editor.document.file.fullPath;
            let languageId = LanguageManager.getLanguageForPath(filepath).getId();
            console.log("Beautifying with language id: ", languageId);

            let selection = editor.getSelections();
            if(!parsersForLanguage[languageId]
                || selection.length >1){ // dont beautify on multiple selections or cursors
                reject();
                return;
            }

            let options = _clone(prefs.get("options"));
            let indentWithTabs = Editor.getUseTabChar(filepath);
            const printWidth = options.printWidth || EditorOptionHandlers.getMaxLineLength();
            options._usePlugin = parsersForLanguage[languageId];
            Object.assign(options, {
                parser: parsersForLanguage[languageId],
                tabWidth: indentWithTabs ? Editor.getTabSize(filepath) : Editor.getSpaceUnits(filepath),
                useTabs: indentWithTabs,
                filepath: filepath,
                printWidth: printWidth,
                endOfLine: "lf" // codemirror always does lf and only crlf before disk write in windows.
            });
            let prettierParams ={
                text: editor.document.getText(),
                options: options
            };
            if(editor.hasSelection()){
                _trySelectionWithPartialText(editor, _clone(prettierParams)).then(resolve).catch(error=>{
                    console.log("Could not prettify selection", error);
                    reject(error);
                });
            } else {
                options.cursorOffset = editor.indexFromPos(editor.getCursorPos());
                ExtensionsWorker.execPeer("prettify", prettierParams).then(response=>{
                    if(!response){
                        reject();
                        return;
                    }
                    resolve({
                        originalText: prettierParams.text,
                        changedText: response.text,
                        cursorOffset: response.cursorOffset
                    });
                }).catch(err=>{
                    console.log("Could not prettify text", err);
                    reject(err);
                });
            }
        });
    }

    AppInit.appReady(function () {
        ExtensionsWorker.loadScriptInWorker(`${module.uri}/../worker/prettier-helper.js`, true);
        BeautificationManager.registerBeautificationProvider(exports, Object.keys(parsersForLanguage));
    });

    function beautifyTextProvider(textToBeautify, filePathOrFileName) {
        return new Promise((resolve, reject)=>{
            let languageId = LanguageManager.getLanguageForPath(filePathOrFileName).getId();
            console.log("Beautifying text with language id: ", languageId);
            let options = prefs.get("options");
            let indentWithTabs = Editor.getUseTabChar(filePathOrFileName);
            options._usePlugin = parsersForLanguage[languageId];
            Object.assign(options, {
                parser: parsersForLanguage[languageId],
                tabWidth: indentWithTabs ? Editor.getTabSize() : Editor.getSpaceUnits(),
                useTabs: indentWithTabs,
                filepath: filePathOrFileName
            });
            let prettierParams ={
                text: textToBeautify,
                options: options
            };
            ExtensionsWorker.execPeer("prettify", prettierParams).then(response => {
                if(!response){
                    reject();
                    return;
                }
                resolve({
                    originalText: textToBeautify,
                    changedText: response.text
                });
            }).catch(err=>{
                console.log("Could not prettify text", err);
                reject(err);
            });
        });
    }

    exports.beautifyEditorProvider = beautifyEditorProvider;
    exports.beautifyTextProvider = beautifyTextProvider;
});


