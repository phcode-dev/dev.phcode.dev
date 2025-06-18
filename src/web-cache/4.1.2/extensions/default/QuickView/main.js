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

/*jslint regexp: true */

define(function (require, exports, module) {
    const ExtensionUtils      = brackets.getModule("utils/ExtensionUtils");
    require("./colorGradientProvider");
    require("./ImagePreviewProvider");
    require("./numberPreviewProvider");

    // Load our stylesheet
    ExtensionUtils.loadStyleSheet(module, "QuickView.less");
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

/*jslint regexp: true */

define("ImagePreviewProvider", function (require, exports, module) {


    // Brackets modules
    let FileUtils           = brackets.getModule("file/FileUtils"),
        FileSystem          = brackets.getModule("filesystem/FileSystem"),
        PreferencesManager  = brackets.getModule("preferences/PreferencesManager"),
        LanguageManager     = brackets.getModule("language/LanguageManager"),
        Strings             = brackets.getModule("strings"),
        PathUtils           = brackets.getModule("thirdparty/path-utils/path-utils"),
        AppInit             = brackets.getModule("utils/AppInit"),
        QuickView           = brackets.getModule("features/QuickViewManager"),
        Metrics             = brackets.getModule("utils/Metrics"),
        FileViewController  = brackets.getModule("project/FileViewController");

    let enabled,                             // Only show preview if true
        prefs                      = null,   // Preferences
        extensionlessImagePreview;           // Whether to try and preview extensionless URLs

    // List of protocols which we will support for image preview urls
    let validProtocols = ["data:", "http:", "https:", "phtauri:", "asset:", "ftp:", "file:"];

    prefs = PreferencesManager.getExtensionPrefs("quickview");

    // Whether or not to try and show image previews for URLs missing extensions
    // (e.g., https://avatars2.githubusercontent.com/u/476009?v=3&s=200)
    prefs.definePreference("extensionlessImagePreview", "boolean", true, {
        description: Strings.DESCRIPTION_EXTENSION_LESS_IMAGE_PREVIEW
    });


    function _transformToIframePath(url) {
        if(url && url.startsWith("https://www.youtube.com/watch?")){
            // YouTube special handling- try to play the embedded link for YouTube videos.
            const utube = new URL(url);
            const vidLink = utube.searchParams.get("v");
            if(vidLink) {
                return `https://www.youtube.com/embed/${vidLink}`;
            }
        }
        return url;
    }

    // Image preview provider -------------------------------------------------

    function getQuickView(editor, pos, token, line) {

        return new Promise((resolve, reject)=>{
            // Check for image name
            let urlRegEx = /url\(([^\)]*)\)/gi,
                tokenString,
                urlMatch;

            if (token.type === "string") {
                tokenString = token.string;
            } else {
                urlMatch = urlRegEx.exec(line);
                while (urlMatch) {
                    if (pos.ch < urlMatch.index) {
                        // match is past cursor, so stop looping
                        break;
                    } else if (pos.ch <= urlMatch.index + urlMatch[0].length) {
                        tokenString = urlMatch[1];
                        break;
                    }
                    urlMatch = urlRegEx.exec(line);
                }
            }

            if (!tokenString) {
                reject();
                return;
            }

            // Strip leading/trailing quotes, if present
            tokenString = tokenString.replace(/(^['"])|(['"]$)/g, "");

            let sPos, ePos;
            let docPath = editor.document.file.fullPath;
            let imgPath;

            // Determine whether or not this URL/path is likely to be an image.
            let parsed = PathUtils.parseUrl(tokenString);
            // If the URL has a protocol, check if it's one of the supported protocols
            let hasProtocol = parsed.protocol !== "" && validProtocols.indexOf(parsed.protocol.trim().toLowerCase()) !== -1;
            let ext = parsed.filenameExtension.replace(/^\./, '');
            let language = LanguageManager.getLanguageForExtension(ext);
            let id = language && language.getId();
            let isImage = id === "image" || id === "svg";
            let loadFromDisk = null;

            // Use this URL if this is an absolute URL and either points to a
            // filename with a known image extension, or lacks an extension (e.g.,
            // a web service that returns an image). Honour the extensionlessImagePreview
            // preference as well in the latter case.
            if (hasProtocol && (isImage || (!ext && extensionlessImagePreview))) {
                imgPath = tokenString;
            }
            // Use this filename if this is a path with a known image extension.
            else if (!hasProtocol && isImage) {
                imgPath = '';
                loadFromDisk = window.path.normalize(FileUtils.getDirectoryPath(docPath) + tokenString);
            }

            if (!loadFromDisk && !imgPath) {
                reject();
                return;
            }

            if (urlMatch) {
                sPos = {line: pos.line, ch: urlMatch.index};
                ePos = {line: pos.line, ch: urlMatch.index + urlMatch[0].length};
            } else {
                sPos = {line: pos.line, ch: token.start};
                ePos = {line: pos.line, ch: token.end};
            }

            let $imgPreview = $("<div id='quick-view-image-preview'><div class='image-preview'>"          +
                "    <img src=\"" + imgPath + "\">"    +
                "</div></div>");

            function _tryLoadingURLInIframe() {
                let $iframe = $(`<iframe class='image-preview' src="${_transformToIframePath(imgPath)}">`);
                $imgPreview.find(".image-preview").append($iframe);
            }

            function showHandlerWithImageURL(imageURL) {
                // Hide the preview container until the image is loaded.
                let img = $imgPreview.find("img");
                if(imageURL){
                    img[0].src = imageURL;
                }

                img.on("load", function () {
                    $imgPreview
                        .append("<div class='img-size'>" +
                            this.naturalWidth + " &times; " + this.naturalHeight + " " + Strings.UNIT_PIXELS +
                            "</div>"
                        );
                }).on("error", function (e) {
                    img.remove();
                    _tryLoadingURLInIframe();
                    e.preventDefault();
                });
            }

            function _imageToDataURI(file, cb) {
                let contentType = "data:image;base64,";
                let doNotCache = false;
                if(file.name.endsWith('.svg')){
                    contentType = "data:image/svg+xml;base64,";
                    doNotCache = true;
                }
                file.read({encoding: window.fs.BYTE_ARRAY_ENCODING, doNotCache}, function (err, content) {
                    if(err){
                        cb(err);
                        return;
                    }
                    let base64 = window.btoa(
                        new Uint8Array(content)
                            .reduce((data, byte) => data + String.fromCharCode(byte), '')
                    );
                    let dataURL= contentType + base64;
                    cb(null, dataURL);
                });
            }

            $imgPreview.attr("data-for-test", imgPath || loadFromDisk);

            let previewPopup = {
                start: sPos,
                end: ePos,
                content: $imgPreview
            };

            if(loadFromDisk){
                let imageFile = FileSystem.getFileForPath(loadFromDisk);
                _imageToDataURI(imageFile, function (err, dataURL){
                    if(!err){
                        $imgPreview.click(function () {
                            FileViewController.openAndSelectDocument(imageFile.fullPath,
                                FileViewController.PROJECT_MANAGER);
                            Metrics.countEvent(Metrics.EVENT_TYPE.QUICK_VIEW, "image", "click");
                        });
                        showHandlerWithImageURL(dataURL);
                        Metrics.countEvent(Metrics.EVENT_TYPE.QUICK_VIEW, "image", "show");
                        resolve(previewPopup);
                    } else {
                        reject();
                    }
                });
            } else {
                showHandlerWithImageURL();
                resolve(previewPopup);
            }
        });
    }

    function setExtensionlessImagePreview(_extensionlessImagePreview, doNotSave) {
        if (extensionlessImagePreview !== _extensionlessImagePreview) {
            extensionlessImagePreview = _extensionlessImagePreview;
            if (!doNotSave) {
                prefs.set("extensionlessImagePreview", enabled);
                prefs.save();
            }
        }
    }

    setExtensionlessImagePreview(prefs.get("extensionlessImagePreview"), true);

    prefs.on("change", "extensionlessImagePreview", function () {
        setExtensionlessImagePreview(prefs.get("extensionlessImagePreview"));
    });

    AppInit.appReady(function () {
        QuickView.registerQuickViewProvider(exports, ["all"]);
    });

    exports.getQuickView = getQuickView;
    exports.QUICK_VIEW_NAME = "ImagePreviewProvider";

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

/*jslint regexp: true */

define("colorGradientProvider", function (require, exports, module) {


    // Brackets modules
    const ColorUtils        = brackets.getModule("utils/ColorUtils"),
        CSSUtils            = brackets.getModule("language/CSSUtils"),
        TokenUtils          = brackets.getModule("utils/TokenUtils"),
        AppInit             = brackets.getModule("utils/AppInit"),
        EditorManager       = brackets.getModule("editor/EditorManager"),
        QuickView           = brackets.getModule("features/QuickViewManager"),
        Strings             = brackets.getModule("strings"),
        Metrics             = brackets.getModule("utils/Metrics"),
        CommandManager      = brackets.getModule("command/CommandManager"),
        MainViewManager     = brackets.getModule("view/MainViewManager"),
        FileViewController  = brackets.getModule("project/FileViewController"),
        Commands            = brackets.getModule("command/Commands");

    let styleLanguages = ["css", "text/x-less", "sass", "text/x-scss", "stylus"];

    function getQuickView(editor, pos, token, line) {
        return new Promise((resolve, reject)=>{
            // Check for gradient. -webkit-gradient() can have parens in parameters
            // nested 2 levels. Other gradients can only nest 1 level.
            let gradientRegEx = /-webkit-gradient\((?:[^\(]*?(?:\((?:[^\(]*?(?:\([^\)]*?\))*?)*?\))*?)*?\)|(?:(?:-moz-|-ms-|-o-|-webkit-|:|\s)((repeating-)?linear-gradient)|(?:-moz-|-ms-|-o-|-webkit-|:|\s)((repeating-)?radial-gradient))(\((?:[^\)]*?(?:\([^\)]*?\))*?)*?\))/gi,
                colorRegEx    = new RegExp(ColorUtils.COLOR_REGEX),
                mode          = TokenUtils.getModeAt(editor._codeMirror, pos, false),
                isStyleSheet  = (styleLanguages.indexOf(mode) !== -1);

            function areParensBalanced(str) {
                let i,
                    nestLevel = 0,
                    len;

                if (isStyleSheet) {
                    // Remove comments & strings from style sheets
                    str = CSSUtils.reduceStyleSheetForRegExParsing(str);
                }
                len = str.length;

                for (i = 0; i < len; i++) {
                    switch (str[i]) {
                    case "(":
                        nestLevel++;
                        break;
                    case ")":
                        nestLevel--;
                        break;
                    case "\\":
                        i++;    // next char is escaped, so skip it
                        break;
                    }
                }

                // if parens are balanced, nest level will be 0
                return (nestLevel === 0);
            }

            function execGradientMatch(line, parensBalanced) {
                // Unbalanced parens cause infinite loop (see issue #4650)
                let gradientMatch = (parensBalanced ? gradientRegEx.exec(line) : null),
                    prefix = "",
                    colorValue;

                if (gradientMatch) {
                    if (gradientMatch[0].indexOf("@") !== -1) {
                        // If the gradient match has "@" in it, it is most likely a less or
                        // sass letiable. Ignore it since it won't be displayed correctly.
                        gradientMatch = null;

                    } else {
                        // If it was a linear-gradient or radial-gradient letiant with a vendor prefix
                        // add "-webkit-" so it shows up correctly in Brackets.
                        if (gradientMatch[0].match(/-o-|-moz-|-ms-|-webkit-/i)) {
                            prefix = "-webkit-";
                        }

                        // For prefixed gradients, use the non-prefixed value as the color value.
                        // "-webkit-" will be added before this value later
                        if (gradientMatch[1]) {
                            colorValue = gradientMatch[1] + gradientMatch[5];    // linear gradiant
                        } else if (gradientMatch[3]) {
                            colorValue = gradientMatch[3] + gradientMatch[5];    // radial gradiant
                        } else if (gradientMatch[0]) {
                            colorValue = gradientMatch[0];                       // -webkit-gradient
                            prefix = "";                                         // do not prefix
                        }
                    }
                }

                return {
                    match: gradientMatch,
                    prefix: prefix,
                    colorValue: colorValue
                };
            }

            function execColorMatch(editor, line, pos) {
                let colorMatch,
                    ignoreNamedColors;

                function hyphenOnMatchBoundary(match, line) {
                    let beforeIndex, afterIndex;
                    if (match) {
                        beforeIndex = match.index - 1;
                        if (beforeIndex >= 0 && line[beforeIndex] === "-") {
                            return true;
                        }
                        afterIndex = match.index + match[0].length;
                        if (afterIndex < line.length && line[afterIndex] === "-") {
                            return true;
                        }

                    }

                    return false;
                }
                function isNamedColor(match) {
                    if (match && match[0] && /^[a-z]+$/i.test(match[0])) { // only for color names, not for hex-/rgb-values
                        return true;
                    }
                }

                // Hyphens do not count as a regex word boundary (\b), so check for those here
                do {
                    colorMatch = colorRegEx.exec(line);
                    if (!colorMatch) {
                        break;
                    }
                    if (ignoreNamedColors === undefined) {
                        let mode = TokenUtils.getModeAt(editor._codeMirror, pos, false).name;
                        ignoreNamedColors = styleLanguages.indexOf(mode) === -1;
                    }
                } while (hyphenOnMatchBoundary(colorMatch, line) ||
                (ignoreNamedColors && isNamedColor(colorMatch)));

                return colorMatch;
            }

            // simple css property splitter (used to find color stop arguments in gradients)
            function splitStyleProperty(property) {
                let token = /((?:[^"']|".*?"|'.*?')*?)([(,)]|$)/g;
                let recurse = function () {
                    let array = [];
                    for (;;) {
                        let result = token.exec(property);
                        if (result[2] === "(") {
                            let str = result[1].trim() + "(" + recurse().join(",") + ")";
                            result = token.exec(property);
                            str += result[1];
                            array.push(str);
                        } else {
                            array.push(result[1].trim());
                        }
                        if (result[2] !== ",") {
                            return array;
                        }
                    }
                };
                return (recurse());
            }

            // color stop helpers
            function isGradientColorStop(args) {
                return (args.length > 0 && args[0].match(colorRegEx) !== null);
            }

            function hasLengthInPixels(args) {
                return (args.length > 1 && args[1].indexOf("px") > 0);
            }

            // Ensures that input is in usable hex format
            function ensureHexFormat(str) {
                return (/^0x/).test(str) ? str.replace("0x", "#") : str;
            }

            // Normalizes px color stops to %
            function normalizeGradientExpressionForQuickview(expression) {
                if (expression.indexOf("px") > 0) {
                    let paramStart = expression.indexOf("(") + 1,
                        paramEnd = expression.lastIndexOf(")"),
                        parameters = expression.substring(paramStart, paramEnd),
                        params = splitStyleProperty(parameters),
                        lowerBound = 0,
                        upperBound = $("#quick-view-color-swatch").width(),
                        args,
                        thisSize,
                        i;

                    // find lower bound
                    for (i = 0; i < params.length; i++) {
                        args = params[i].split(" ");

                        if (hasLengthInPixels(args)) {
                            thisSize = parseFloat(args[1]);

                            upperBound = Math.max(upperBound, thisSize);
                            // we really only care about converting negative
                            //  pixel values -- so take the smallest negative pixel
                            //  value and use that as baseline for display purposes
                            if (thisSize < 0) {
                                lowerBound = Math.min(lowerBound, thisSize);
                            }
                        }
                    }

                    // convert negative lower bound to positive and adjust all pixel values
                    //  so that -20px is now 0px and 100px is now 120px
                    lowerBound = Math.abs(lowerBound);

                    // Offset the upperbound by the lowerBound to give us a corrected context
                    upperBound += lowerBound;

                    // convert to %
                    for (i = 0; i < params.length; i++) {
                        args = params[i].split(" ");
                        if (isGradientColorStop(args) && hasLengthInPixels(args)) {
                            if (upperBound === 0) {
                                thisSize = 0;
                            } else {
                                thisSize = ((parseFloat(args[1]) + lowerBound) / upperBound) * 100;
                            }
                            args[1] = thisSize + "%";
                        }
                        params[i] = args.join(" ");
                    }

                    // put it back together.
                    expression = expression.substring(0, paramStart) + params.join(", ") + expression.substring(paramEnd);
                }
                return expression;
            }

            let parensBalanced = areParensBalanced(line),
                gradientMatch = execGradientMatch(line, parensBalanced),
                match = gradientMatch.match || execColorMatch(editor, line, pos);

            let previewCSS, startPos, endPos, found = false;

            while (match) {
                if (pos.ch < match.index) {
                    // Gradients are matched first, then colors, so...
                    if (gradientMatch.match) {
                        // ... gradient match is past cursor -- stop looking for gradients, start searching for colors
                        gradientMatch = { match: null, prefix: "", colorValue: null };
                    } else {
                        // ... color match is past cursor -- stop looping
                        break;
                    }
                } else if (pos.ch <= match.index + match[0].length) {
                    // build the css for previewing the gradient from the regex result
                    previewCSS = gradientMatch.prefix + (gradientMatch.colorValue || match[0]);
                    startPos = {line: pos.line, ch: match.index};
                    endPos = {line: pos.line, ch: match.index + match[0].length};
                    found = true;
                    break;
                }

                // Get next match
                if (gradientMatch.match) {
                    gradientMatch = execGradientMatch(line, parensBalanced);
                }
                match = gradientMatch.match || execColorMatch(editor, line, pos);
            }

            if(found){
                // normalize the arguments to something that we can display to the user
                // NOTE: we need both the div and the popover's _previewCSS member
                //          (used by unit tests) to match so normalize the css for both
                let tooltip = gradientMatch.match ? "" : Strings.TOOLTIP_CLICK_TO_EDIT_COLOR;
                previewCSS = normalizeGradientExpressionForQuickview(ensureHexFormat(previewCSS));
                let preview = $(`<div title="${tooltip}">
                    <div id='quick-view-color-swatch' data-for-test='${previewCSS}' class='color-swatch'
                        style='background: ${previewCSS}'>
                    </div>
                    <span style="${gradientMatch.match? "display: none;": ""}">
                        <i class="fa fa-edit" style="color: ${previewCSS}; margin-top:5px;"></i>
                        <span style="color: ${previewCSS}; margin-top:5px;">${Strings.EDIT}</span>
                    </span>
                </div>`);
                preview.click(function () {
                    if(gradientMatch.match) {
                        return;
                    }
                    let fullEditor = EditorManager.getCurrentFullEditor();
                    if(fullEditor && fullEditor.document.file.fullPath !== editor.document.file.fullPath) {
                        const foundResult = MainViewManager.findInAllWorkingSets(editor.document.file.fullPath);
                        let paneToOpen;
                        if(fullEditor.length) {
                            paneToOpen = foundResult[0].pane;
                        }
                        FileViewController.openAndSelectDocument(editor.document.file.fullPath,
                            FileViewController.WORKING_SET_VIEW, paneToOpen)
                            .done(function () {
                                fullEditor = EditorManager.getCurrentFullEditor();
                                fullEditor.setCursorPos(startPos.line, startPos.ch, true);
                                CommandManager.execute(Commands.TOGGLE_QUICK_EDIT);
                            });
                    } else {
                        editor.setCursorPos(startPos.line, startPos.ch);
                        CommandManager.execute(Commands.TOGGLE_QUICK_EDIT);
                    }
                    Metrics.countEvent(Metrics.EVENT_TYPE.QUICK_VIEW, "color", "click");
                });

                Metrics.countEvent(Metrics.EVENT_TYPE.QUICK_VIEW, "color", "show");
                resolve({
                    start: startPos,
                    end: endPos,
                    content: preview
                });
                return;
            }

            reject();
        });
    }

    AppInit.appReady(function () {
        QuickView.registerQuickViewProvider(exports, ["all"]);
    });

    exports.getQuickView = getQuickView;
    exports.QUICK_VIEW_NAME = "colorGradientProvider";
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

/*jslint regexp: true */

define("numberPreviewProvider", function (require, exports, module) {

    // Brackets modules
    let PreferencesManager  = brackets.getModule("preferences/PreferencesManager"),
        Strings             = brackets.getModule("strings"),
        AppInit             = brackets.getModule("utils/AppInit"),
        QuickView           = brackets.getModule("features/QuickViewManager"),
        Metrics             = brackets.getModule("utils/Metrics"),
        colorGradientProvider = require("./colorGradientProvider");

    const PREF_ENABLED_KEY = "numberEditor";

    let prefs = PreferencesManager.getExtensionPrefs("quickview");
    prefs.definePreference(PREF_ENABLED_KEY, "boolean", true, {
        description: Strings.DESCRIPTION_NUMBER_QUICK_VIEW
    });

    let enabled;                             // Only show preview if true
    let lastOriginId = 0;

    function _splitNumber(numStr) {
        // https://stackoverflow.com/questions/2868947/split1px-into-1px-1-px-in-javascript
        try{
            if(numStr.length > 15){
                // empirically, anything larger than 15 chars is not a number we can process
                return null;
            }
            let split = numStr.match(/(^-?)(\d*\.?\d*)(.*)/); // "1px" -> ["1px", "1", "px"]
            let number = split[1] + split[2] || "";
            let decimalPlaces = number.split(".")[1];
            decimalPlaces = decimalPlaces && decimalPlaces.length || 0;
            let roundTo;
            switch (decimalPlaces) {
            case 0: roundTo = 1; break;
            case 1: roundTo = 10; break;
            case 2: roundTo = 100; break;
            default: roundTo = 100; break;
            }
            return {
                number,
                units: split[3] || "",
                decimalPlaces,
                roundTo
            };
        } catch (e) {
            return null;
        }
    }

    function _getWordAfterPos(editor, pos) {
        // Find the word at the specified position
        const wordRange = editor.getWordAt(pos);
        if(wordRange.text.startsWith('%')) {
            wordRange.text = wordRange.text.slice(0, 1);
            wordRange.endPos.ch = wordRange.startPos.ch + 1;
        }
        const wordFull = editor.getTextBetween(wordRange.startPos, wordRange.endPos);

        // Calculate effective start position within the word, if startPos is within the word
        let startChInWord = 0;
        if (wordRange.startPos.line === pos.line && wordRange.startPos.ch < pos.ch) {
            startChInWord = pos.ch - wordRange.startPos.ch;
        }

        // Calculate the effective start and end positions of the trimmed word within the editor
        const effectiveStartPos = {
            line: wordRange.startPos.line,
            ch: wordRange.startPos.ch + startChInWord
        };

        const effectiveEndPos = wordRange.endPos; // The end position remains the same as the original word's end

        // Trim the word based on the effective start position
        const trimmedWord = wordFull.substring(startChInWord);

        // Return the trimmed word along with its start and end positions
        return {
            text: trimmedWord,
            startPos: effectiveStartPos,
            endPos: effectiveEndPos
        };
    }

    function _isCSSUnit(str) {
        // Regular expression pattern that matches common CSS units
        const regexPattern = /^(px|cm|mm|Q|in|pc|pt|em|ex|ch|rem|vw|vh|vmin|vmax|lh|%)$/;

        return regexPattern.test(str);
    }

    function getQuickView(editor, pos, token, line) {
        return new Promise((resolve, reject)=>{
            let startCh = token.start,
                endCh = token.end,
                numberStr = token.string;
            if(token.type === "string" && enabled) {
                // this is for inline html attributes like style="width:10px;"
                // if the user hover over the 10 or px part, we should show the preview.
                const number = editor.getNumberAt(pos);
                if(number) {
                    // user hovered over the numeric (Eg.10) part
                    numberStr = number.text;
                    startCh = number.startPos.ch;
                    endCh = number.endPos.ch;
                    // check if we can extract units
                    const nextPos = {line: number.endPos.line, ch: number.endPos.ch};
                    const nextWord = _getWordAfterPos(editor, nextPos);
                    if(_isCSSUnit(nextWord.text.trim())){
                        numberStr = editor.getTextBetween(number.startPos, nextWord.endPos);
                        endCh = nextWord.endPos.ch;
                    }
                } else {
                    // the user hovers on the unit field or this is not a numeric string.
                    // for the unit field, we could add logic to detect the numeric field, but not doing that
                    // rn due to resource crunch.
                    reject();
                    return;
                }
            } else if(token.type !== "number" || !enabled){
                reject();
                return;
            }
            let sPos = {line: pos.line, ch: startCh},
                ePos = {line: pos.line, ch: endCh};
            let editOrigin = "+NumberQuickView_" + (lastOriginId++);
            let $content = $(`<div><input type="text" value="${numberStr}" class="dial"><div>`);
            let split = _splitNumber(numberStr);
            if(!split){
                reject();
                return;
            }
            let changedMetricSent = false;
            $content.find(".dial").knob({
                stopper: false,
                step: 1/split.roundTo,
                max: 100/split.roundTo,
                width: 100,
                height: 100,
                fgColor: "#2893ef",
                fontSize: "1em",
                format: function(value){
                    return Math.round(value*split.roundTo)/split.roundTo + split.units;
                },
                getValue: function(userInput){
                    let changedSplit = _splitNumber(userInput);
                    split.units = changedSplit && changedSplit.units;
                    return changedSplit && changedSplit.number;
                },
                change: function (value) {
                    editor.document.batchOperation(function () {
                        // Replace old color in code with the picker's color, and select it
                        editor.setSelection(sPos, ePos); // workaround for #2805
                        let replaceStr = Math.round(value*split.roundTo)/split.roundTo + split.units;
                        editor.replaceRange(replaceStr, sPos, ePos, editOrigin);
                        ePos = {line: sPos.line, ch: sPos.ch + replaceStr.length};
                        editor.setSelection(sPos, ePos);
                    });
                    if(!changedMetricSent){
                        Metrics.countEvent(Metrics.EVENT_TYPE.QUICK_VIEW, "num", "changed");
                        changedMetricSent = true;
                    }
                },
                changeStart: function () {
                    QuickView.lockQuickView();
                },
                changeEnd: function () {
                    QuickView.unlockQuickView();
                }
            });
            resolve({
                start: sPos,
                end: ePos,
                content: $content,
                exclusive: true,
                editsDoc: true
            });
            Metrics.countEvent(Metrics.EVENT_TYPE.QUICK_VIEW, "num", "show");
        });
    }

    function filterQuickView(popovers){
        // rgb(10 , 100, 20), hover over these kind of numbers should open color quick view if present over number view
        let hasColorQuickView = false;
        for(let popover of popovers){
            if(popover.providerInfo.provider.QUICK_VIEW_NAME === colorGradientProvider.QUICK_VIEW_NAME){
                hasColorQuickView = true;
                break;
            }
        }
        if(hasColorQuickView){
            popovers = popovers.filter((popover) => {
                return popover.providerInfo.provider.QUICK_VIEW_NAME !== exports.QUICK_VIEW_NAME;
            });
        }

        return popovers;
    }

    prefs.on("change", PREF_ENABLED_KEY, function () {
        enabled = prefs.get(PREF_ENABLED_KEY);
    });

    AppInit.appReady(function () {
        enabled = prefs.get(PREF_ENABLED_KEY);
        QuickView.registerQuickViewProvider(exports, ["html", "xhtml", "xml", // xml takes care of html inside tsx/jsx
            "css", "less", "scss", "sass"]);
    });

    exports.getQuickView = getQuickView;
    exports.filterQuickView = filterQuickView;
    exports.QUICK_VIEW_NAME = "numberPreviewProvider";

});
