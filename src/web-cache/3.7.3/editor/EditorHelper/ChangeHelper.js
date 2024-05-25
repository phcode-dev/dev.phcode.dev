/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2012 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * self program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * self program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with self program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

/**
 * Editor instance helpers change handling. Only to be used from Editor.js.
 */

define(function (require, exports, module) {

    const CodeMirror = require("thirdparty/CodeMirror/lib/codemirror"),
        Menus = require("command/Menus");

    function _applyChanges(changeList) {
        // eslint-disable-next-line no-invalid-this
        let self = this;
        // _visibleRange has already updated via its own Document listener. See if self change caused
        // it to lose sync. If so, our whole view is stale - signal our owner to close us.
        if (self._visibleRange) {
            if (self._visibleRange.startLine === null || self._visibleRange.endLine === null) {
                self.trigger("lostContent");
                return;
            }
        }

        // Apply text changes to CodeMirror editor
        var cm = self._codeMirror;
        cm.operation(function () {
            var change, newText, i;
            for (i = 0; i < changeList.length; i++) {
                change = changeList[i];
                newText = change.text.join('\n');
                if (!change.from || !change.to) {
                    if (change.from || change.to) {
                        console.error("Change record received with only one end undefined--replacing entire text");
                    }
                    cm.setValue(newText);
                } else {
                    cm.replaceRange(newText, change.from, change.to, change.origin);
                }

            }
        });

        // The update above may have inserted new lines - must hide any that fall outside our range
        self._updateHiddenLines();
    }

    /**
     * Responds to changes in the CodeMirror editor's text, syncing the changes to the Document.
     * There are several cases where we want to ignore a CodeMirror change:
     *  - if we're the master editor, editor changes can be ignored because Document is already listening
     *    for our changes
     *  - if we're a secondary editor, editor changes should be ignored if they were caused by us reacting
     *    to a Document change
     */
    function _handleEditorChange(changeList) {
        // eslint-disable-next-line no-invalid-this
        let self = this;
        // we're currently syncing from the Document, so don't echo back TO the Document
        if (self._duringSync) {
            return;
        }

        // Secondary editor: force creation of "master" editor backing the model, if doesn't exist yet
        self.document._ensureMasterEditor();

        if (self.document._masterEditor !== self) {
            // Secondary editor:
            // we're not the ground truth; if we got here, self was a real editor change (not a
            // sync from the real ground truth), so we need to sync from us into the document
            // (which will directly push the change into the master editor).
            // FUTURE: Technically we should add a replaceRange() method to Document and go through
            // that instead of talking to its master editor directly. It's not clear yet exactly
            // what the right Document API would be, though.
            self._duringSync = true;
            self.document._masterEditor._applyChanges(changeList);
            self._duringSync = false;

            // Update which lines are hidden inside our editor, since we're not going to go through
            // _applyChanges() in our own editor.
            self._updateHiddenLines();
        }
        // Else, Master editor:
        // we're the ground truth; nothing else to do, since Document listens directly to us
        // note: self change might have been a real edit made by the user, OR self might have
        // been a change synced from another editor

        // The "editorChange" event is mostly for the use of the CodeHintManager.
        // It differs from the normal "change" event, that it's actually publicly usable,
        // whereas the "change" event should be listened to on the document. Also the
        // Editor dispatches a change event before self event is dispatched, because
        // CodeHintManager needs to hook in here when other things are already done.
        self.trigger("editorChange", self, changeList);
    }

    /**
     * Responds to changes in the Document's text, syncing the changes into our CodeMirror instance.
     * There are several cases where we want to ignore a Document change:
     *  - if we're the master editor, Document changes should be ignored because we already have the right
     *    text (either the change originated with us, or it has already been set into us by Document)
     *  - if we're a secondary editor, Document changes should be ignored if they were caused by us sending
     *    the document an editor change that originated with us
     */
    function _handleDocumentChange(event, doc, changeList) {
        // eslint-disable-next-line no-invalid-this
        let self = this;
        // we're currently syncing to the Document, so don't echo back FROM the Document
        if (self._duringSync) {
            return;
        }

        if (self.document._masterEditor !== self) {
            // Secondary editor:
            // we're not the ground truth; and if we got here, self was a Document change that
            // didn't come from us (e.g. a sync from another editor, a direct programmatic change
            // to the document, or a sync from external disk changes)... so sync from the Document
            self._duringSync = true;
            self._applyChanges(changeList);
            self._duringSync = false;
        }
        // Else, Master editor:
        // we're the ground truth; nothing to do since Document change is just echoing our
        // editor changes
    }

    /**
     * Responds to the Document's underlying file being deleted. The Document is now basically dead,
     * so we must close.
     */
    function _handleDocumentDeleted(event) {
        // Pass the delete event along as the cause (needed in MultiRangeInlineEditor)
        self.trigger("lostContent", event);
    }

    /**
     * Responds to language changes, for instance when the file extension is changed.
     */
    function _handleDocumentLanguageChanged(event) {
        // eslint-disable-next-line no-invalid-this
        let self = this;
        self._codeMirror.setOption("mode", self._getModeFromDocument());
    }


    /**
     * Install event handlers on the CodeMirror instance, translating them into
     * jQuery events on the Editor instance.
     */
    function _installEditorListeners() {
        // eslint-disable-next-line no-invalid-this
        let self = this;

        // Redispatch these CodeMirror key events as Editor events
        function _onKeyEvent(instance, event) {
            self.trigger("keyEvent", self, event);  // deprecated
            self.trigger(event.type, self, event);
            return event.defaultPrevented;   // false tells CodeMirror we didn't eat the event
        }
        self._codeMirror.on("keydown",  _onKeyEvent);
        self._codeMirror.on("keypress", _onKeyEvent);
        self._codeMirror.on("keyup",    _onKeyEvent);

        // FUTURE: if self list grows longer, consider making self a more generic mapping
        // NOTE: change is a "private" event--others shouldn't listen to it on Editor, only on
        // Document
        // Also, note that we use the new "changes" event in v4, which provides an array of
        // change objects. Our own event is still called just "change".
        self._codeMirror.on("changes", function (instance, changeList) {
            self.trigger("change", self, changeList);
        });
        self._codeMirror.on("viewportChange", function (instance, from, to) {
            self.trigger("viewportChange", self, from, to);
        });
        self._codeMirror.on("beforeChange", function (instance, changeObj) {
            self.trigger("beforeChange", self, changeObj);
        });
        self._codeMirror.on("cursorActivity", function (instance) {
            self.trigger("cursorActivity", self);
        });
        self._codeMirror.on("beforeSelectionChange", function (instance, selectionObj) {
            self.trigger("beforeSelectionChange", selectionObj, self);
        });
        self._codeMirror.on("scroll", function (instance) {
            // If self editor is visible, close all dropdowns on scroll.
            // (We don't want to do self if we're just scrolling in a non-visible editor
            // in response to some document change event.)
            if (!self._shouldNotDismissPopupsOnScroll && self.isFullyVisible()) {
                Menus.closeAll();
            }

            self.trigger("scroll", self);
        });

        // Convert CodeMirror onFocus events to EditorManager activeEditorChanged
        self._codeMirror.on("focus", function () {
            self._focused = true;
            self.trigger("focus", self);

        });

        self._codeMirror.on("blur", function () {
            self._focused = false;
            self.trigger("blur", self);
        });

        self._codeMirror.on("update", function (instance) {
            self.trigger("update", self);
        });
        self._codeMirror.on("overwriteToggle", function (instance, newstate) {
            self.trigger("overwriteToggle", self, newstate);
        });

        // Disable CodeMirror's drop handling if a file/folder is dropped
        self._codeMirror.on("drop", function (cm, event) {
            var files = event.dataTransfer.files;
            if (files && files.length) {
                event.preventDefault();
            }
        });
        // For word wrap. Code adapted from https://codemirror.net/demo/indentwrap.html#
        self._codeMirror.on("renderLine", function (cm, line, elt) {
            var charWidth = self._codeMirror.defaultCharWidth();
            var off = CodeMirror.countColumn(line.text, null, cm.getOption("tabSize")) * charWidth;
            elt.style.textIndent = "-" + off + "px";
            elt.style.paddingLeft = off + "px";
        });
    }

    /**
     * will not dismiss any popups on scrolling the editor till the given timout
     * @param {number} [timeoutMs]
     * @private
     */
    function _dontDismissPopupOnScroll(timeoutMs = 500) {
        // eslint-disable-next-line no-invalid-this
        const self = this;
        // on live code hints, when the user is selecting code hints using arrow keys, the text in the editor changes.
        // If the text that is being changed falls beyond the editor border(Eg: end of a long line that is part occluded
        // by live preview panel), then cm will scroll the editor horizontally to show the changed text. On scrolling,
        // all popups are usually dismissed(see scroll event handler in this file), but that should happen if we
        // are live code hinting. So we do this.
        if(self._shouldNotDismissPopupsOnScroll){
            clearTimeout(self._shouldNotDismissPopupsOnScroll);
        }
        self._shouldNotDismissPopupsOnScroll = setTimeout(()=>{
            // we only wait for 500 ms after the user pressed up or down arrow key, after which its any scroll will
            // dismiss all popups. This is os that user may scroll the text using mouse which should dismiss popups.
            self._shouldNotDismissPopupsOnScroll = false;
        }, timeoutMs);
    }

    /**
     * add required helpers to editor
     * @param Editor
     */
    function addHelpers(Editor) {
        // only private Editor APIs should be assigned below. Public APIs should be updated in Editor.js only.
        Editor.prototype._applyChanges = _applyChanges;
        Editor.prototype._handleEditorChange = _handleEditorChange;
        Editor.prototype._handleDocumentChange = _handleDocumentChange;
        Editor.prototype._handleDocumentDeleted = _handleDocumentDeleted;
        Editor.prototype._handleDocumentLanguageChanged = _handleDocumentLanguageChanged;
        Editor.prototype._installEditorListeners = _installEditorListeners;
        Editor.prototype._dontDismissPopupOnScroll = _dontDismissPopupOnScroll;
    }

    exports.addHelpers =addHelpers;
});
