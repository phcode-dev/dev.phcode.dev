/*!
 * Brackets Git Extension
 *
 * @author Martin Zagora
 * @license http://opensource.org/licenses/MIT
 */

define(function (require, exports, module) {

    // Brackets modules
    const _               = brackets.getModule("thirdparty/lodash"),
        AppInit         = brackets.getModule("utils/AppInit"),
        ExtensionUtils  = brackets.getModule("utils/ExtensionUtils");

    // Local modules
    require("src/SettingsDialog");
    const EventEmitter    = require("src/EventEmitter"),
        Events          = require("src/Events"),
        Main            = require("src/Main"),
        Preferences     = require("src/Preferences"),
        Git             = require("src/git/Git"),
        BracketsEvents     = require("src/BracketsEvents");

    // Load extension modules that are not included by core
    var modules = [
        "src/GutterManager",
        "src/History",
        "src/NoRepo",
        "src/ProjectTreeMarks",
        "src/Remotes"
    ];
    require(modules);

    // Load CSS
    if(Phoenix.config.environment === "dev"){
        ExtensionUtils.loadStyleSheet(module, "styles/git-styles.less");
    } else {
        ExtensionUtils.loadStyleSheet(module, "styles/git-styles-min.css");
    }

    AppInit.appReady(function () {
        Main.init().then((enabled)=>{
            if(!enabled) {
                BracketsEvents.disableAll();
            }
        });
    });

    // export API's for other extensions
    if (typeof window === "object") {
        window.phoenixGitEvents = {
            EventEmitter: EventEmitter,
            Events: Events,
            Git
        };
    }
});

define("src/BracketsEvents", function (require, exports, module) {

    // Brackets modules
    const _               = brackets.getModule("thirdparty/lodash"),
        DocumentManager = brackets.getModule("document/DocumentManager"),
        FileSystem      = brackets.getModule("filesystem/FileSystem"),
        ProjectManager  = brackets.getModule("project/ProjectManager"),
        MainViewManager = brackets.getModule("view/MainViewManager");

    // Local modules
    const Events        = require("src/Events"),
        EventEmitter  = require("src/EventEmitter"),
        HistoryViewer = require("src/HistoryViewer"),
        Preferences   = require("src/Preferences"),
        Utils         = require("src/Utils");

    // White-list for .git file watching
    const watchedInsideGit = ["HEAD"];
    const GIT_EVENTS = "gitEvents";

    FileSystem.on(`change.${GIT_EVENTS}`, function (evt, file) {
        // we care only for files in current project
        var currentGitRoot = Preferences.get("currentGitRoot");
        if (file && file.fullPath.indexOf(currentGitRoot) === 0) {

            if (file.fullPath.indexOf(currentGitRoot + ".git/") === 0) {

                var whitelisted = _.any(watchedInsideGit, function (entry) {
                    return file.fullPath === currentGitRoot + ".git/" + entry;
                });
                if (!whitelisted) {
                    Utils.consoleDebug("Ignored FileSystem.change event: " + file.fullPath);
                    return;
                }

            }

            EventEmitter.emit(Events.BRACKETS_FILE_CHANGED, file);
        }
    });

    DocumentManager.on(`documentSaved.${GIT_EVENTS}`, function (evt, doc) {
        // we care only for files in current project
        if (doc.file.fullPath.indexOf(Preferences.get("currentGitRoot")) === 0) {
            EventEmitter.emit(Events.BRACKETS_DOCUMENT_SAVED, doc);
        }
    });

    MainViewManager.on(`currentFileChange.${GIT_EVENTS}`, function (evt, currentDocument, previousDocument) {
        currentDocument = currentDocument || DocumentManager.getCurrentDocument();
        if (!HistoryViewer.isVisible()) {
            EventEmitter.emit(Events.BRACKETS_CURRENT_DOCUMENT_CHANGE, currentDocument, previousDocument);
        } else {
            HistoryViewer.hide();
        }
    });

    ProjectManager.on(`projectOpen.${GIT_EVENTS}`, function () {
        EventEmitter.emit(Events.BRACKETS_PROJECT_CHANGE);
    });

    ProjectManager.on(`projectRefresh.${GIT_EVENTS}`, function () {
        EventEmitter.emit(Events.BRACKETS_PROJECT_REFRESH);
    });

    ProjectManager.on(`beforeProjectClose.${GIT_EVENTS}`, function () {
        // Disable Git when closing a project so listeners won't fire before new is opened
        EventEmitter.emit(Events.GIT_DISABLED);
    });

    function disableAll() {
        FileSystem.off(`change.${GIT_EVENTS}`);
        DocumentManager.off(`documentSaved.${GIT_EVENTS}`);
        MainViewManager.off(`currentFileChange.${GIT_EVENTS}`);
        ProjectManager.off(`projectOpen.${GIT_EVENTS}`);
        ProjectManager.off(`projectRefresh.${GIT_EVENTS}`);
        ProjectManager.off(`beforeProjectClose.${GIT_EVENTS}`);
    }

    exports.disableAll = disableAll;
});

define("src/Branch", function (require, exports) {

    var _                       = brackets.getModule("thirdparty/lodash"),
        CommandManager          = brackets.getModule("command/CommandManager"),
        Dialogs                 = brackets.getModule("widgets/Dialogs"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        FileSyncManager         = brackets.getModule("project/FileSyncManager"),
        FileSystem              = brackets.getModule("filesystem/FileSystem"),
        Menus                   = brackets.getModule("command/Menus"),
        Mustache                = brackets.getModule("thirdparty/mustache/mustache"),
        PopUpManager            = brackets.getModule("widgets/PopUpManager"),
        StringUtils             = brackets.getModule("utils/StringUtils"),
        DocumentManager         = brackets.getModule("document/DocumentManager"),
        Strings                 = brackets.getModule("strings"),
        Metrics                 = brackets.getModule("utils/Metrics"),
        MainViewManager         = brackets.getModule("view/MainViewManager");

    var Git                     = require("src/git/Git"),
        Events                  = require("src/Events"),
        EventEmitter            = require("src/EventEmitter"),
        ErrorHandler            = require("src/ErrorHandler"),
        Panel                   = require("src/Panel"),
        Setup                   = require("src/utils/Setup"),
        Preferences             = require("src/Preferences"),
        ProgressDialog          = require("src/dialogs/Progress"),
        Utils                   = require("src/Utils"),
        branchesMenuTemplate    = `<ul id="git-branch-dropdown" class="dropdown-menu" tabindex="-1">
    <li>
        <a class="git-branch-new">
            <span>{{Strings.CREATE_NEW_BRANCH}}</span>
        </a>
    </li>

    {{#branchList.length}}
    <li class="divider"></li>
    {{/branchList.length}}

    {{#branchList}}
    <li>
        <a class="git-branch-link" data-branch="{{name}}">
            {{#canDelete}}
            <span class="trash-icon">&times;</span>
            {{/canDelete}}
            <span class="merge-branch"><i title="{{Strings.MERGE_BRANCH}}" class="octicon octicon-git-merge"></i></span>
            <span class="switch-branch">{{name}}</span>
        </a>
    </li>
    {{/branchList}}
</ul>
`,
        newBranchTemplate       = `<div class="modal git">
    <div class="modal-header">
        <h1 class="dialog-title">{{Strings.CREATE_NEW_BRANCH_TITLE}}</h1>
    </div>
    <div class="modal-body tab-content">

        <form>
            <div>
                <label>{{Strings.ORIGIN_BRANCH}}:</label>
                <div>
                    <div class="input-append">
                        <select class="branchSelect" name="branch-origin"></select>
                        <button class="btn fetchBranches" type="button">
                            <i class="octicon octicon-sync"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div>
                <label>{{Strings.BRANCH_NAME}}:</label>
                <div>
                    <input name="branch-name" type="text" autocomplete="off" spellcheck="false" />
                </div>
            </div>
        </form>

    </div>
    <div class="modal-footer">
        <button data-button-id="cancel" class="dialog-button btn cancel" >{{Strings.BUTTON_CANCEL}}</button>
        <button data-button-id="ok"     class="dialog-button btn primary">{{Strings.BUTTON_OK}}</button>
    </div>
</div>
`,
        mergeBranchTemplate     = `<div class="modal git">
    <div class="modal-header">
        <h1 class="dialog-title">{{Strings.MERGE_BRANCH}} "{{fromBranch}}"</h1>
    </div>
    <div class="modal-body tab-content">
        <form>
            <div>
                <label>{{Strings.TARGET_BRANCH}}:</label>
                <div>
                    <select disabled name="branch-target">
                        {{#branches}}
                        <option value="{{name}}" remote="{{remote}}" {{#currentBranch}}selected{{/currentBranch}}>
                        {{name}}
                        </option>
                        {{/branches}}
                    </select>
                </div>
            </div>
            <div>
                <label>{{Strings.MERGE_MESSAGE}}:</label>
                <div>
                    <div class="input-append">
                        <input name="merge-message" type="text" placeholder="default" autocomplete="off">
                        <button class="btn fill-pr" type="button">PR</button>
                    </div>
                </div>
            </div>
            <div>
                <div>
                    <label>
                        <input type="checkbox" name="use-rebase"> {{Strings.USE_REBASE}}
                    </label>
                </div>
            </div>
            <div>
                <div>
                    <label>
                        <input type="checkbox" name="use-noff"> {{Strings.USE_NOFF}}
                    </label>
                </div>
            </div>
        </form>
    </div>

    <div class="modal-footer">
        <button data-button-id="cancel" class="dialog-button btn cancel btn-80" >{{Strings.BUTTON_CANCEL}}</button>
        <button data-button-id="ok"     class="dialog-button btn primary btn-80">{{Strings.BUTTON_OK}}</button>
    </div>
</div>
`;

    var $gitBranchName          = $(null),
        currentEditor,
        $dropdown;

    function renderList(branches) {
        branches = branches.map(function (name) {
            return {
                name: name,
                currentBranch: name.indexOf("* ") === 0,
                canDelete: name !== "master"
            };
        });
        var templateVars  = {
            branchList: _.filter(branches, function (o) { return !o.currentBranch; }),
            Strings:    Strings
        };
        return Mustache.render(branchesMenuTemplate, templateVars);
    }

    function closeDropdown() {
        if ($dropdown) {
            PopUpManager.removePopUp($dropdown);
        }
        detachCloseEvents();
    }

    function doMerge(fromBranch) {
        Git.getBranches().then(function (branches) {

            var compiledTemplate = Mustache.render(mergeBranchTemplate, {
                fromBranch: fromBranch,
                branches: branches,
                Strings: Strings
            });

            var dialog  = Dialogs.showModalDialogUsingTemplate(compiledTemplate);
            var $dialog = dialog.getElement();
            $dialog.find("input").focus();

            var $toBranch = $dialog.find("[name='branch-target']");
            var $useRebase = $dialog.find("[name='use-rebase']");
            var $useNoff = $dialog.find("[name='use-noff']");

            if (fromBranch === "master") {
                $useRebase.prop("checked", true);
            }
            if ($toBranch.val() === "master") {
                $useRebase.prop("checked", false).prop("disabled", true);
            }

            // fill merge message if possible
            var $mergeMessage = $dialog.find("[name='merge-message']");
            $mergeMessage.attr("placeholder", "Merge branch '" + fromBranch + "'");
            $dialog.find(".fill-pr").on("click", function () {
                var prMsg = "Merge pull request #??? from " + fromBranch;
                $mergeMessage.val(prMsg);
                $mergeMessage[0].setSelectionRange(prMsg.indexOf("???"), prMsg.indexOf("???") + 3);
            });

            // can't use rebase and no-ff together so have a change handler for this
            $useRebase.on("change", function () {
                var useRebase = $useRebase.prop("checked");
                $useNoff.prop("disabled", useRebase);
                if (useRebase) { $useNoff.prop("checked", false); }
            }).trigger("change");

            dialog.done(function (buttonId) {
                // right now only merge to current branch without any configuration
                // later delete merge branch and so ...
                var useRebase = $useRebase.prop("checked");
                var useNoff = $useNoff.prop("checked");
                var mergeMsg = $mergeMessage.val();

                if (buttonId === "ok") {

                    if (useRebase) {

                        Git.rebaseInit(fromBranch).catch(function (err) {
                            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'rebase', "fail");
                            throw ErrorHandler.showError(err, Strings.ERROR_REBASE_FAILED);
                        }).then(function (stdout) {
                            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'rebase', "success");
                            Utils.showOutput(stdout || Strings.GIT_REBASE_SUCCESS, Strings.REBASE_RESULT).finally(function () {
                                EventEmitter.emit(Events.REFRESH_ALL);
                            });
                        }).catch(console.error);
                    } else {

                        Git.mergeBranch(fromBranch, mergeMsg, useNoff).catch(function (err) {
                            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'merge', "fail");
                            throw ErrorHandler.showError(err, Strings.ERROR_MERGE_FAILED);
                        }).then(function (stdout) {
                            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'merge', "success");
                            Utils.showOutput(stdout || Strings.GIT_MERGE_SUCCESS, Strings.MERGE_RESULT).finally(function () {
                                EventEmitter.emit(Events.REFRESH_ALL);
                            });
                        }).catch(console.error);
                    }
                }
            });
        }).catch(err => {
            console.error("Error Getting branches", err);
            // we need to strip all user entered info from git thrown exception for get branches which shouldn't fail,
            // so we throw a blank error for bugsnag
            throw new Error("Failed to get getBranches while doMerge");
        });
    }

    function _reloadBranchSelect($el, branches) {
        var template = "{{#branches}}<option value='{{name}}' remote='{{remote}}' " +
            "{{#currentBranch}}selected{{/currentBranch}}>{{name}}</option>{{/branches}}";
        var html = Mustache.render(template, { branches: branches });
        $el.html(html);
    }

    function closeNotExistingFiles(oldBranchName, newBranchName) {
        return Git.getDeletedFiles(oldBranchName, newBranchName).then(function (deletedFiles) {

            var gitRoot     = Preferences.get("currentGitRoot"),
                openedFiles = MainViewManager.getWorkingSet(MainViewManager.ALL_PANES);

            // Close files that does not exists anymore in the new selected branch
            deletedFiles.forEach(function (dFile) {
                var oFile = _.find(openedFiles, function (oFile) {
                    return oFile.fullPath === gitRoot + dFile;
                });
                if (oFile) {
                    DocumentManager.closeFullEditor(oFile);
                }
            });

            EventEmitter.emit(Events.REFRESH_ALL);

        }).catch(function (err) {
            ErrorHandler.showError(err, Strings.ERROR_GETTING_DELETED_FILES);
        });
    }

    function handleEvents() {
        $dropdown.on("click", "a.git-branch-new", function (e) {
            e.stopPropagation();
            closeDropdown();

            Git.getAllBranches().catch(function (err) {
                ErrorHandler.showError(err);
            }).then(function (branches = []) {

                var compiledTemplate = Mustache.render(newBranchTemplate, {
                    branches: branches,
                    Strings: Strings
                });

                var dialog  = Dialogs.showModalDialogUsingTemplate(compiledTemplate);

                var $input  = dialog.getElement().find("[name='branch-name']"),
                    $select = dialog.getElement().find(".branchSelect");

                $select.on("change", function () {
                    if (!$input.val()) {
                        var $opt = $select.find(":selected"),
                            remote = $opt.attr("remote"),
                            newVal = $opt.val();
                        if (remote) {
                            newVal = newVal.substring(remote.length + 1);
                            if (remote !== "origin") {
                                newVal = remote + "#" + newVal;
                            }
                        }
                        $input.val(newVal);
                    }
                });

                _reloadBranchSelect($select, branches);
                dialog.getElement().find(".fetchBranches").on("click", function () {
                    var $this = $(this);
                    const tracker = ProgressDialog.newProgressTracker();
                    ProgressDialog.show(Git.fetchAllRemotes(tracker), tracker)
                        .then(function () {
                            return Git.getAllBranches().then(function (branches) {
                                $this.prop("disabled", true).attr("title", "Already fetched");
                                _reloadBranchSelect($select, branches);
                            });
                        }).catch(function (err) {
                            throw ErrorHandler.showError(err, Strings.ERROR_FETCH_REMOTE_INFO);
                        });
                });

                dialog.getElement().find("input").focus();
                dialog.done(function (buttonId) {
                    if (buttonId === "ok") {

                        var $dialog     = dialog.getElement(),
                            branchName  = $dialog.find("input[name='branch-name']").val().trim(),
                            $option     = $dialog.find("select[name='branch-origin']").children("option:selected"),
                            originName  = $option.val(),
                            isRemote    = $option.attr("remote"),
                            track       = !!isRemote;

                        Git.createBranch(branchName, originName, track).catch(function (err) {
                            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'branch', "createFail");
                            throw ErrorHandler.showError(err, Strings.ERROR_CREATE_BRANCH);
                        }).then(function () {
                            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'branch', "create");
                            EventEmitter.emit(Events.REFRESH_ALL);
                        });
                    }
                });
            });

        }).on("mouseenter", "a", function () {
            $(this).addClass("selected");
        }).on("mouseleave", "a", function () {
            $(this).removeClass("selected");
        }).on("click", "a.git-branch-link .trash-icon", function (e) {
            e.stopPropagation();
            closeDropdown();
            var branchName = $(this).parent().data("branch");
            Utils.askQuestion(Strings.DELETE_LOCAL_BRANCH,
                              StringUtils.format(Strings.DELETE_LOCAL_BRANCH_NAME, branchName),
                              { booleanResponse: true })
                .then(function (response) {
                    if (response === true) {
                        return Git.branchDelete(branchName).catch(function (err) {

                            return Utils.showOutput(err, "Branch deletion failed", {
                                question: "Do you wish to force branch deletion?"
                            }).then(function (response) {
                                if (response === true) {
                                    return Git.forceBranchDelete(branchName).then(function (output) {
                                        Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'branch', "delete");
                                        return Utils.showOutput(output || Strings.GIT_BRANCH_DELETE_SUCCESS);
                                    }).catch(function (err) {
                                        Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'branch', "deleteFail");
                                        ErrorHandler.showError(err, Strings.ERROR_BRANCH_DELETE_FORCED);
                                    });
                                }
                            });

                        });
                    }
                })
                .catch(function (err) {
                    ErrorHandler.showError(err);
                });

        }).on("click", ".merge-branch", function (e) {
            e.stopPropagation();
            closeDropdown();
            var fromBranch = $(this).parent().data("branch");
            doMerge(fromBranch);
        }).on("click", "a.git-branch-link", function (e) {

            e.stopPropagation();
            closeDropdown();
            var newBranchName = $(this).data("branch");

            Git.getCurrentBranchName().then(function (oldBranchName) {
                Git.checkout(newBranchName).then(function () {
                    Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'branch', "switch");
                    return closeNotExistingFiles(oldBranchName, newBranchName);
                }).catch(function (err) {
                    Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'branch', "switchFail");
                    ErrorHandler.showError(err, Strings.ERROR_SWITCHING_BRANCHES);
                });
            }).catch(function (err) {
                Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'branch', "switchFail");
                ErrorHandler.showError(err, Strings.ERROR_GETTING_CURRENT_BRANCH);
            });

        });
    }

    function attachCloseEvents() {
        $("html").on("click", closeDropdown);
        $("#project-files-container").on("scroll", closeDropdown);
        $("#titlebar .nav").on("click", closeDropdown);

        currentEditor = EditorManager.getCurrentFullEditor();
        if (currentEditor) {
            currentEditor._codeMirror.on("focus", closeDropdown);
        }

        // $(window).on("keydown", keydownHook);
    }

    function detachCloseEvents() {
        $("html").off("click", closeDropdown);
        $("#project-files-container").off("scroll", closeDropdown);
        $("#titlebar .nav").off("click", closeDropdown);

        if (currentEditor) {
            currentEditor._codeMirror.off("focus", closeDropdown);
        }

        // $(window).off("keydown", keydownHook);

        $dropdown = null;
    }

    function toggleDropdown(e) {
        e.stopPropagation();

        // If the dropdown is already visible, close it
        if ($dropdown) {
            closeDropdown();
            return;
        }

        Menus.closeAll();

        Git.getBranches().catch(function (err) {
            ErrorHandler.showError(err, Strings.ERROR_GETTING_BRANCH_LIST);
        }).then(function (branches = []) {
            branches = branches.reduce(function (arr, branch) {
                if (!branch.currentBranch && !branch.remote) {
                    arr.push(branch.name);
                }
                return arr;
            }, []);

            $dropdown = $(renderList(branches));
            const $toggle = $("#git-branch-dropdown-toggle");
            // two margins to account for the preceding project dropdown as well
            const marginLeft = (parseInt($toggle.css("margin-left"), 10) * 2) || 0;

            const toggleOffset = $toggle.offset();

            $dropdown
                .css({
                    left: toggleOffset.left - marginLeft + 3,
                    top: toggleOffset.top + $toggle.outerHeight() - 3
                })
                .appendTo($("body"));

            // fix so it doesn't overflow the screen
            var maxHeight = $dropdown.parent().height(),
                height = $dropdown.height(),
                topOffset = $dropdown.position().top;
            if (height + topOffset >= maxHeight - 10) {
                $dropdown.css("bottom", "10px");
            }

            PopUpManager.addPopUp($dropdown, detachCloseEvents, true, {closeCurrentPopups: true});
            PopUpManager.handleSelectionEvents($dropdown, {enableSearchFilter: true});
            attachCloseEvents();
            handleEvents();
        });
    }

    function _getHeadFilePath() {
        return Preferences.get("currentGitRoot") + ".git/HEAD";
    }

    function addHeadToTheFileIndex() {
        FileSystem.resolve(_getHeadFilePath(), function (err) {
            if (err) {
                ErrorHandler.logError(err, "Resolving .git/HEAD file failed");
                return;
            }
        });
    }

    function checkBranch() {
        FileSystem.getFileForPath(_getHeadFilePath()).read(function (err, contents) {
            if (err) {
                ErrorHandler.showError(err, Strings.ERROR_READING_GIT_HEAD);
                return;
            }

            contents = contents.trim();

            var m = contents.match(/^ref:\s+refs\/heads\/(\S+)/);

            // alternately try to parse the hash
            if (!m) { m = contents.match(/^([a-f0-9]{40})$/); }

            if (!m) {
                ErrorHandler.showError(new Error(StringUtils.format(Strings.ERROR_PARSING_BRANCH_NAME, contents)));
                return;
            }

            var branchInHead  = m[1],
                branchInUi    = $gitBranchName.text();

            if (branchInHead !== branchInUi) {
                refresh();
            }
        });
    }

    function refresh() {
        if ($gitBranchName.length === 0) { return; }

        // show info that branch is refreshing currently
        $gitBranchName
            .text("\u2026")
            .parent()
                .show();

        return Git.getGitRoot().then(function (gitRoot) {
            var projectRoot             = Utils.getProjectRoot(),
                isRepositoryRootOrChild = gitRoot && projectRoot.indexOf(gitRoot) === 0;

            $gitBranchName.parent().toggle(isRepositoryRootOrChild);

            if (!isRepositoryRootOrChild) {
                Preferences.set("currentGitRoot", projectRoot);
                Preferences.set("currentGitSubfolder", "");

                $gitBranchName
                    .off("click")
                    .text("not a git repo");
                Panel.disable("not-repo");

                return;
            }

            Preferences.set("currentGitRoot", gitRoot);
            Preferences.set("currentGitSubfolder", projectRoot.substring(gitRoot.length));

            // we are in a .git repo so read the head
            addHeadToTheFileIndex();

            return Git.getCurrentBranchName().then(function (branchName) {

                Git.getMergeInfo().then(function (mergeInfo) {

                    if (mergeInfo.mergeMode) {
                        branchName += "|MERGING";
                    }

                    if (mergeInfo.rebaseMode) {
                        if (mergeInfo.rebaseHead) {
                            branchName = mergeInfo.rebaseHead;
                        }
                        branchName += "|REBASE";
                        if (mergeInfo.rebaseNext && mergeInfo.rebaseLast) {
                            branchName += "(" + mergeInfo.rebaseNext + "/" + mergeInfo.rebaseLast + ")";
                        }
                    }

                    EventEmitter.emit(Events.REBASE_MERGE_MODE, mergeInfo.rebaseMode, mergeInfo.mergeMode);

                    var MAX_LEN = 18;

                    const tooltip = StringUtils.format(Strings.ON_BRANCH, branchName);
                    const html = `<i class="fas fa-code-branch"></i> ${
                        branchName.length > MAX_LEN ? branchName.substring(0, MAX_LEN) + "\u2026" : branchName
                    }`;
                    $gitBranchName
                        .html(html)
                        .attr("title", tooltip)
                        .off("click")
                        .on("click", toggleDropdown);
                    Panel.enable();

                }).catch(function (err) {
                    ErrorHandler.showError(err, Strings.ERROR_READING_GIT_STATE);
                });

            }).catch(function (ex) {
                if (ErrorHandler.contains(ex, "unknown revision")) {
                    $gitBranchName
                        .off("click")
                        .text("no branch");
                    Panel.enable();
                } else {
                    throw ex;
                }
            });
        }).catch(function (err) {
            ErrorHandler.showError(err);
        });
    }

    function init() {
        // Add branch name to project tree
        const $html = $(`<div id='git-branch-dropdown-toggle' class='btn-alt-quiet'>
            <span id='git-branch'>
                <i class="fas fa-code-branch"></i>
            </span>
            <span class="dropdown-arrow"></span>
            </div>`);
        $html.appendTo($("#project-files-header"));
        $gitBranchName = $("#git-branch");
        $html.on("click", function () {
            $gitBranchName.click();
            return false;
        });
        if(Setup.isExtensionActivated()){
            refresh();
            return;
        }
        $("#git-branch-dropdown-toggle").addClass("forced-inVisible");
    }

    EventEmitter.on(Events.BRACKETS_FILE_CHANGED, function (file) {
        if (file.fullPath === _getHeadFilePath()) {
            checkBranch();
        }
    });

    EventEmitter.on(Events.REFRESH_ALL, function () {
        FileSyncManager.syncOpenDocuments();
        CommandManager.execute("file.refresh");
        refresh();
    });

    EventEmitter.on(Events.BRACKETS_PROJECT_CHANGE, function () {
        refresh();
    });

    EventEmitter.on(Events.BRACKETS_PROJECT_REFRESH, function () {
        refresh();
    });

    EventEmitter.on(Events.GIT_ENABLED, function () {
        $("#git-branch-dropdown-toggle").removeClass("forced-inVisible");
    });
    EventEmitter.on(Events.GIT_DISABLED, function () {
        $("#git-branch-dropdown-toggle").addClass("forced-inVisible");
    });

    exports.init    = init;
    exports.refresh = refresh;

});

/*globals logger, fs*/
define("src/Cli", function (require, exports, module) {

    const NodeConnector = brackets.getModule('NodeConnector');

    const ErrorHandler  = require("src/ErrorHandler"),
        Preferences   = require("src/Preferences"),
        Events        = require("src/Events"),
        Utils         = require("src/Utils");

    let gitTimeout        = Preferences.get("gitTimeout") * 1000,
        nextCliId         = 0,
        deferredMap       = {};

    Preferences.getExtensionPref().on("change", "gitTimeout", ()=>{
        gitTimeout = Preferences.get("gitTimeout") * 1000;
    });

    // Constants
    var MAX_COUNTER_VALUE = 4294967295; // 2^32 - 1

    let gitNodeConnector = NodeConnector.createNodeConnector("phcode-git-core", exports);
    gitNodeConnector.on(Events.GIT_PROGRESS_EVENT, (_event, evtData) => {
        const deferred = deferredMap[evtData.cliId];
        if(!deferred){
            ErrorHandler.logError("Progress sent for a non-existing process(" + evtData.cliId + "): " + evtData);
            return;
        }
        if (!deferred.isResolved && deferred.progressTracker) {
            deferred.progressTracker.trigger(Events.GIT_PROGRESS_EVENT, evtData.data);
        }
    });

    function getNextCliId() {
        if (nextCliId >= MAX_COUNTER_VALUE) {
            nextCliId = 0;
        }
        return ++nextCliId;
    }

    function normalizePathForOs(path) {
        if (brackets.platform === "win") {
            path = path.replace(/\//g, "\\");
        }
        return path;
    }

    // this functions prevents sensitive info from going further (like http passwords)
    function sanitizeOutput(str) {
        if (typeof str !== "string") {
            if (str != null) { // checks for both null & undefined
                str = str.toString();
            } else {
                str = "";
            }
        }
        return str;
    }

    function logDebug(opts, debugInfo, method, type, out) {
        if (!logger.loggingOptions.logGit) {
            return;
        }
        var processInfo = [];

        var duration = (new Date()).getTime() - debugInfo.startTime;
        processInfo.push(duration + "ms");

        if (opts.cliId) {
            processInfo.push("ID=" + opts.cliId);
        }

        var msg = "cmd-" + method + "-" + type + " (" + processInfo.join(";") + ")";
        if (out) { msg += ": \"" + out + "\""; }
        Utils.consoleDebug(msg);
    }

    function cliHandler(method, cmd, args, opts, retry) {
        const cliPromise = new Promise((resolve, reject)=>{
            const cliId     = getNextCliId();
            args = args || [];
            opts = opts || {};
            const progressTracker = opts.progressTracker;

            const savedDefer = {resolve, reject, progressTracker};
            deferredMap[cliId] = savedDefer;

            const watchProgress = !!progressTracker || (args.indexOf("--progress") !== -1);
            const startTime = (new Date()).getTime();

            // it is possible to set a custom working directory in options
            // otherwise the current project root is used to execute commands
            if (!opts.cwd) {
                opts.cwd = fs.getTauriPlatformPath(Preferences.get("currentGitRoot") || Utils.getProjectRoot());
            }

            // convert paths like c:/foo/bar to c:\foo\bar on windows
            opts.cwd = normalizePathForOs(opts.cwd);

            // log all cli communication into console when debug mode is on
            Utils.consoleDebug("cmd-" + method + (watchProgress ? "-watch" : "") + ": " +
                opts.cwd + " -> " +
                cmd + " " + args.join(" "));

            let resolved      = false,
                timeoutLength = opts.timeout ? (opts.timeout * 1000) : gitTimeout;

            const domainOpts = {
                cliId: cliId,
                watchProgress: watchProgress
            };

            const debugInfo = {
                startTime: startTime
            };

            if (watchProgress && progressTracker) {
                progressTracker.trigger(Events.GIT_PROGRESS_EVENT,
                    "Running command: git " + args.join(" "));
            }

            gitNodeConnector.execPeer(method, {directory: opts.cwd, command: cmd, args: args, opts: domainOpts})
                .catch(function (err) {
                    if (!resolved) {
                        err = sanitizeOutput(err);
                        logDebug(domainOpts, debugInfo, method, "fail", err);
                        delete deferredMap[cliId];

                        err = ErrorHandler.toError(err);

                        // spawn ENOENT error
                        var invalidCwdErr = "spawn ENOENT";
                        if (err.stack && err.stack.indexOf(invalidCwdErr)) {
                            err.message = err.message.replace(invalidCwdErr, invalidCwdErr + " (" + opts.cwd + ")");
                            err.stack = err.stack.replace(invalidCwdErr, invalidCwdErr + " (" + opts.cwd + ")");
                        }

                        // socket was closed so we should try this once again (if not already retrying)
                        if (err.stack && err.stack.indexOf("WebSocket.self._ws.onclose") !== -1 && !retry) {
                            cliHandler(method, cmd, args, opts, true)
                                .then(function (response) {
                                    savedDefer.isResolved = true;
                                    resolve(response);
                                })
                                .catch(function (err) {
                                    reject(err);
                                });
                            return;
                        }

                        reject(err);
                    }
                })
                .then(function (out) {
                    if (!resolved) {
                        out = sanitizeOutput(out);
                        logDebug(domainOpts, debugInfo, method, "out", out);
                        delete deferredMap[cliId];
                        resolve(out);
                    }
                })
                .finally(function () {
                    progressTracker && progressTracker.off(`${Events.GIT_PROGRESS_EVENT}.${cliId}`);
                    resolved = true;
                });

            function timeoutPromise() {
                logDebug(domainOpts, debugInfo, method, "timeout");
                var err = new Error("cmd-" + method + "-timeout: " + cmd + " " + args.join(" "));
                if (!opts.timeoutExpected) {
                    ErrorHandler.logError(err);
                }

                // process still lives and we need to kill it
                gitNodeConnector.execPeer("kill", domainOpts.cliId)
                    .catch(function (err) {
                        ErrorHandler.logError(err);
                    });

                delete deferredMap[cliId];
                reject(ErrorHandler.toError(err));
                resolved = true;
                progressTracker && progressTracker.off(`${Events.GIT_PROGRESS_EVENT}.${cliId}`);
            }

            var lastProgressTime = 0;
            function timeoutCall() {
                setTimeout(function () {
                    if (!resolved) {
                        if (domainOpts.watchProgress) {
                            // we are watching the promise progress
                            // so we should check if the last message was sent in more than timeout time
                            const currentTime = (new Date()).getTime();
                            const diff = currentTime - lastProgressTime;
                            if (diff > timeoutLength) {
                                Utils.consoleDebug("cmd(" + cliId + ") - last progress message was sent " + diff + "ms ago - timeout");
                                timeoutPromise();
                            } else {
                                Utils.consoleDebug("cmd(" + cliId + ") - last progress message was sent " + diff + "ms ago - delay");
                                timeoutCall();
                            }
                        } else {
                            // we don't have any custom handler, so just kill the promise here
                            // note that command WILL keep running in the background
                            // so even when timeout occurs, operation might finish after it
                            timeoutPromise();
                        }
                    }
                }, timeoutLength);
            }

            // when opts.timeout === false then never timeout the process
            if (opts.timeout !== false) {
                // if we are watching for progress events, mark the time when last progress was made
                if (domainOpts.watchProgress && progressTracker) {
                    progressTracker.off(`${Events.GIT_PROGRESS_EVENT}.${cliId}`);
                    progressTracker.on(`${Events.GIT_PROGRESS_EVENT}.${cliId}`, function () {
                        lastProgressTime = (new Date()).getTime();
                    });
                }
                // call the method which will timeout the promise after a certain period of time
                timeoutCall();
            }
        });
        return cliPromise;
    }

    function which(cmd) {
        return cliHandler("which", cmd);
    }

    function spawnCommand(cmd, args, opts) {
        return cliHandler("spawn", cmd, args, opts);
    }

    // Public API
    exports.cliHandler      = cliHandler;
    exports.which           = which;
    exports.spawnCommand    = spawnCommand;
});

/*jslint plusplus: true, vars: true, nomen: true */
/*global $, brackets, define */

define("src/CloseNotModified", function (require, exports) {

    const DocumentManager = brackets.getModule("document/DocumentManager"),
        Commands        = brackets.getModule("command/Commands"),
        CommandManager  = brackets.getModule("command/CommandManager"),
        Strings         = brackets.getModule("strings"),
        MainViewManager = brackets.getModule("view/MainViewManager");

    const Events      = require("src/Events"),
        EventEmitter  = require("src/EventEmitter"),
        Git           = require("src/git/Git"),
        Preferences   = require("src/Preferences"),
        Constants     = require("src/Constants"),
        Utils         = require("src/Utils");

    let closeUnmodifiedCmd;

    function handleCloseNotModified() {
        Git.status().then(function (modifiedFiles) {
            var openFiles      = MainViewManager.getWorkingSet(MainViewManager.ALL_PANES),
                currentGitRoot = Preferences.get("currentGitRoot");

            openFiles.forEach(function (openFile) {
                var removeOpenFile = true;
                modifiedFiles.forEach(function (modifiedFile) {
                    if (currentGitRoot + modifiedFile.file === openFile.fullPath) {
                        removeOpenFile = false;
                    }
                });

                if (removeOpenFile) {
                    // check if file doesn't have any unsaved changes
                    const doc = DocumentManager.getOpenDocumentForPath(openFile.fullPath);
                    // document will not  be present for images, or if the file is in working set but
                    // no editor is attached yet(eg. session restore on app start)
                    if (!doc || !doc.isDirty) {
                        CommandManager.execute(Commands.FILE_CLOSE_LIST, {PaneId: MainViewManager.ALL_PANES, fileList: [openFile]});
                    }
                }
            });

            MainViewManager.focusActivePane();
        });
    }

    function init() {
        closeUnmodifiedCmd       = CommandManager.register(Strings.CMD_CLOSE_UNMODIFIED,
            Constants.CMD_GIT_CLOSE_UNMODIFIED, handleCloseNotModified);
        Utils.enableCommand(Constants.CMD_GIT_CLOSE_UNMODIFIED, false);
    }

    EventEmitter.on(Events.GIT_ENABLED, function () {
        Utils.enableCommand(Constants.CMD_GIT_CLOSE_UNMODIFIED, true);
    });

    EventEmitter.on(Events.GIT_DISABLED, function () {
        Utils.enableCommand(Constants.CMD_GIT_CLOSE_UNMODIFIED, false);
    });

    // Public API
    exports.init = init;
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

define("src/Constants", function (require, exports) {
    const Commands = brackets.getModule("command/Commands"),
        Menus = brackets.getModule("command/Menus");

    exports.GIT_STRING_UNIVERSAL = "Git";
    exports.GIT_SUB_MENU = Menus.SubMenuIds.GIT_SUB_MENU;

    // Menus
    exports.GIT_PANEL_CHANGES_CMENU = "git-panel-changes-cmenu";
    exports.GIT_PANEL_HISTORY_CMENU = "git-panel-history-cmenu";
    exports.GIT_PANEL_OPTIONS_CMENU = "git-panel-options-cmenu";

    // commands
    exports.CMD_GIT_INIT = Commands.CMD_GIT_INIT;
    exports.CMD_GIT_CLONE = Commands.CMD_GIT_CLONE;
    exports.CMD_GIT_CLONE_WITH_URL = Commands.CMD_GIT_CLONE_WITH_URL;
    exports.CMD_GIT_SETTINGS_COMMAND_ID = Commands.CMD_GIT_SETTINGS_COMMAND_ID;
    exports.CMD_GIT_CLOSE_UNMODIFIED = Commands.CMD_GIT_CLOSE_UNMODIFIED;
    exports.CMD_GIT_CHECKOUT = Commands.CMD_GIT_CHECKOUT;
    exports.CMD_GIT_RESET_HARD = Commands.CMD_GIT_RESET_HARD;
    exports.CMD_GIT_RESET_SOFT = Commands.CMD_GIT_RESET_SOFT;
    exports.CMD_GIT_RESET_MIXED = Commands.CMD_GIT_RESET_MIXED;
    exports.CMD_GIT_TOGGLE_PANEL = Commands.CMD_GIT_TOGGLE_PANEL;
    exports.CMD_GIT_GOTO_NEXT_CHANGE = Commands.CMD_GIT_GOTO_NEXT_CHANGE;
    exports.CMD_GIT_GOTO_PREVIOUS_CHANGE = Commands.CMD_GIT_GOTO_PREVIOUS_CHANGE;
    exports.CMD_GIT_COMMIT_CURRENT = Commands.CMD_GIT_COMMIT_CURRENT;
    exports.CMD_GIT_COMMIT_ALL = Commands.CMD_GIT_COMMIT_ALL;
    exports.CMD_GIT_FETCH = Commands.CMD_GIT_FETCH;
    exports.CMD_GIT_PULL = Commands.CMD_GIT_PULL;
    exports.CMD_GIT_PUSH = Commands.CMD_GIT_PUSH;
    exports.CMD_GIT_REFRESH = Commands.CMD_GIT_REFRESH;
    exports.CMD_GIT_TAG = Commands.CMD_GIT_TAG;
    exports.CMD_GIT_DISCARD_ALL_CHANGES = Commands.CMD_GIT_DISCARD_ALL_CHANGES;
    exports.CMD_GIT_UNDO_LAST_COMMIT = Commands.CMD_GIT_UNDO_LAST_COMMIT;
    exports.CMD_GIT_CHANGE_USERNAME = Commands.CMD_GIT_CHANGE_USERNAME;
    exports.CMD_GIT_CHANGE_EMAIL = Commands.CMD_GIT_CHANGE_EMAIL;
    exports.CMD_GIT_GERRIT_PUSH_REF = Commands.CMD_GIT_GERRIT_PUSH_REF;
    exports.CMD_GIT_AUTHORS_OF_SELECTION = Commands.CMD_GIT_AUTHORS_OF_SELECTION;
    exports.CMD_GIT_AUTHORS_OF_FILE = Commands.CMD_GIT_AUTHORS_OF_FILE;
    exports.CMD_GIT_TOGGLE_UNTRACKED = Commands.CMD_GIT_TOGGLE_UNTRACKED;
});

define("src/ErrorHandler", function (require, exports) {

    const Dialogs                    = brackets.getModule("widgets/Dialogs"),
        Mustache                   = brackets.getModule("thirdparty/mustache/mustache"),
        Metrics                    = brackets.getModule("utils/Metrics"),
        Strings                    = brackets.getModule("strings"),
        Utils                      = require("src/Utils"),
        errorDialogTemplate        = `<div id="git-error-dialog" class="modal">
    <div class="modal-header">
        <h1 class="dialog-title">{{Strings.BRACKETS_GIT_ERROR}}</h1>
    </div>
    <div class="modal-body table-striped tab-content">
        <h3>{{title}}</h3>
        <pre>{{body}}</pre>
    </div>
    <div class="modal-footer">
        <button data-button-id="close"  class="primary dialog-button btn btn-80">{{Strings.BUTTON_CLOSE}}</button>
    </div>
</div>
`;

    function errorToString(err) {
        return Utils.encodeSensitiveInformation(err.toString());
    }

    exports.isTimeout = function (err) {
        return err instanceof Error && (
            err.message.indexOf("cmd-execute-timeout") === 0 ||
            err.message.indexOf("cmd-spawn-timeout") === 0
        );
    };

    exports.equals = function (err, what) {
        return err.toString().toLowerCase() === what.toLowerCase();
    };

    exports.contains = function (err, what) {
        return err.toString().toLowerCase().indexOf(what.toLowerCase()) !== -1;
    };

    exports.matches = function (err, regExp) {
        return err.toString().match(regExp);
    };

    exports.logError = function (err) {
        const msg = err && err.stack ? err.stack : err;
        Utils.consoleError("[brackets-git] " + msg);
        return err;
    };

    /**
     *
     * @param err
     * @param title
     * @param {dontStripError: boolean, errorMetric: string} options
     */
    exports.showError = function (err, title, options = {}) {
        const dontStripError = options.dontStripError;
        const errorMetric = options.errorMetric;
        Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'dialogErr', errorMetric || "Show");
        if (err.__shown) { return err; }

        exports.logError(err);

        let errorBody,
            errorStack;

        if (typeof err === "string") {
            errorBody = err;
        } else if (err instanceof Error) {
            errorBody = dontStripError ? err.toString() : errorToString(err);
            errorStack = err.stack || "";
        }

        if (!errorBody || errorBody === "[object Object]") {
            try {
                errorBody = JSON.stringify(err, null, 4);
            } catch (e) {
                errorBody = "Error can't be stringified by JSON.stringify";
            }
        }

        var compiledTemplate = Mustache.render(errorDialogTemplate, {
            title: title,
            body: window.debugMode ? `${errorBody}\n${errorStack}` : errorBody,
            Strings: Strings
        });

        Dialogs.showModalDialogUsingTemplate(compiledTemplate);
        if (typeof err === "string") { err = new Error(err); }
        err.__shown = true;
        return err;
    };

    exports.toError = function (arg) {
        // FUTURE: use this everywhere and have a custom error class for this extension
        if (arg instanceof Error) { return arg; }
        var err = new Error(arg);
        // TODO: new class for this?
        err.match = function () {
            return arg.match.apply(arg, arguments);
        };
        return err;
    };

});

define("src/EventEmitter", function (require, exports, module) {
    const EventDispatcher = brackets.getModule("utils/EventDispatcher"),
        Metrics = brackets.getModule("utils/Metrics");

    const emInstance = {};
    EventDispatcher.makeEventDispatcher(emInstance);

    function getEmitter(eventName, optionalMetricToLog) {
        if (!eventName) {
            throw new Error("no event has been passed to get the emittor!");
        }
        return function () {
            emit(eventName, ...arguments);
            if(optionalMetricToLog) {
                Metrics.countEvent(Metrics.EVENT_TYPE.GIT, optionalMetricToLog[0], optionalMetricToLog[1]);
            }
        };
    }

    function emit() {
        emInstance.trigger(...arguments);
    }

    function on(eventName, callback) {
        emInstance.on(eventName, (...args)=>{
            // Extract everything except the first argument (_event) which is event data we don't use
            const [, ...rest] = args;
            callback(...rest);
        });
    }

    function one(eventName, callback) {
        emInstance.one(eventName, (...args)=>{
            // Extract everything except the first argument (_event) which is event data we don't use
            const [, ...rest] = args;
            callback(...rest);
        });
    }

    exports.getEmitter = getEmitter;
    exports.emit = emit;
    exports.on = on;
    exports.one = one;
});

define("src/Events", function (require, exports) {

    /**
     * List of Events to be used in the extension.
     * Events should be structured by file who emits them.
     */

    // Brackets events
    exports.BRACKETS_CURRENT_DOCUMENT_CHANGE = "brackets_current_document_change";
    exports.BRACKETS_PROJECT_CHANGE = "brackets_project_change";
    exports.BRACKETS_PROJECT_REFRESH = "brackets_project_refresh";
    exports.BRACKETS_DOCUMENT_SAVED = "brackets_document_saved";
    exports.BRACKETS_FILE_CHANGED = "brackets_file_changed";

    // Git events
    exports.GIT_PROGRESS_EVENT = "git_progress";
    exports.GIT_USERNAME_CHANGED = "git_username_changed";
    exports.GIT_EMAIL_CHANGED = "git_email_changed";
    exports.GIT_COMMITED = "git_commited";
    exports.GIT_NO_BRANCH_EXISTS = "git_no_branch_exists";
    exports.GIT_CHANGE_USERNAME = "git_change_username";
    exports.GIT_CHANGE_EMAIL = "git_change_email";

    // Gerrit events
    exports.GERRIT_TOGGLE_PUSH_REF = "gerrit_toggle_push_ref";
    exports.GERRIT_PUSH_REF_TOGGLED = "gerrit_push_ref_toggled";

    // Startup events
    exports.REFRESH_ALL = "git_refresh_all";
    exports.GIT_ENABLED = "git_enabled";
    exports.GIT_DISABLED = "git_disabled";
    exports.REBASE_MERGE_MODE = "rebase_merge_mode";

    // Panel.js
    exports.HANDLE_GIT_INIT = "handle_git_init";
    exports.HANDLE_GIT_CLONE = "handle_git_clone";
    exports.HANDLE_GIT_COMMIT = "handle_git_commit";
    exports.HANDLE_FETCH = "handle_fetch";
    exports.HANDLE_PUSH = "handle_push";
    exports.HANDLE_PULL = "handle_pull";
    exports.HANDLE_REMOTE_PICK = "handle_remote_pick";
    exports.HANDLE_REMOTE_DELETE = "handle_remote_delete";
    exports.HANDLE_REMOTE_CREATE = "handle_remote_create";
    exports.HANDLE_FTP_PUSH = "handle_ftp_push";
    exports.HISTORY_SHOW_FILE = "history_showFile";
    exports.HISTORY_SHOW_GLOBAL = "history_showGlobal";
    exports.REFRESH_COUNTERS = "refresh_counters";
    exports.REFRESH_HISTORY = "refresh_history";

    // Git results
    exports.GIT_STATUS_RESULTS = "git_status_results";

    // Remotes.js
    exports.GIT_REMOTE_AVAILABLE = "git_remote_available";
    exports.GIT_REMOTE_NOT_AVAILABLE = "git_remote_not_available";
    exports.REMOTES_REFRESH_PICKER = "remotes_refresh_picker";
    exports.FETCH_STARTED = "remotes_fetch_started";
    exports.FETCH_COMPLETE = "remotes_fetch_complete";
});

/*jslint plusplus: true, vars: true, nomen: true */
/*global define */

define("src/ExpectedError", function (require, exports, module) {

    function ExpectedError() {
        Error.apply(this, arguments);
        this.message = arguments[0];
    }
    ExpectedError.prototype = new Error();
    ExpectedError.prototype.name = "ExpectedError";
    ExpectedError.prototype.toString = function () {
        return this.message;
    };

    module.exports = ExpectedError;
});

// this file was composed with a big help from @MiguelCastillo extension Brackets-InteractiveLinter
// @see https://github.com/MiguelCastillo/Brackets-InteractiveLinter

define("src/GutterManager", function (require, exports) {

    // Brackets modules
    var _               = brackets.getModule("thirdparty/lodash"),
        CommandManager  = brackets.getModule("command/CommandManager"),
        DocumentManager = brackets.getModule("document/DocumentManager"),
        EditorManager   = brackets.getModule("editor/EditorManager"),
        MainViewManager = brackets.getModule("view/MainViewManager"),
        ErrorHandler    = require("src/ErrorHandler"),
        Events          = require("src/Events"),
        EventEmitter    = require("src/EventEmitter"),
        Git             = require("src/git/Git"),
        Preferences     = require("./Preferences"),
        Strings             = brackets.getModule("strings");

    var gitAvailable = false,
        gutterName = "brackets-git-gutter",
        editorsWithGutters = [],
        openWidgets = [];

    /**
     * Checks if there's already a gutter marker on the given line;
     * if not, inserts a blank <div> to prevent an empty gutter spot.
     */
    function _addDummyGutterMarkerIfNotExist(cm, line) {
        var lineInfo = cm.lineInfo(line);
        if (!lineInfo) {
            return; // If line is out of range or doc is empty
        }
        var gutters = cm.getOption("gutters").slice(0),
            gutterEnabled = gutters.indexOf(gutterName);
        if(gutterEnabled === -1){
            return;
        }
        var gutterMarkers = lineInfo.gutterMarkers;
        var existingMarker = gutterMarkers && gutterMarkers[gutterName];
        if (!existingMarker) {
            var dummy = document.createElement("div");
            dummy.className = "CodeMirror-gitGutter-none";
            cm.setGutterMarker(line, gutterName, dummy);
        }
    }

    function _cursorActivity(_evt, editor){
        // this is to prevent a gutter gap in the active line if there is no color on this line.
        _addDummyGutterMarkerIfNotExist(editor._codeMirror, editor.getCursorPos().line);
    }

    EditorManager.on("activeEditorChange", function (event, newEditor, oldEditor) {
        if(newEditor){
            newEditor.off("cursorActivity.gitGutter");
            newEditor.on("cursorActivity.gitGutter", _cursorActivity);
            _cursorActivity(null, newEditor);
        }
        if(oldEditor){
            oldEditor.off("cursorActivity.gitGutter");
        }
    });

    function clearWidgets() {
        var lines = openWidgets.map(function (mark) {
            var w = mark.lineWidget;
            if (w.visible) {
                w.visible = false;
                w.widget.clear();
            }
            return {
                cm: mark.cm,
                line: mark.line
            };
        });
        openWidgets = [];
        return lines;
    }

    function clearOld(editor) {
        var cm = editor._codeMirror;
        if (!cm) { return; }

        var gutters = cm.getOption("gutters").slice(0),
            io = gutters.indexOf(gutterName);

        if (io !== -1) {
            gutters.splice(io, 1);
            cm.clearGutter(gutterName);
            cm.setOption("gutters", gutters);
            cm.off("gutterClick", gutterClick);
        }

        delete cm.gitGutters;

        clearWidgets();
    }

    function prepareGutter(editor) {
        // add our gutter if its not already available
        var cm = editor._codeMirror;

        var gutters = cm.getOption("gutters").slice(0);
        if (gutters.indexOf(gutterName) === -1) {
            gutters.unshift(gutterName);
            cm.setOption("gutters", gutters);
            cm.on("gutterClick", gutterClick);
        }

        if (editorsWithGutters.indexOf(editor) === -1) {
            editorsWithGutters.push(editor);
        }
    }

    function prepareGutters(editors) {
        editors.forEach(function (editor) {
            prepareGutter(editor);
        });
        // clear the rest
        var idx = editorsWithGutters.length;
        while (idx--) {
            if (editors.indexOf(editorsWithGutters[idx]) === -1) {
                clearOld(editorsWithGutters[idx]);
                editorsWithGutters.splice(idx, 1);
            }
        }
    }

    function showGutters(editor, _results) {
        prepareGutter(editor);

        var cm = editor._codeMirror;
        cm.gitGutters = _.sortBy(_results, "line");

        // get line numbers of currently opened widgets
        var openBefore = clearWidgets();

        cm.clearGutter(gutterName);
        cm.gitGutters.forEach(function (obj) {
            var $marker = $("<div>")
                            .addClass(gutterName + "-" + obj.type + " gitline-" + (obj.line + 1))
                            .html("&nbsp;");
            cm.setGutterMarker(obj.line, gutterName, $marker[0]);
        });
        _cursorActivity(null, editor);
        // reopen widgets that were opened before refresh
        openBefore.forEach(function (obj) {
            gutterClick(obj.cm, obj.line, gutterName);
        });
    }

    function gutterClick(cm, lineIndex, gutterId) {
        if (!cm) {
            return;
        }

        if (gutterId !== gutterName && gutterId !== "CodeMirror-linenumbers") {
            return;
        }

        var mark = _.find(cm.gitGutters, function (o) { return o.line === lineIndex; });
        if (!mark || mark.type === "added") { return; }

        // we need to be able to identify cm instance from any mark
        mark.cm = cm;

        if (mark.parentMark) { mark = mark.parentMark; }

        if (!mark.lineWidget) {
            mark.lineWidget = {
                visible: false,
                element: $("<div class='" + gutterName + "-deleted-lines'></div>")
            };
            var $btn = $("<button/>")
                .addClass("brackets-git-gutter-copy-button")
                .text("R")
                .on("click", function () {
                    var doc = DocumentManager.getCurrentDocument();
                    doc.replaceRange(mark.content + "\n", {
                        line: mark.line,
                        ch: 0
                    });
                    CommandManager.execute("file.save");
                    refresh();
                });
            $("<pre/>")
                .attr("style", "tab-size:" + cm.getOption("tabSize"))
                .text(mark.content || " ")
                .append($btn)
                .appendTo(mark.lineWidget.element);
        }

        if (mark.lineWidget.visible !== true) {
            mark.lineWidget.visible = true;
            mark.lineWidget.widget = cm.addLineWidget(mark.line, mark.lineWidget.element[0], {
                coverGutter: false,
                noHScroll: false,
                above: true,
                showIfHidden: false
            });
            openWidgets.push(mark);
        } else {
            mark.lineWidget.visible = false;
            mark.lineWidget.widget.clear();
            var io = openWidgets.indexOf(mark);
            if (io !== -1) {
                openWidgets.splice(io, 1);
            }
        }
    }

    function getEditorFromPane(paneId) {
        var currentPath = MainViewManager.getCurrentlyViewedPath(paneId),
            doc = currentPath && DocumentManager.getOpenDocumentForPath(currentPath);
        return doc && doc._masterEditor;
    }

    function processDiffResults(editor, diff) {
        var added = [],
            removed = [],
            modified = [],
            changesets = diff.split(/\n@@/).map(function (str) { return "@@" + str; });

        // remove part before first
        changesets.shift();

        changesets.forEach(function (str) {
            var m = str.match(/^@@ -([,0-9]+) \+([,0-9]+) @@/);
            var s1 = m[1].split(",");
            var s2 = m[2].split(",");

            // removed stuff
            var lineRemovedFrom;
            var lineFrom = parseInt(s2[0], 10);
            var lineCount = parseInt(s1[1], 10);
            if (isNaN(lineCount)) { lineCount = 1; }
            if (lineCount > 0) {
                lineRemovedFrom = lineFrom - 1;
                removed.push({
                    type: "removed",
                    line: lineRemovedFrom,
                    content: str.split("\n")
                                .filter(function (l) { return l.indexOf("-") === 0; })
                                .map(function (l) { return l.substring(1); })
                                .join("\n")
                });
            }

            // added stuff
            lineFrom = parseInt(s2[0], 10);
            lineCount = parseInt(s2[1], 10);
            if (isNaN(lineCount)) { lineCount = 1; }
            var isModifiedMark = false;
            var firstAddedMark = false;
            for (var i = lineFrom, lineTo = lineFrom + lineCount; i < lineTo; i++) {
                var lineNo = i - 1;
                if (lineNo === lineRemovedFrom) {
                    // modified
                    var o = removed.pop();
                    o.type = "modified";
                    modified.push(o);
                    isModifiedMark = o;
                } else {
                    var mark = {
                        type: isModifiedMark ? "modified" : "added",
                        line: lineNo,
                        parentMark: isModifiedMark || firstAddedMark || null
                    };
                    if (!isModifiedMark && !firstAddedMark) {
                        firstAddedMark = mark;
                    }
                    // added new
                    added.push(mark);
                }
            }
        });

        // fix displaying of removed lines
        removed.forEach(function (o) {
            o.line = o.line + 1;
        });

        showGutters(editor, [].concat(added, removed, modified));
    }

    function refresh() {
        if (!gitAvailable) {
            return;
        }

        if (!Preferences.get("useGitGutter")) {
            return;
        }

        var currentGitRoot = Preferences.get("currentGitRoot");

        // we get a list of editors, which need to be refreshed
        var editors = _.compact(_.map(MainViewManager.getPaneIdList(), function (paneId) {
            return getEditorFromPane(paneId);
        }));

        // we create empty gutters in all of these editors, all other editors lose their gutters
        prepareGutters(editors);

        // now we launch a diff to fill the gutters in our editors
        editors.forEach(function (editor) {

            var currentFilePath = null;

            if (editor.document && editor.document.file) {
                currentFilePath = editor.document.file.fullPath;
            }

            if (currentFilePath.indexOf(currentGitRoot) !== 0) {
                // file is not in the current project
                return;
            }

            var filename = currentFilePath.substring(currentGitRoot.length);

            Git.diffFile(filename).then(function (diff) {
                processDiffResults(editor, diff);
            }).catch(function (err) {
                // if this is launched in a non-git repository, just ignore
                if (ErrorHandler.contains(err, "Not a git repository")) {
                    return;
                }
                // if this file was moved or deleted before this command could be executed, ignore
                if (ErrorHandler.contains(err, "No such file or directory")) {
                    return;
                }
                ErrorHandler.showError(err, Strings.ERROR_REFRESH_GUTTER);
            });

        });
    }

    function goToPrev() {
        var activeEditor = EditorManager.getActiveEditor();
        if (!activeEditor) { return; }

        var results = activeEditor._codeMirror.gitGutters || [];
        var searched = _.filter(results, function (i) { return !i.parentMark; });

        var currentPos = activeEditor.getCursorPos();
        var i = searched.length;
        while (i--) {
            if (searched[i].line < currentPos.line) {
                break;
            }
        }
        if (i > -1) {
            var goToMark = searched[i];
            activeEditor.setCursorPos(goToMark.line, currentPos.ch);
        }
    }

    function goToNext() {
        var activeEditor = EditorManager.getActiveEditor();
        if (!activeEditor) { return; }

        var results = activeEditor._codeMirror.gitGutters || [];
        var searched = _.filter(results, function (i) { return !i.parentMark; });

        var currentPos = activeEditor.getCursorPos();
        for (var i = 0, l = searched.length; i < l; i++) {
            if (searched[i].line > currentPos.line) {
                break;
            }
        }
        if (i < searched.length) {
            var goToMark = searched[i];
            activeEditor.setCursorPos(goToMark.line, currentPos.ch);
        }
    }

    // Event handlers
    EventEmitter.on(Events.GIT_ENABLED, function () {
        gitAvailable = true;
        refresh();
    });
    EventEmitter.on(Events.GIT_DISABLED, function () {
        gitAvailable = false;
        // calling this with an empty array will remove gutters from all editor instances
        prepareGutters([]);
    });
    EventEmitter.on(Events.BRACKETS_CURRENT_DOCUMENT_CHANGE, function (file) {
        // file will be null when switching to an empty pane
        if (!file) { return; }

        // document change gets launched even when switching panes,
        // so we check if the file hasn't already got the gutters
        var alreadyOpened = _.filter(editorsWithGutters, function (editor) {
            return editor.document.file.fullPath === file.fullPath;
        }).length > 0;

        if (!alreadyOpened) {
            // TODO: here we could sent a particular file to be refreshed only
            refresh();
        }
    });
    EventEmitter.on(Events.GIT_COMMITED, function () {
        refresh();
    });
    EventEmitter.on(Events.BRACKETS_FILE_CHANGED, function (file) {
        var alreadyOpened = _.filter(editorsWithGutters, function (editor) {
            return editor.document.file.fullPath === file.fullPath;
        }).length > 0;

        if (alreadyOpened) {
            // TODO: here we could sent a particular file to be refreshed only
            refresh();
        }
    });

    function init() {
        const editor = EditorManager.getActiveEditor();
        if(!editor){
            return;
        }
        editor.off("cursorActivity.gitGutter");
        editor.on("cursorActivity.gitGutter", _cursorActivity);
        _cursorActivity(null, editor);
    }

    // API
    exports.init = init;
    exports.goToPrev = goToPrev;
    exports.goToNext = goToNext;
});

define("src/History", function (require) {

    // Brackets modules
    var _ = brackets.getModule("thirdparty/lodash"),
        DocumentManager = brackets.getModule("document/DocumentManager"),
        FileUtils = brackets.getModule("file/FileUtils"),
        LocalizationUtils = brackets.getModule("utils/LocalizationUtils"),
        Strings = brackets.getModule("strings"),
        Metrics = brackets.getModule("utils/Metrics"),
        Mustache = brackets.getModule("thirdparty/mustache/mustache");

    // Local modules
    const ErrorHandler = require("src/ErrorHandler"),
        Events = require("src/Events"),
        EventEmitter = require("src/EventEmitter"),
        Git = require("src/git/Git"),
        HistoryViewer = require("src/HistoryViewer"),
        Preferences = require("src/Preferences");

    // Templates
    var gitPanelHistoryTemplate = `<table id="git-history-list" class="bottom-panel-table table table-striped table-condensed row-highlight">
    <tbody>
        {{> commits}}
    </tbody>
</table>
`,
        gitPanelHistoryCommitsTemplate = `{{#commits}}
<tr class="history-commit" x-hash="{{hash}}">
    <td>
        <div class="commit-author-avatar">
            <span style="{{cssAvatar}}">{{avatarLetter}}</span>
        </div>
    </td>
    <td><span title="{{date.title}}">{{date.shown}}</span> {{Strings.HISTORY_COMMIT_BY}} <span class="commit-author">{{author}}</span></td>
    <td class="commit-title"><span class="commit-subject">{{subject}} </span>{{#hasTag}}<span class="commit-tags" title="{{tags}}"><i class="octicon octicon-tag"></i>{{tags}}</span>{{/hasTag}}</td>
    <td>{{hashShort}}</td>
</tr>
{{/commits}}
`;

    // Module variables
    let $gitPanel         = $(null),
        $tableContainer   = $(null),
        $historyList      = $(null),
        commitCache       = [],
        lastDocumentSeen  = null;

    // Implementation

    function initVariables() {
        $gitPanel = $("#git-panel");
        $tableContainer = $gitPanel.find(".table-container");
        attachHandlers();
    }

    function attachHandlers() {
        $tableContainer
            .off(".history")
            .on("scroll.history", function () {
                loadMoreHistory();
            })
            .on("click.history", ".history-commit", function () {
                const $tr = $(this);
                var hash = $tr.attr("x-hash");
                var commit = _.find(commitCache, function (commit) { return commit.hash === hash; });
                const historyShown = HistoryViewer.toggle(commit, getCurrentDocument(), {
                    isInitial: $(this).attr("x-initial-commit") === "true"
                });
                $tr.parent().find("tr.selected").removeClass("selected");
                if(historyShown){
                    $tr.addClass("selected");
                }
            });
    }

    var generateCssAvatar = _.memoize(function (author, email) {

        // Original source: http://indiegamr.com/generate-repeatable-random-numbers-in-js/
        var seededRandom = function (max, min, seed) {
            max = max || 1;
            min = min || 0;

            seed = (seed * 9301 + 49297) % 233280;
            var rnd = seed / 233280.0;

            return min + rnd * (max - min);
        };

        // Use `seededRandom()` to generate a pseudo-random number [0-16] to pick a color from the list
        var seedBase = parseInt(author.charCodeAt(3).toString(), email.length),
            seed = parseInt(email.charCodeAt(seedBase.toString().substring(1, 2)).toString(), 16),
            colors = [
                "#ffb13b", "#dd5f7a", "#8dd43a", "#2f7e2f", "#4141b9", "#3dafea", "#7e3e3e", "#f2f26b",
                "#864ba3", "#ac8aef", "#f2f2ce", "#379d9d", "#ff6750", "#8691a2", "#d2fd8d", "#88eadf"
            ],
            texts = [
                "#FEFEFE", "#FEFEFE", "#FEFEFE", "#FEFEFE", "#FEFEFE", "#FEFEFE", "#FEFEFE", "#333333",
                "#FEFEFE", "#FEFEFE", "#333333", "#FEFEFE", "#FEFEFE", "#FEFEFE", "#333333", "#333333"
            ],
            picked = Math.floor(seededRandom(0, 16, seed));

        return "background-color: " + colors[picked] + "; color: " + texts[picked];

    }, function (author, email) {
        // calculate hash for memoize - both are strings so we don't need to convert
        return author + email;
    });

    // Render history list the first time
    function renderHistory(file) {
        // clear cache
        commitCache = [];

        return Git.getCurrentBranchName().then(function (branchName) {
            // Get the history commits of the current branch
            var p = file ? Git.getFileHistory(file.relative, branchName) : Git.getHistory(branchName);
            return p.then(function (commits) {

                // calculate some missing stuff like avatars
                commits = addAdditionalCommitInfo(commits);
                commitCache = commitCache.concat(commits);

                var templateData = {
                    commits: commits,
                    Strings: Strings
                };

                $tableContainer.append(Mustache.render(gitPanelHistoryTemplate, templateData, {
                    commits: gitPanelHistoryCommitsTemplate
                }));

                $historyList = $tableContainer.find("#git-history-list")
                    .data("file", file ? file.absolute : null)
                    .data("file-relative", file ? file.relative : null);

                $historyList
                    .find("tr.history-commit:last-child")
                    .attr("x-initial-commit", "true");
            });
        }).catch(function (err) {
            ErrorHandler.showError(err, Strings.ERROR_GET_HISTORY);
        });
    }

    // Load more rows in the history list on scroll
    function loadMoreHistory() {
        if ($historyList.is(":visible")) {
            if (($tableContainer.prop("scrollHeight") - $tableContainer.scrollTop()) === $tableContainer.height()) {
                if ($historyList.attr("x-finished") === "true") {
                    return;
                }
                return Git.getCurrentBranchName().then(function (branchName) {
                    var p,
                        file = $historyList.data("file-relative"),
                        skipCount = $tableContainer.find("tr.history-commit").length;
                    if (file) {
                        p = Git.getFileHistory(file, branchName, skipCount);
                    } else {
                        p = Git.getHistory(branchName, skipCount);
                    }
                    return p.then(function (commits) {
                        if (commits.length === 0) {
                            $historyList.attr("x-finished", "true");
                            // marks initial commit as first
                            $historyList
                                .find("tr.history-commit:last-child")
                                .attr("x-initial-commit", "true");
                            return;
                        }

                        commits = addAdditionalCommitInfo(commits);
                        commitCache = commitCache.concat(commits);

                        var templateData = {
                            commits: commits,
                            Strings: Strings
                        };
                        var commitsHtml = Mustache.render(gitPanelHistoryCommitsTemplate, templateData);
                        $historyList.children("tbody").append(commitsHtml);
                    })
                    .catch(function (err) {
                        ErrorHandler.showError(err, Strings.ERROR_GET_MORE_HISTORY);
                    });
                })
                .catch(function (err) {
                    ErrorHandler.showError(err, Strings.ERROR_GET_CURRENT_BRANCH);
                });
            }
        }
    }

    function addAdditionalCommitInfo(commits) {
        _.forEach(commits, function (commit) {

            commit.cssAvatar = generateCssAvatar(commit.author, commit.email);
            commit.avatarLetter = commit.author.substring(0, 1);

            const dateTime = new Date(commit.date);
            if (isNaN(dateTime.getTime())) {
                // we got invalid date, use the original date itself
                commit.date = {
                    title: commit.date,
                    shown: commit.date
                };
            } else {
                commit.date = {
                    title: LocalizationUtils.getFormattedDateTime(dateTime),
                    shown: LocalizationUtils.dateTimeFromNowFriendly(dateTime)
                };
            }
            commit.hasTag = !!commit.tags;
        });

        return commits;
    }

    function getCurrentDocument() {
        if (HistoryViewer.isVisible()) {
            return lastDocumentSeen;
        }
        var doc = DocumentManager.getCurrentDocument();
        if (doc) {
            lastDocumentSeen = doc;
        }
        return doc || lastDocumentSeen;
    }

    function handleFileChange() {
        var currentDocument = getCurrentDocument();

        if ($historyList.is(":visible") && $historyList.data("file")) {
            handleToggleHistory("FILE", currentDocument);
        }
        $gitPanel.find(".git-file-history").prop("disabled", !currentDocument);
    }

    // Show or hide the history list on click of .history button
    // newHistoryMode can be "FILE", "GLOBAL" or "REFRESH"
    function handleToggleHistory(newHistoryMode, newDocument) {
        // this is here to check that $historyList is still attached to the DOM
        $historyList = $tableContainer.find("#git-history-list");

        let historyEnabled = $historyList.is(":visible"),
            currentFile = $historyList.data("file") || null,
            currentHistoryMode = historyEnabled ? (currentFile ? "FILE" : "GLOBAL") : "DISABLED",
            doc = newDocument ? newDocument : getCurrentDocument(),
            file;

        // Variables to store scroll positions (only used for REFRESH case)
        let savedScrollTop, savedScrollLeft, selectedCommitHash;
        let isRefresh = false;
        if(newHistoryMode === "REFRESH"){
            newHistoryMode = currentHistoryMode;
            isRefresh = true;
            historyEnabled = true;
            // Save current scroll positions before removing the list
            if ($historyList.length > 0) {
                savedScrollTop = $historyList.parent().scrollTop();
                savedScrollLeft = $historyList.parent().scrollLeft();
                selectedCommitHash = $historyList.find(".selected").attr("x-hash");
            }
        } else if (currentHistoryMode !== newHistoryMode) {
            // we are switching the modes so enable
            historyEnabled = true;
        } else if (!newDocument) {
            // we are not changing the mode and we are not switching to a new document
            historyEnabled = !historyEnabled;
        }

        if (historyEnabled && newHistoryMode === "FILE") {
            if (doc) {
                file = {};
                file.absolute = doc.file.fullPath;
                file.relative = FileUtils.getRelativeFilename(Preferences.get("currentGitRoot"), file.absolute);
            } else {
                // we want a file history but no file was found
                historyEnabled = false;
            }
        }

        // Render #git-history-list if is not already generated or if the viewed file for file history has changed
        var isEmpty = $historyList.find("tr").length === 0,
            fileChanged = currentFile !== (file ? file.absolute : null);
        if (historyEnabled && (isEmpty || fileChanged || isRefresh)) {
            if ($historyList.length > 0) {
                $historyList.remove();
            }
            var $spinner = $("<div class='spinner spin large'></div>").appendTo($gitPanel);
            renderHistory(file).finally(function () {
                $spinner.remove();
                if (isRefresh) {
                    // After rendering, we need to fetch the newly created #git-history-list
                    let $newHistoryList = $tableContainer.find("#git-history-list");
                    // Restore the scroll position
                    $newHistoryList.parent().scrollTop(savedScrollTop || 0);
                    $newHistoryList.parent().scrollLeft(savedScrollLeft || 0);
                    $historyList.find(`[x-hash="${selectedCommitHash}"]`).addClass("selected");
                }
            });
        }

        // disable commit button when viewing history
        // refresh status when history is closed and commit button will correct its disabled state if required
        if (historyEnabled) {
            $gitPanel.find(".git-commit, .check-all").prop("disabled", true);
        } else {
            Git.status();
        }

        // Toggle visibility of .git-edited-list and #git-history-list
        $tableContainer.find(".git-edited-list").toggle(!historyEnabled);
        $historyList.toggle(historyEnabled);

        if (!historyEnabled) { HistoryViewer.hide(); }

        // Toggle history button
        var globalButtonActive  = historyEnabled && newHistoryMode === "GLOBAL",
            fileButtonActive    = historyEnabled && newHistoryMode === "FILE";
        $gitPanel.find(".git-history-toggle").toggleClass("active", globalButtonActive)
            .attr("title", globalButtonActive ? Strings.TOOLTIP_HIDE_HISTORY : Strings.TOOLTIP_SHOW_HISTORY);
        $gitPanel.find(".git-file-history").toggleClass("active", fileButtonActive)
            .attr("title", fileButtonActive ? Strings.TOOLTIP_HIDE_FILE_HISTORY : Strings.TOOLTIP_SHOW_FILE_HISTORY);
    }

    // Event listeners
    EventEmitter.on(Events.GIT_ENABLED, function () {
        initVariables();
    });
    EventEmitter.on(Events.GIT_DISABLED, function () {
        lastDocumentSeen = null;
        $historyList.remove();
        $historyList = $();
    });
    EventEmitter.on(Events.HISTORY_SHOW_FILE, function () {
        handleToggleHistory("FILE");
        Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'panel', "fileHistory");
    });
    EventEmitter.on(Events.HISTORY_SHOW_GLOBAL, function () {
        handleToggleHistory("GLOBAL");
        Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'panel', "history");
    });
    EventEmitter.on(Events.REFRESH_HISTORY, function () {
        handleToggleHistory("REFRESH");
    });
    EventEmitter.on(Events.BRACKETS_CURRENT_DOCUMENT_CHANGE, function () {
        handleFileChange();
    });

});

define("src/HistoryViewer", function (require, exports) {

    const _             = brackets.getModule("thirdparty/lodash"),
        LanguageManager = brackets.getModule("language/LanguageManager"),
        Mustache        = brackets.getModule("thirdparty/mustache/mustache"),
        WorkspaceManager  = brackets.getModule("view/WorkspaceManager"),
        Strings           = brackets.getModule("strings"),
        Metrics         = brackets.getModule("utils/Metrics"),
        marked          = brackets.getModule('thirdparty/marked.min').marked;

    const ErrorHandler  = require("src/ErrorHandler"),
        Git           = require("src/git/Git"),
        Preferences   = require("src/Preferences"),
        Utils         = require("src/Utils");

    var historyViewerTemplate       = `<div id="history-viewer">
    <div class="header">
        <div>
            <a href="#" class="close">&times;</a>
        </div>
        <div class="author-line">
            <span class="commit-author">
                <div class="commit-author-avatar">
                    <span class="text" style="{{commit.cssAvatar}}">{{commit.avatarLetter}}</span>
                </div>
                <span class="commit-author-name">{{commit.author}}</span>
                <span class="commit-author-email">&lt;{{commit.email}}&gt;</span>
            </span>
            <span class="commit-time" title="{{commit.date.title}}">
                <i class="octicon octicon-calendar"></i>&nbsp;
                <span class="selectable-text">{{commit.date.shown}}</span>
            </span>
            <span class="commit-hash" data-hash="{{commit.hash}}">
                <i class="octicon octicon-git-commit"></i>&nbsp;<span class="selectable-text">{{commit.hashShort}}</span>
                <a href="#" class="git-extend-sha">&hellip;</a>
            </span>
            <div class="actions">
                <span class="toggle-diffs">
                    <i class="octicon octicon-expand collapse"></i>
                    <i class="octicon octicon-collapse expand"></i>
                    <span class="expand">{{Strings.EXPAND_ALL}}</span>
                    <span class="collapse">{{Strings.COLLAPSE_ALL}}</span>
                </span>
            </div>
        </div>
        <div>
            <h1 class="commit-title selectable-text"><span>{{commit.subject}}</span></h1>
        </div>
    </div>
    <div class="body">
        <div class="commitBody selectable-text">{{{bodyMarkdown}}}</div>
        <div class="table-striped tab-content">
            <div class="commit-files">
                <ul class="nav nav-tabs nav-stacked filesContainer"></ul>
                <button class="btn loadMore">
                    Load more files from this commit
                </button>
            </div>
        </div>
    </div>
</div>
`,
        historyViewerFilesTemplate  = `{{#files}}
    <li x-file="{{file}}">
        <a>
            <i class="caret caret-right closed"></i>
            <i class="caret opened"></i>
            {{name}}<span class="extension">{{extension}}</span>
            <i class="octicon octicon-eye openFile" title="{{Strings.VIEW_THIS_FILE}}"></i>
            {{#useDifftool}}<i class="octicon octicon-diff difftool" title="{{Strings.DIFFTOOL}}"></i>{{/useDifftool}}
        </a>
        <div class="commit-diff"></div>
    </li>
{{/files}}
`;

    let useDifftool            = false,
        isShown                = false,
        commit                 = null,
        currentlyViewedCommit  = null,
        isInitial              = null,
        $viewer                = null,
        $editorHolder          = null;

    var setExpandState = _.debounce(function () {
        var allFiles = $viewer.find(".commit-files a"),
            activeFiles = allFiles.filter(".active"),
            allExpanded = allFiles.length === activeFiles.length;
        $viewer.find(".toggle-diffs").toggleClass("opened", allExpanded);
    }, 100);

    var PAGE_SIZE = 25;
    var currentPage = 0;
    var hasNextPage = false;

    function toggleDiff($a) {
        if ($a.hasClass("active")) {
            // Close the clicked diff
            $a.removeClass("active");
            setExpandState();
            return;
        }

        // Open the clicked diff
        $(".commit-files a.active").attr("scrollPos", $(".commit-diff").scrollTop());

        // If this diff was not previously loaded then load it
        if (!$a.is(".loaded")) {
            var $li = $a.closest("[x-file]"),
                relativeFilePath = $li.attr("x-file"),
                $diffContainer = $li.find(".commit-diff");

            Git.getDiffOfFileFromCommit(commit.hash, relativeFilePath, isInitial).then(function (diff) {
                $diffContainer.html(Utils.formatDiff(diff));
                $diffContainer.scrollTop($a.attr("scrollPos") || 0);

                $a.addClass("active loaded");
                setExpandState();
            }).catch(function (err) {
                ErrorHandler.showError(err, Strings.ERROR_GET_DIFF_FILE_COMMIT);
            });
        } else {
            // If this diff was previously loaded just open it
            $a.addClass("active");
            setExpandState();
        }
    }

    function showDiff($el) {
        var file = $el.closest("[x-file]").attr("x-file");
        Git.difftoolFromHash(commit.hash, file, isInitial);
    }

    function expandAll() {
        $viewer.find(".commit-files a").not(".active").trigger("click");
        Preferences.set("autoExpandDiffsInHistory", true);
    }

    function collapseAll() {
        $viewer.find(".commit-files a").filter(".active").trigger("click");
        Preferences.set("autoExpandDiffsInHistory", false);
    }

    function attachEvents() {
        $viewer
            .on("click", ".commit-files a", function () {
                toggleDiff($(this));
            })
            .on("click", ".commit-files .difftool", function (e) {
                e.stopPropagation();
                showDiff($(this));
            })
            .on("click", ".openFile", function (e) {
                e.stopPropagation();
                var file = $(this).closest("[x-file]").attr("x-file");
                Utils.openEditorForFile(file, true);
                hide();
            })
            .on("click", ".close", function () {
                // Close history viewer
                remove();
            })
            .on("click", ".git-extend-sha", function () {
                // Show complete commit SHA
                var $parent = $(this).parent(),
                    sha = $parent.data("hash");
                $parent.find("span.selectable-text").text(sha);
                $(this).remove();
            })
            .on("click", ".toggle-diffs", expandAll)
            .on("click", ".toggle-diffs.opened", collapseAll);

        // Add/Remove shadow on bottom of header
        $viewer.find(".body")
            .on("scroll", function () {
                if ($viewer.find(".body").scrollTop() > 0) {
                    $viewer.find(".header").addClass("shadow");
                } else {
                    $viewer.find(".header").removeClass("shadow");
                }
            });

        // Expand the diffs when wanted
        if (Preferences.get("autoExpandDiffsInHistory")) {
            expandAll();
        }
    }

    function renderViewerContent(files, selectedFile) {
        var bodyMarkdown = marked(commit.body, { gfm: true, breaks: true });

        $viewer.html(Mustache.render(historyViewerTemplate, {
            commit: commit,
            bodyMarkdown: bodyMarkdown,
            Strings: Strings
        }));

        renderFiles(files);

        if (selectedFile) {
            var $fileEntry = $viewer.find(".commit-files li[x-file='" + selectedFile + "'] a").first();
            if ($fileEntry.length) {
                toggleDiff($fileEntry);
                window.setTimeout(function () {
                    $viewer.find(".body").animate({ scrollTop: $fileEntry.position().top - 10 });
                }, 80);
            }
        }

        attachEvents();
    }

    function renderFiles(files) {
        $viewer.find(".filesContainer").append(Mustache.render(historyViewerFilesTemplate, {
            files: files,
            Strings: Strings,
            useDifftool: useDifftool
        }));

        // Activate/Deactivate load more button
        $viewer.find(".loadMore")
            .toggle(hasNextPage)
            .off("click")
            .on("click", function () {
                currentPage++;
                loadMoreFiles();
            });
    }

    function loadMoreFiles() {
        Git.getFilesFromCommit(commit.hash, isInitial).then(function (files) {

            hasNextPage = files.slice((currentPage + 1) * PAGE_SIZE).length > 0;
            files = files.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

            var list = files.map(function (file) {
                var fileExtension = LanguageManager.getCompoundFileExtension(file),
                    i = file.lastIndexOf("." + fileExtension),
                    fileName = file.substring(0, fileExtension && i >= 0 ? i : file.length);
                return {
                    name: fileName,
                    extension: fileExtension ? "." + fileExtension : "",
                    file: file
                };
            });

            if (currentPage === 0) {
                var file = $("#git-history-list").data("file-relative");
                return renderViewerContent(list, file);
            } else {
                return renderFiles(list);
            }
        }).catch(function (err) {
            ErrorHandler.showError(err, Strings.ERROR_GET_DIFF_FILES);
        }).finally(function () {
            $viewer.removeClass("spinner large spin");
        });
    }

    function render() {
        if ($viewer) {
            // Reset the viewer listeners
            $viewer.off("click");
            $viewer.find(".body").off("scroll");
        } else {
            // Create the viewer if it doesn't exist
            $viewer = $("<div>").addClass("git spinner large spin");
            $viewer.appendTo($editorHolder);
        }

        currentPage = 0;
        loadMoreFiles();
    }

    var initialize = _.once(function () {
        Git.getConfig("diff.tool").then(function (config) {
            useDifftool = !!config;
        });
    });

    function toggle(commitInfo, doc, options) {
        const commitHash = commitInfo.hash;
        if(isShown && commitHash === currentlyViewedCommit) {
            // the history view already showing the current commit, the user intent is to close
            remove();
            return false;
        }
        // a new history is to be shown
        show(commitInfo, doc, options);
        return true;
    }

    function show(commitInfo, doc, options) {
        Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'history', "detailView");
        initialize();

        commit    = commitInfo;
        isInitial = options.isInitial;

        $editorHolder = $("#editor-holder");
        render();
        currentlyViewedCommit = commitInfo.hash;
        isShown   = true;
        if ($("#first-pane").length) {
            const firstPaneStyle =
                $("#first-pane").prop("style") && $("#first-pane").prop("style").cssText ?
                    $("#first-pane").prop("style").cssText : "";
            $("#first-pane").prop("style", firstPaneStyle + ";display: none !important;");
        }

        if ($("#second-pane").length) {
            const secondPaneStyle =
                $("#second-pane").prop("style") && $("#second-pane").prop("style").cssText ?
                    $("#second-pane").prop("style").cssText : "";
            $("#second-pane").prop("style", secondPaneStyle + ";display: none !important;");
        }
    }

    function onRemove() {
        isShown = false;
        $viewer = null;
        currentlyViewedCommit = null;
        $("#first-pane").show();
        $("#second-pane").show();
        // we need to relayout as when the history overlay is visible over the editor, we
        // hide the editor with css, and if we resize app while history view is open, the editor wont
        // be resized. So we relayout on panel close.
        WorkspaceManager.recomputeLayout();
        // detach events that were added by this viewer to another element than one added to $editorHolder
    }

    function hide() {
        if (isShown) {
            remove();
        }
    }

    function remove() {
        $viewer.remove();
        onRemove();
    }

    function isVisible() {
        return isShown;
    }

    // Public API
    exports.toggle = toggle;
    exports.show = show;
    exports.hide = hide;
    exports.isVisible = isVisible;

});

define("src/Main", function (require, exports) {

    const _               = brackets.getModule("thirdparty/lodash"),
        CommandManager    = brackets.getModule("command/CommandManager"),
        Commands          = brackets.getModule("command/Commands"),
        Menus             = brackets.getModule("command/Menus"),
        FileSystem        = brackets.getModule("filesystem/FileSystem"),
        Mustache          = brackets.getModule("thirdparty/mustache/mustache"),
        Metrics           = brackets.getModule("utils/Metrics"),
        ProjectManager    = brackets.getModule("project/ProjectManager");

    const Constants       = require("src/Constants"),
        Events            = require("src/Events"),
        EventEmitter      = require("src/EventEmitter"),
        Strings             = brackets.getModule("strings"),
        StringUtils             = brackets.getModule("utils/StringUtils"),
        ErrorHandler      = require("src/ErrorHandler"),
        Panel             = require("src/Panel"),
        Branch            = require("src/Branch"),
        SettingsDialog    = require("src/SettingsDialog"),
        Dialogs                 = brackets.getModule("widgets/Dialogs"),
        CloseNotModified  = require("src/CloseNotModified"),
        Setup             = require("src/utils/Setup"),
        Preferences       = require("src/Preferences"),
        Utils             = require("src/Utils"),
        Git               = require("src/git/Git"),
        gitTagDialogTemplate    = `<div id="git-commit-dialog" class="modal">
    <div class="modal-header">
        <h1 class="dialog-title">{{Strings.TAG_NAME}}</h1>
    </div>
    <div class="modal-body table-striped tab-content">
        <div class="commit-message-box">
            <input name="commit-message" class="commit-message" type="text" placeholder="{{Strings.TAG_NAME_PLACEHOLDER}}" autocomplete="off"/>
            <textarea name="commit-message" type="text" placeholder="{{Strings.TAG_NAME_PLACEHOLDER}}" autocomplete="off" style="display: none;"></textarea>
        </div>
    </div>
    <div class="modal-footer">
        <button data-button-id="cancel" class="dialog-button btn cancel btn-80" >{{Strings.BUTTON_CANCEL}}</button>
        <button data-button-id="ok"     class="dialog-button btn primary btn-80">{{Strings.BUTTON_OK}}</button>
    </div>
</div>
`;

    const CMD_ADD_TO_IGNORE      = "git.addToIgnore",
        CMD_REMOVE_FROM_IGNORE = "git.removeFromIgnore",
        $icon                  = $(`<a id='git-toolbar-icon' title="${Strings.STATUSBAR_SHOW_GIT}" href='#'></a>`)
                                    .addClass("forced-hidden")
                                    .prependTo($(".bottom-buttons"));

    let gitEnabled = false;

    EventEmitter.on(Events.GIT_DISABLED, function () {
        $icon.removeClass("dirty");
    });

    EventEmitter.on(Events.GIT_STATUS_RESULTS, function (sortedResults) {
        $icon.toggleClass("dirty", sortedResults.length !== 0);
    });

    // This only launches when Git is available
    function initUi() {
        // FUTURE: do we really need to launch init from here?
        Panel.init();
        Branch.init();
        CloseNotModified.init();
        // Attach events
        $icon.on("click", Panel.toggle);
    }

    function _addRemoveItemInGitignore(selectedEntry, method) {
        var gitRoot = Preferences.get("currentGitRoot"),
            entryPath = "/" + selectedEntry.fullPath.substring(gitRoot.length),
            gitignoreEntry = FileSystem.getFileForPath(gitRoot + ".gitignore");

        gitignoreEntry.read(function (err, content) {
            if (err) {
                Utils.consoleWarn(err);
                content = "";
            }

            // use trimmed lines only
            var lines = content.split("\n").map(function (l) { return l.trim(); });
            // clean start and end empty lines
            while (lines.length > 0 && !lines[0]) { lines.shift(); }
            while (lines.length > 0 && !lines[lines.length - 1]) { lines.pop(); }

            if (method === "add") {
                // add only when not already present
                if (lines.indexOf(entryPath) === -1) { lines.push(entryPath); }
            } else if (method === "remove") {
                lines = _.without(lines, entryPath);
            }

            // always have an empty line at the end of the file
            if (lines[lines.length - 1]) { lines.push(""); }

            gitignoreEntry.write(lines.join("\n"), function (err) {
                if (err) {
                    return ErrorHandler.showError(err, Strings.ERROR_MODIFY_GITIGNORE);
                }
                Panel.refresh();
            });
        });
    }

    function addItemToGitingore() {
        return _addRemoveItemInGitignore(ProjectManager.getSelectedItem(), "add");
    }

    function removeItemFromGitingore() {
        return _addRemoveItemInGitignore(ProjectManager.getSelectedItem(), "remove");
    }

    function addItemToGitingoreFromPanel() {
        var filePath = Panel.getPanel().find("tr.selected").attr("x-file"),
            fileEntry = FileSystem.getFileForPath(Preferences.get("currentGitRoot") + filePath);
        return _addRemoveItemInGitignore(fileEntry, "add");
    }

    function removeItemFromGitingoreFromPanel() {
        var filePath = Panel.getPanel().find("tr.selected").attr("x-file"),
            fileEntry = FileSystem.getFileForPath(Preferences.get("currentGitRoot") + filePath);
        return _addRemoveItemInGitignore(fileEntry, "remove");
    }

    function _refreshCallback() {
        EventEmitter.emit(Events.REFRESH_ALL);
    }

    function checkoutCommit(commitHash) {
        const commitDetail = Panel.getSelectedHistoryCommit() || {};
        commitHash = commitHash || commitDetail.hash;
        const commitDetailStr = commitDetail.subject || "";
        if(!commitHash){
            console.error(`Cannot do Git checkout as commit hash is ${commitHash}`);
            return;
        }
        const displayStr = StringUtils.format(Strings.CHECKOUT_COMMIT_DETAIL, commitDetailStr, commitHash);
        Utils.askQuestion(Strings.TITLE_CHECKOUT,
            displayStr + "<br><br>" + Strings.DIALOG_CHECKOUT,
            { booleanResponse: true, noescape: true, customOkBtn: Strings.CHECKOUT_COMMIT })
            .then(function (response) {
                if (response === true) {
                    return Git.checkout(commitHash).then(_refreshCallback);
                }
            });
    }

    function tagCommit(commitHash) {
        const commitDetail = Panel.getSelectedHistoryCommit() || {};
        commitHash = commitHash || commitDetail.hash || "";
        const compiledTemplate = Mustache.render(gitTagDialogTemplate, { Strings }),
            dialog           = Dialogs.showModalDialogUsingTemplate(compiledTemplate),
            $dialog          = dialog.getElement();
        $dialog.find("input").focus();
        $dialog.find("button.primary").on("click", function () {
            const tagname = $dialog.find("input.commit-message").val();
            Git.setTagName(tagname, commitHash).then(function () {
                EventEmitter.emit(Events.REFRESH_HISTORY);
            }).catch(function (err) {
                ErrorHandler.showError(err, Strings.ERROR_CREATE_TAG);
            });
        });
    }

    function _resetOperation(operation, commitHash, title, message) {
        const commitDetail = Panel.getSelectedHistoryCommit() || {};
        commitHash = commitHash || commitDetail.hash;
        const commitDetailStr = commitDetail.subject || "";
        if(!commitHash){
            console.error(`Cannot do Git Reset ${operation} as commit hash is ${commitHash}`);
            return;
        }
        const gitCmdUsed = `git reset ${operation} ${commitHash}`;
        const displayStr = StringUtils.format(Strings.RESET_DETAIL, commitDetailStr, gitCmdUsed);
        Utils.askQuestion(title,
            message + "<br><br>" + displayStr,
            { booleanResponse: true, noescape: true ,
                customOkBtn: Strings.RESET, customOkBtnClass: "danger"})
            .then(function (response) {
                if (response === true) {
                    return Git.reset(operation, commitHash).then(_refreshCallback);
                }
            });
    }

    function resetHard(commitHash) {
        return _resetOperation("--hard", commitHash,
            Strings.RESET_HARD_TITLE, Strings.RESET_HARD_MESSAGE);
    }

    function resetMixed(commitHash) {
        return _resetOperation("--mixed", commitHash,
            Strings.RESET_MIXED_TITLE, Strings.RESET_MIXED_MESSAGE);
    }

    function resetSoft(commitHash) {
        return _resetOperation("--soft", commitHash,
            Strings.RESET_SOFT_TITLE, Strings.RESET_SOFT_MESSAGE);
    }

    /**
     * Disables all Git-related commands that were registered in `initGitMenu`.
     * After calling this function, none of these menu items will be clickable.
     */
    function disableAllMenus() {
        // Collect all command IDs that were registered in initGitMenu
        const commandsToDisable = [
            // File menu items
            Constants.CMD_GIT_INIT,
            Constants.CMD_GIT_CLONE,
            Constants.CMD_GIT_TOGGLE_PANEL,
            Constants.CMD_GIT_REFRESH,
            Constants.CMD_GIT_GOTO_NEXT_CHANGE,
            Constants.CMD_GIT_GOTO_PREVIOUS_CHANGE,
            Constants.CMD_GIT_CLOSE_UNMODIFIED,
            Constants.CMD_GIT_AUTHORS_OF_SELECTION,
            Constants.CMD_GIT_AUTHORS_OF_FILE,
            Constants.CMD_GIT_COMMIT_CURRENT,
            Constants.CMD_GIT_COMMIT_ALL,
            Constants.CMD_GIT_FETCH,
            Constants.CMD_GIT_PULL,
            Constants.CMD_GIT_PUSH,
            Constants.CMD_GIT_GERRIT_PUSH_REF,
            Constants.CMD_GIT_CHANGE_USERNAME,
            Constants.CMD_GIT_CHANGE_EMAIL,
            Constants.CMD_GIT_SETTINGS_COMMAND_ID,

            // Project tree/working files commands
            CMD_ADD_TO_IGNORE,
            CMD_REMOVE_FROM_IGNORE,
            // Panel context menu commands (with "2" suffix)
            CMD_ADD_TO_IGNORE + "2",
            CMD_REMOVE_FROM_IGNORE + "2",

            // History context menu commands
            Constants.CMD_GIT_CHECKOUT,
            Constants.CMD_GIT_TAG,
            Constants.CMD_GIT_RESET_HARD,
            Constants.CMD_GIT_RESET_MIXED,
            Constants.CMD_GIT_RESET_SOFT,

            // "More options" context menu commands
            Constants.CMD_GIT_DISCARD_ALL_CHANGES,
            Constants.CMD_GIT_UNDO_LAST_COMMIT,
            Constants.CMD_GIT_TOGGLE_UNTRACKED
        ];

        // Disable each command
        commandsToDisable.forEach((cmdId) => {
            Utils.enableCommand(cmdId, false);
        });
    }


    function initGitMenu() {
        // Register command and add it to the menu.
        const fileMenu = Menus.getMenu(Menus.AppMenuBar.FILE_MENU);
        let gitSubMenu = fileMenu.addSubMenu(Constants.GIT_STRING_UNIVERSAL,
            Constants.GIT_SUB_MENU, Menus.AFTER, Commands.FILE_EXTENSION_MANAGER);
        fileMenu.addMenuDivider(Menus.AFTER, Commands.FILE_EXTENSION_MANAGER);
        gitSubMenu.addMenuItem(Constants.CMD_GIT_INIT, undefined, undefined, undefined, {
            hideWhenCommandDisabled: true
        });
        gitSubMenu.addMenuItem(Constants.CMD_GIT_CLONE, undefined, undefined, undefined, {
            hideWhenCommandDisabled: true
        });
        gitSubMenu.addMenuItem(Constants.CMD_GIT_TOGGLE_PANEL);
        gitSubMenu.addMenuItem(Constants.CMD_GIT_REFRESH);
        gitSubMenu.addMenuDivider();
        gitSubMenu.addMenuItem(Constants.CMD_GIT_GOTO_NEXT_CHANGE);
        gitSubMenu.addMenuItem(Constants.CMD_GIT_GOTO_PREVIOUS_CHANGE);
        gitSubMenu.addMenuItem(Constants.CMD_GIT_CLOSE_UNMODIFIED);
        gitSubMenu.addMenuDivider();
        gitSubMenu.addMenuItem(Constants.CMD_GIT_AUTHORS_OF_SELECTION);
        gitSubMenu.addMenuItem(Constants.CMD_GIT_AUTHORS_OF_FILE);
        gitSubMenu.addMenuDivider();
        gitSubMenu.addMenuItem(Constants.CMD_GIT_COMMIT_CURRENT);
        gitSubMenu.addMenuItem(Constants.CMD_GIT_COMMIT_ALL);
        gitSubMenu.addMenuDivider();
        gitSubMenu.addMenuItem(Constants.CMD_GIT_FETCH);
        gitSubMenu.addMenuItem(Constants.CMD_GIT_PULL);
        gitSubMenu.addMenuItem(Constants.CMD_GIT_PUSH);
        gitSubMenu.addMenuDivider();
        gitSubMenu.addMenuItem(Constants.CMD_GIT_GERRIT_PUSH_REF);
        gitSubMenu.addMenuItem(Constants.CMD_GIT_CHANGE_USERNAME);
        gitSubMenu.addMenuItem(Constants.CMD_GIT_CHANGE_EMAIL);
        gitSubMenu.addMenuDivider();
        gitSubMenu.addMenuItem(Constants.CMD_GIT_SETTINGS_COMMAND_ID);

        // register commands for project tree / working files
        CommandManager.register(Strings.ADD_TO_GITIGNORE, CMD_ADD_TO_IGNORE, addItemToGitingore);
        CommandManager.register(Strings.REMOVE_FROM_GITIGNORE, CMD_REMOVE_FROM_IGNORE, removeItemFromGitingore);

        // create context menu for git panel
        const panelCmenu = Menus.registerContextMenu(Constants.GIT_PANEL_CHANGES_CMENU);
        CommandManager.register(Strings.ADD_TO_GITIGNORE, CMD_ADD_TO_IGNORE + "2", addItemToGitingoreFromPanel);
        CommandManager.register(Strings.REMOVE_FROM_GITIGNORE, CMD_REMOVE_FROM_IGNORE + "2", removeItemFromGitingoreFromPanel);
        panelCmenu.addMenuItem(CMD_ADD_TO_IGNORE + "2");
        panelCmenu.addMenuItem(CMD_REMOVE_FROM_IGNORE + "2");

        // create context menu for git history
        const historyCmenu = Menus.registerContextMenu(Constants.GIT_PANEL_HISTORY_CMENU);
        CommandManager.register(Strings.CHECKOUT_COMMIT, Constants.CMD_GIT_CHECKOUT, checkoutCommit);
        CommandManager.register(Strings.MENU_RESET_HARD, Constants.CMD_GIT_RESET_HARD, resetHard);
        CommandManager.register(Strings.MENU_RESET_MIXED, Constants.CMD_GIT_RESET_MIXED, resetMixed);
        CommandManager.register(Strings.MENU_RESET_SOFT, Constants.CMD_GIT_RESET_SOFT, resetSoft);
        CommandManager.register(Strings.MENU_TAG_COMMIT, Constants.CMD_GIT_TAG, tagCommit);
        historyCmenu.addMenuItem(Constants.CMD_GIT_CHECKOUT);
        historyCmenu.addMenuItem(Constants.CMD_GIT_TAG);
        historyCmenu.addMenuDivider();
        historyCmenu.addMenuItem(Constants.CMD_GIT_RESET_HARD);
        historyCmenu.addMenuItem(Constants.CMD_GIT_RESET_MIXED);
        historyCmenu.addMenuItem(Constants.CMD_GIT_RESET_SOFT);

        // create context menu for git more options
        const optionsCmenu = Menus.registerContextMenu(Constants.GIT_PANEL_OPTIONS_CMENU);
        Menus.ContextMenu.assignContextMenuToSelector(".git-more-options-btn", optionsCmenu);
        optionsCmenu.addMenuItem(Constants.CMD_GIT_DISCARD_ALL_CHANGES);
        optionsCmenu.addMenuItem(Constants.CMD_GIT_UNDO_LAST_COMMIT);
        optionsCmenu.addMenuDivider();
        optionsCmenu.addMenuItem(Constants.CMD_GIT_AUTHORS_OF_SELECTION);
        optionsCmenu.addMenuItem(Constants.CMD_GIT_AUTHORS_OF_FILE);
        optionsCmenu.addMenuDivider();
        optionsCmenu.addMenuItem(Constants.CMD_GIT_FETCH);
        optionsCmenu.addMenuItem(Constants.CMD_GIT_PULL);
        optionsCmenu.addMenuItem(Constants.CMD_GIT_PUSH);
        optionsCmenu.addMenuDivider();
        optionsCmenu.addMenuItem(Constants.CMD_GIT_TOGGLE_UNTRACKED);
        optionsCmenu.addMenuItem(Constants.CMD_GIT_GERRIT_PUSH_REF);
        optionsCmenu.addMenuItem(Constants.CMD_GIT_CHANGE_USERNAME);
        optionsCmenu.addMenuItem(Constants.CMD_GIT_CHANGE_EMAIL);
        optionsCmenu.addMenuDivider();
        optionsCmenu.addMenuItem(Constants.CMD_GIT_SETTINGS_COMMAND_ID);

        if(!Setup.isExtensionActivated()){
            disableAllMenus();
        }
    }

    function init() {
        CommandManager.register(Strings.GIT_SETTINGS, Constants.CMD_GIT_SETTINGS_COMMAND_ID, SettingsDialog.show);
        // Try to get Git version, if succeeds then Git works
        return Setup.init().then(function (enabled) {
            initUi();
            initGitMenu();
            return enabled;
        });
    }

    var _toggleMenuEntriesState = false,
        _divider1 = null,
        _divider2 = null;
    function toggleMenuEntries(bool) {
        if (bool === _toggleMenuEntriesState) {
            return;
        }
        var projectCmenu = Menus.getContextMenu(Menus.ContextMenuIds.PROJECT_MENU);
        var workingCmenu = Menus.getContextMenu(Menus.ContextMenuIds.WORKING_SET_CONTEXT_MENU);
        if (bool) {
            _divider1 = projectCmenu.addMenuDivider();
            _divider2 = workingCmenu.addMenuDivider();
            projectCmenu.addMenuItem(CMD_ADD_TO_IGNORE);
            workingCmenu.addMenuItem(CMD_ADD_TO_IGNORE);
            projectCmenu.addMenuItem(CMD_REMOVE_FROM_IGNORE);
            workingCmenu.addMenuItem(CMD_REMOVE_FROM_IGNORE);
        } else {
            projectCmenu.removeMenuDivider(_divider1.id);
            workingCmenu.removeMenuDivider(_divider2.id);
            projectCmenu.removeMenuItem(CMD_ADD_TO_IGNORE);
            workingCmenu.removeMenuItem(CMD_ADD_TO_IGNORE);
            projectCmenu.removeMenuItem(CMD_REMOVE_FROM_IGNORE);
            workingCmenu.removeMenuItem(CMD_REMOVE_FROM_IGNORE);
        }
        _toggleMenuEntriesState = bool;
    }

    function _enableAllCommands(enabled) {
        Utils.enableCommand(Constants.CMD_GIT_REFRESH, enabled);

        Utils.enableCommand(Constants.CMD_GIT_GOTO_NEXT_CHANGE, enabled);
        Utils.enableCommand(Constants.CMD_GIT_GOTO_PREVIOUS_CHANGE, enabled);
        Utils.enableCommand(Constants.CMD_GIT_CLOSE_UNMODIFIED, enabled);

        Utils.enableCommand(Constants.CMD_GIT_AUTHORS_OF_SELECTION, enabled);
        Utils.enableCommand(Constants.CMD_GIT_AUTHORS_OF_FILE, enabled);

        Utils.enableCommand(Constants.CMD_GIT_COMMIT_CURRENT, enabled);
        Utils.enableCommand(Constants.CMD_GIT_COMMIT_ALL, enabled);

        Utils.enableCommand(Constants.CMD_GIT_FETCH, enabled);
        Utils.enableCommand(Constants.CMD_GIT_PULL, enabled);
        Utils.enableCommand(Constants.CMD_GIT_PUSH, enabled);

        Utils.enableCommand(Constants.CMD_GIT_DISCARD_ALL_CHANGES, enabled);
        Utils.enableCommand(Constants.CMD_GIT_UNDO_LAST_COMMIT, enabled);
        toggleMenuEntries(enabled);
        if(enabled){
            $icon.removeClass("forced-hidden");
        } else if(!$("#git-panel").is(":visible")){
            $icon.addClass("forced-hidden");
        }
    }

    let lastExecutionTime = 0;
    let isCommandExecuting = false;
    const FOCUS_SWITCH_DEDUPE_TIME = 5000;
    function refreshOnFocusChange() {
        // to sync external git changes after switching to app.
        if (gitEnabled) {
            const now = Date.now();

            if (isCommandExecuting) {
                return;
            }

            if (now - lastExecutionTime > FOCUS_SWITCH_DEDUPE_TIME) {
                isCommandExecuting = true;
                lastExecutionTime = Date.now();
                Git.hasStatusChanged().then((hasChanged) => {
                    if(!hasChanged){
                        return;
                    }

                    CommandManager.execute(Constants.CMD_GIT_REFRESH).fail((err) => {
                        console.error("error refreshing on focus switch", err);
                    });
                }).finally(()=>{
                    isCommandExecuting = false;
                });
            }
        }
    }
    $(window).focus(refreshOnFocusChange);

    // Event handlers
    let projectSwitched = true;
    EventEmitter.on(Events.BRACKETS_PROJECT_CHANGE, function () {
        // pressing refresh button will raise GIT_ENABLED event and we only want one enabled metric
        // per project open.
        projectSwitched = true;
    });
    EventEmitter.on(Events.GIT_ENABLED, function () {
        _enableAllCommands(true);
        gitEnabled = true;
        projectSwitched && Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'enabled', "project");
        projectSwitched = false;
    });
    EventEmitter.on(Events.GIT_DISABLED, function () {
        _enableAllCommands(false);
        gitEnabled = false;
    });

    // API
    exports.$icon = $icon;
    exports.init = init;

});

/*globals jsPromise, fs*/
define("src/NoRepo", function (require) {

    // Brackets modules
    const FileSystem    = brackets.getModule("filesystem/FileSystem"),
        FileUtils       = brackets.getModule("file/FileUtils"),
        ProjectManager  = brackets.getModule("project/ProjectManager"),
        CommandManager  = brackets.getModule("command/CommandManager"),
        Metrics         = brackets.getModule("utils/Metrics"),
        Strings         = brackets.getModule("strings"),
        StringUtils     = brackets.getModule("utils/StringUtils");

    // Local modules
    const ErrorHandler  = require("src/ErrorHandler"),
        Events          = require("src/Events"),
        EventEmitter    = require("src/EventEmitter"),
        ExpectedError   = require("src/ExpectedError"),
        ProgressDialog  = require("src/dialogs/Progress"),
        CloneDialog     = require("src/dialogs/Clone"),
        Git             = require("src/git/Git"),
        Preferences     = require("src/Preferences"),
        Constants       = require("src/Constants"),
        Utils           = require("src/Utils");

    // Templates
    var gitignoreTemplate = `# https://git-scm.com/docs/gitignore
# https://help.github.com/articles/ignoring-files
# Example .gitignore files: https://github.com/github/gitignore
/bower_components/
/node_modules/`;

    // Module variables

    // Implementation

    function createGitIgnore() {
        var gitIgnorePath = Preferences.get("currentGitRoot") + ".gitignore";
        return Utils.pathExists(gitIgnorePath).then(function (exists) {
            if (!exists) {
                return jsPromise(
                    FileUtils.writeText(FileSystem.getFileForPath(gitIgnorePath), gitignoreTemplate));
            }
        });
    }

    function stageGitIgnore() {
        return createGitIgnore().then(function () {
            return Git.stage(".gitignore");
        });
    }

    function handleGitInit() {
        Utils.isProjectRootWritable().then(function (writable) {
            if (!writable) {
                const initPath = Phoenix.app.getDisplayPath(Utils.getProjectRoot());
                const errorStr = StringUtils.format(Strings.FOLDER_NOT_WRITABLE, initPath);
                throw new ExpectedError(errorStr);
            }
            return Git.init().catch(function (err) {
                return new Promise((resolve, reject)=>{
                    if (ErrorHandler.contains(err, "Please tell me who you are")) {
                        EventEmitter.emit(Events.GIT_CHANGE_USERNAME, function () {
                            EventEmitter.emit(Events.GIT_CHANGE_EMAIL, function () {
                                Git.init().then(function (result) {
                                    resolve(result);
                                }).catch(function (error) {
                                    reject(error);
                                });
                            });
                        });
                        return;
                    }

                    reject(err);
                });
            });
        }).then(function () {
            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'init', "success");
            return stageGitIgnore("Initial staging");
        }).catch(function (err) {
            ErrorHandler.showError(err, Strings.INIT_NEW_REPO_FAILED, {dontStripError: true});
            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'init', "fail");
        }).then(function () {
            EventEmitter.emit(Events.REFRESH_ALL);
        });
    }

    // This checks if the project root is empty (to let Git clone repositories)
    function isProjectRootEmpty() {
        return new Promise(function (resolve, reject) {
            ProjectManager.getProjectRoot().getContents(function (err, entries) {
                if (err) {
                    return reject(err);
                }
                resolve(entries.length === 0);
            });
        });
    }

    function handleGitClone(gitCloneURL, destPath) {
        var $gitPanel = $("#git-panel");
        var $cloneButton = $gitPanel.find(".git-clone");
        $cloneButton.prop("disabled", true);
        isProjectRootEmpty().then(function (isEmpty) {
            if (!isEmpty) {
                const clonePath = Phoenix.app.getDisplayPath(Utils.getProjectRoot());
                const err = new ExpectedError(
                    StringUtils.format(Strings.GIT_CLONE_ERROR_EXPLAIN, clonePath));
                ErrorHandler.showError(err, Strings.GIT_CLONE_REMOTE_FAILED, {dontStripError: true});
                return;
            }
            function _clone(cloneConfig) {
                var q = Promise.resolve();
                // put username and password into remote url
                var remoteUrl = cloneConfig.remoteUrl;
                if (cloneConfig.remoteUrlNew) {
                    remoteUrl = cloneConfig.remoteUrlNew;
                }

                // do the clone
                q = q.then(function () {
                    const tracker = ProgressDialog.newProgressTracker();
                    destPath = destPath ? fs.getTauriPlatformPath(destPath) : ".";
                    return ProgressDialog.show(Git.clone(remoteUrl, destPath, tracker), tracker);
                }).then(()=>{
                    Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'clone', "success");
                }).catch(function (err) {
                    Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'clone', "fail");
                    ErrorHandler.showError(err, Strings.GIT_CLONE_REMOTE_FAILED, {errorMetric: "clone"});
                });

                // restore original url if desired
                if (cloneConfig.remoteUrlRestore) {
                    q = q.then(function () {
                        return Git.setRemoteUrl(cloneConfig.remote, cloneConfig.remoteUrlRestore);
                    });
                }

                return q.finally(function () {
                    EventEmitter.emit(Events.REFRESH_ALL);
                });
            }
            if(gitCloneURL){
                return _clone({
                    remote: "origin",
                    remoteUrlNew: gitCloneURL
                });
            }
            CloneDialog.show().then(_clone).catch(function (err) {
                // when dialog is cancelled, there's no error
                if (err) { ErrorHandler.showError(err, Strings.GIT_CLONE_REMOTE_FAILED); }
            });
        }).catch(function (err) {
            ErrorHandler.showError(err);
        }).finally(function () {
            $cloneButton.prop("disabled", false);
        });
    }

    CommandManager.register(Strings.GIT_CLONE, Constants.CMD_GIT_CLONE_WITH_URL, handleGitClone);

    // Event subscriptions
    EventEmitter.on(Events.HANDLE_GIT_INIT, function () {
        handleGitInit();
    });
    EventEmitter.on(Events.HANDLE_GIT_CLONE, function () {
        handleGitClone();
    });
    EventEmitter.on(Events.GIT_NO_BRANCH_EXISTS, function () {
        stageGitIgnore();
    });

});

/*globals jsPromise, path*/

define("src/Panel", function (require, exports) {

    const _                = brackets.getModule("thirdparty/lodash"),
        StateManager       = brackets.getModule("preferences/StateManager"),
        CodeInspection     = brackets.getModule("language/CodeInspection"),
        CommandManager     = brackets.getModule("command/CommandManager"),
        Commands           = brackets.getModule("command/Commands"),
        Dialogs            = brackets.getModule("widgets/Dialogs"),
        DocumentManager    = brackets.getModule("document/DocumentManager"),
        EditorManager      = brackets.getModule("editor/EditorManager"),
        FileViewController = brackets.getModule("project/FileViewController"),
        FileSystem         = brackets.getModule("filesystem/FileSystem"),
        Menus              = brackets.getModule("command/Menus"),
        Mustache           = brackets.getModule("thirdparty/mustache/mustache"),
        FindInFiles        = brackets.getModule("search/FindInFiles"),
        WorkspaceManager   = brackets.getModule("view/WorkspaceManager"),
        ProjectManager     = brackets.getModule("project/ProjectManager"),
        StringUtils        = brackets.getModule("utils/StringUtils"),
        Strings            = brackets.getModule("strings"),
        Metrics            = brackets.getModule("utils/Metrics"),
        NotificationUI = brackets.getModule("widgets/NotificationUI"),
        Constants          = require("src/Constants"),
        Git                = require("src/git/Git"),
        Events             = require("./Events"),
        EventEmitter       = require("./EventEmitter"),
        Preferences        = require("./Preferences"),
        Setup                    = require("src/utils/Setup"),
        ErrorHandler       = require("./ErrorHandler"),
        ExpectedError      = require("./ExpectedError"),
        Main               = require("./Main"),
        GutterManager      = require("./GutterManager"),
        Utils              = require("src/Utils"),
        ProgressDialog     = require("src/dialogs/Progress");

    const gitPanelTemplate            = `<div id="git-panel" class="git bottom-panel vert-resizable top-resizer no-focus">
    <div class="toolbar simple-toolbar-layout mainToolbar">

        <!-- on left -->
        <input type="checkbox" class="check-all git-available" />
        <div class="btn-group git-available">
            <button title="{{S.TOOLTIP_COMMIT}}" class="btn small git-commit" disabled><i class="octicon octicon-git-commit"></i><span>{{S.BUTTON_COMMIT}}</span></button>
        </div>
        <div class="git-available padding-right-small">
            <div class="btn-group git-rebase">
                <button title="{{S.TOOLTIP_REBASE_CONTINUE}}" class="btn small git-rebase-continue">
                    <i class="octicon octicon-git-commit"></i><span>{{S.BUTTON_REBASE_CONTINUE}}</span>
                </button>
                <button title="{{S.TOOLTIP_REBASE_SKIP}}" class="btn small git-rebase-skip">
                    <span>{{S.BUTTON_REBASE_SKIP}}</span>
                </button>
                <button title="{{S.TOOLTIP_REBASE_ABORT}}" class="btn small git-rebase-abort">
                    <span>{{S.BUTTON_REBASE_ABORT}}</span>
                </button>
                <!--
                <button title="{{S.TOOLTIP_FIND_CONFLICTS}}" class="btn small git-find-conflicts">
                    <span>{{S.BUTTON_FIND_CONFLICTS}}</span>
                </button>
                -->
            </div>
        </div>
        <div class="git-available padding-right-small">
            <div class="btn-group git-merge">
                <button title="{{S.TOOLTIP_COMMIT}}" class="btn small git-commit-merge">
                    <i class="octicon octicon-git-commit"></i><span>{{S.BUTTON_COMMIT}}</span>
                </button>
                <button title="{{S.TOOLTIP_MERGE_ABORT}}" class="btn small git-merge-abort">
                    <span>{{S.BUTTON_MERGE_ABORT}}</span>
                </button>
                <!--
                <button title="{{S.TOOLTIP_FIND_CONFLICTS}}" class="btn small git-find-conflicts">
                    <span>{{S.BUTTON_FIND_CONFLICTS}}</span>
                </button>
                -->
            </div>
        </div>
        <div class="btn-group git-available hide-when-x-small">
            <button title="{{S.GOTO_PREVIOUS_GIT_CHANGE}}" class="btn small git-prev-gutter"><i class="octicon octicon-arrow-up"></i></button>
            <button title="{{S.GOTO_NEXT_GIT_CHANGE}}" class="btn small git-next-gutter"><i class="octicon octicon-arrow-down"></i></button>
        </div>
        <div class="btn-group git-available hide-when-x-small">
            <button title="{{S.TOOLTIP_SHOW_HISTORY}}" class="btn small git-history-toggle"><i class="octicon octicon-history"></i></button>
            <button title="{{S.TOOLTIP_SHOW_FILE_HISTORY}}" class="btn small git-file-history"><i class="octicon octicon-file-text"></i></button>
        </div>
        <div class="btn-group git-not-available">
          <button title="{{S.TOOLTIP_INIT}}" class="btn small git-init"><i class="octicon octicon-repo-create"></i><span>{{S.GIT_INIT}}</span></button>
          <button title="{{S.TOOLTIP_CLONE}}" class="btn small git-clone"><i class="octicon octicon-repo-clone"></i><span>{{S.GIT_CLONE}}</span></button>
        </div>
        <!-- this should be last on left -->
        <div class="btn-group git-available hide-when-x-small">
            <button title="{{S.TOOLTIP_REFRESH_PANEL}}" class="btn small git-refresh git-icon"><i class="octicon octicon-sync"></i></button>
        </div>
        <!-- on right -->
        <div class="git-right-icons hide-when-small">
            <div class="btn-group git-available dropup">
                <ul class="dropdown-menu git-remotes-dropdown"></ul>
                <button type="button" class="git-remotes btn small dropdown-toggle" data-toggle="dropdown" title="{{S.TOOLTIP_PICK_REMOTE}}">
                    <span class="caret"></span>
                    <span class="git-selected-remote">&mdash;</span>
                </button>
                <button title="{{S.TOOLTIP_FETCH}}" class="btn small git-fetch"><i class="octicon octicon-cloud-download"></i></button>
                <button title="{{S.TOOLTIP_PULL}}" class="btn small git-pull"><i class="octicon octicon-repo-pull"></i></button>
                <button title="{{S.TOOLTIP_PUSH}}" class="btn small git-push"><i class="octicon octicon-repo-push"></i></button>
            </div>
        </div>
        <div class="git-more-options-btn btn-alt-quiet"><i class="fa-solid fa-ellipsis-vertical"></i></div>
        <a href="#" class="close">&times;</a>

    </div>
    <div class="table-container" style="height: calc(100% - 42px);"></div>
</div>
`,
        gitPanelResultsTemplate     = `<table class="git-edited-list bottom-panel-table table table-striped table-condensed row-highlight">
    <tbody>
        {{#files}}
        <tr class="modified-file" x-file="{{file}}" x-status="{{status}}">
            <td class="checkbox-column"><input type="checkbox" class="check-one" {{#staged}}checked="true"{{/staged}} /></td>
            <td class="icons-column">
                {{#allowDiff}}<button class="btn btn-mini btn-git-diff" title="{{Strings.DIFF}}"><i class="octicon octicon-diff"></i></button>{{/allowDiff}}
            </td>
            <td class="status-column">{{statusText}}</td>
            <td>{{display}}</td>
            <td>
                <div class="btn-group">
                    {{#allowUndo}}   <button class="btn btn-mini btn-git-undo">{{Strings.UNDO_CHANGES_BTN}}</button>  {{/allowUndo}}
                    {{#allowDelete}} <button class="btn btn-mini btn-git-delete">{{Strings.DELETE_FILE_BTN}}</button> {{/allowDelete}}
                </div>
            </td>
        </tr>
        {{/files}}
    </tbody>
</table>
`,
        gitAuthorsDialogTemplate    = `<div id="git-authors-dialog" class="modal">
    <div class="modal-header">
        <h1 class="dialog-title">{{Strings.AUTHORS_OF}} {{file}}</h1>
    </div>
    <div class="modal-body tab-content">
        <table class="table table-condensed">
            <tr>
                <th>
                    {{String.AUTHOR}}
                </th>
                <th>
                </th>
            </tr>
            {{#blameStats}}
            <tr>
                <td>
                    {{authorName}}
                </td>
                <td>
                    {{percentage}}% ({{lines}} {{Strings._LINES}})
                </td>
            </tr>
            {{/blameStats}}
        </table>
    </div>
    <div class="modal-footer">
        <button data-button-id="close" class="dialog-button btn btn-80">{{Strings.BUTTON_CLOSE}}</button>
    </div>
</div>
`,
        gitCommitDialogTemplate     = `<div id="git-commit-dialog" class="modal">
    <div class="modal-header">
        <button class="extendedCommit btn pull-right">{{Strings.EXTENDED_COMMIT_MESSAGE}}</button>
        <label class="checkbox pull-right" style="line-height: 28px; margin-right: 50px;">
            <input class="amend-commit" type="checkbox" style="margin-top: 10px;" /> {{Strings.AMEND_COMMIT}}
        </label>
        <h1 class="dialog-title">{{Strings.GIT_COMMIT}}</h1>
    </div>
    <div class="modal-body table-striped tab-content">
        <div>
            <div class="accordion">
                <!-- Hidden checkbox to toggle the accordion -->
                <input type="checkbox" id="codeInspectionToggle" class="accordion-toggle" />
                <label for="codeInspectionToggle" class="accordion-header">
                    <span class="accordion-title">{{Strings.CODE_INSPECTION_IN_PROGRESS}}</span>
                    <i class="fas fa-chevron-down"></i>
                    <div class="accordion-progress-bar">
                        <div class="accordion-progress-bar-inner"></div>
                    </div>
                </label>
                <div class="accordion-content lint-errors">
                    {{Strings.PLEASE_WAIT}}
                </div>
            </div>
        </div>
        <div class="commit-diff"></div>
        <div class="commit-message-box">
            <input name="commit-message" type="text" placeholder="{{Strings.COMMIT_MESSAGE_PLACEHOLDER}}" autocomplete="off" />
            <textarea name="commit-message" type="text" placeholder="{{Strings.COMMIT_MESSAGE_PLACEHOLDER}}" autocomplete="off" style="display: none;"></textarea>
            <input name="commit-message-count" readonly="readonly" type="text" tabindex="-1" />
        </div>
    </div>
    <div class="modal-footer">
        <label class="checkbox pull-left" style="line-height: 28px; margin-right: 50px;">
            <input class="commit-no-verify" type="checkbox" style="margin-top: 10px;" /> {{Strings.SKIP_COMMIT_CHECKS}}
        </label>
        <button data-button-id="cancel" class="dialog-button btn cancel btn-80" >{{Strings.BUTTON_CANCEL}}</button>
        <button data-button-id="ok"     class="dialog-button btn primary btn-80">{{Strings.BUTTON_OK}}</button>
    </div>
</div>
`,
        gitCommitLintResultTemplate = `<ul>
    {{#lintResults}}
    {{#hasErrors}}
    <li>
        {{filename}}
        <ul>
            {{#errors}}
            <li>
                <a class="lint-error-commit-link" data-file="{{file}}" data-line="{{line}}" data-ch="{{ch}}" style="cursor: pointer">
                    {{errorLineMessage}}
                </a>
            </li>
            {{/errors}}
        </ul>
    </li>
    {{/hasErrors}}
    {{/lintResults}}
</ul>
`,
        gitDiffDialogTemplate       = `<div id="git-diff-dialog" class="modal">
    <div class="modal-header">
        <h1 class="dialog-title">{{{Strings.GIT_DIFF}}} {{file}}</h1>
    </div>
    <div class="modal-body table-striped tab-content">
        <div class="commit-diff"></div>
    </div>
    <div class="modal-footer">
        <button data-button-id="close" class="dialog-button btn btn-80">{{Strings.BUTTON_CLOSE}}</button>
    </div>
</div>
`,
        questionDialogTemplate      = `<div id="git-question-dialog" class="modal">
    <div class="modal-header">
        <h1 class="dialog-title">{{title}}</h1>
    </div>
    <div class="modal-body table-striped tab-content">
        <p>{{{question}}}</p>
        {{#stringInput}}
        <input class="stringInput" type="text" value="{{defaultValue}}" autocomplete="off" spellcheck="false" />
        {{/stringInput}}
        {{#passwordInput}}
        <input class="stringInput" type="password" value="{{defaultValue}}" autocomplete="off" spellcheck="false" />
        {{/passwordInput}}
    </div>
    <div class="modal-footer">
        <button data-button-id="cancel" class="dialog-button btn cancel btn-80" >{{Strings.BUTTON_CANCEL}}</button>
        <button data-button-id="ok"     class="dialog-button btn btn-80 {{#customOkBtnClass}}{{customOkBtnClass}}{{/customOkBtnClass}}{{^customOkBtnClass}}primary{{/customOkBtnClass}}">
            {{#customOkBtn}}{{customOkBtn}}{{/customOkBtn}}{{^customOkBtn}}{{Strings.BUTTON_OK}}{{/customOkBtn}}
        </button>
    </div>
</div>
`;

    const showFileWhiteList = /^\.gitignore$/,
        GIT_PANEL_SHOWN_ON_FIRST_BOOT = "GIT_PANEL_SHOWN_ON_FIRST_BOOT";

    const COMMIT_MODE = {
        CURRENT: "CURRENT",
        ALL: "ALL",
        DEFAULT: "DEFAULT"
    };

    var gitPanel = null,
        $gitPanel = $(null),
        $mainToolbar,
        gitPanelDisabled = null,
        gitPanelMode = null,
        showingUntracked = true,
        $tableContainer = $(null),
        lastCommitMessage = {};

    function lintFile(filename) {
        var fullPath = Preferences.get("currentGitRoot") + filename,
            codeInspectionPromise;

        try {
            codeInspectionPromise = CodeInspection.inspectFile(FileSystem.getFileForPath(fullPath));
        } catch (e) {
            ErrorHandler.logError("CodeInspection.inspectFile failed to execute for file " + fullPath);
            ErrorHandler.logError(e);
            codeInspectionPromise = Promise.reject(e);
        }

        return jsPromise(codeInspectionPromise);
    }

    function _makeDialogBig($dialog) {
        var $wrapper = $dialog.parents(".modal-wrapper").first();
        if ($wrapper.length === 0) { return; }

        $dialog
            .width("80%")
            .children(".modal-body")
                .css("max-height", "72vh")
            .end();
    }

    function _showCommitDialog(stagedDiff, prefilledMessage, commitMode, files) {
        // Open the dialog
        const compiledTemplate = Mustache.render(gitCommitDialogTemplate, {Strings: Strings}),
            dialog           = Dialogs.showModalDialogUsingTemplate(compiledTemplate),
            $dialog          = dialog.getElement();
        Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'commit', "showDialog");
        let totalLintErrors = 0;
        inspectFiles(files, $dialog).then(function (lintResults) {
            // Flatten the error structure from various providers
            lintResults = lintResults || [];
            lintResults.forEach(function (lintResult) {
                lintResult.errors = [];
                const lintingFilePath = path.join(ProjectManager.getProjectRoot().fullPath, lintResult.filename);
                if (Array.isArray(lintResult.result)) {
                    lintResult.result.forEach(function (resultSet) {
                        if (!resultSet.result || !resultSet.result.errors) { return; }

                        var providerName = resultSet.provider.name;
                        resultSet.result.errors.forEach(function (e) {
                            lintResult.errors.push({
                                errorLineMessage: (e.pos.line + 1) + ": " + e.message + " (" + providerName + ")",
                                line: e.pos.line,
                                ch: e.pos.ch,
                                file: lintingFilePath
                            });
                        });
                    });
                } else {
                    ErrorHandler.logError("[brackets-git] lintResults contain object in unexpected format: " + JSON.stringify(lintResult));
                }
                lintResult.hasErrors = lintResult.errors.length > 0;
                totalLintErrors += lintResult.errors.length;
            });

            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'commit', "lintErr" + Metrics.getRangeName(totalLintErrors));

            // Filter out only results with errors to show
            lintResults = _.filter(lintResults, function (lintResult) {
                return lintResult.hasErrors;
            });
            const compiledResultHTML = Mustache.render(gitCommitLintResultTemplate, {
                    Strings: Strings,
                    lintResults: lintResults
                });
            if(!$dialog || !$dialog.is(":visible")) {
                return;
            }
            $dialog.find(".accordion-title").html(Strings.CODE_INSPECTION_PROBLEMS);
            if(!lintResults.length){
                $dialog.find(".lint-errors").html(Strings.CODE_INSPECTION_PROBLEMS_NONE);
                $dialog.find(".accordion").addClass("forced-hidden");
                return;
            }
            $dialog.find(".lint-errors").html(compiledResultHTML);
            if(!$dialog.find(".lint-errors").is(":visible")){
                $dialog.find(".accordion-toggle").click();
            }
            $dialog.find(".lint-error-commit-link").click((e)=>{
                e.preventDefault();
                const $el = $(e.target);
                const fileToOpen = $el.data("file"),
                    line = $el.data("line"),
                    ch = $el.data("ch");
                CommandManager.execute(Commands.FILE_OPEN, {fullPath: fileToOpen})
                    .done(()=>{
                        EditorManager.getCurrentFullEditor().setCursorPos(line, ch, true);
                    });
                dialog.close();
            });
        });

        // We need bigger commit dialog
        _makeDialogBig($dialog);

        // Show nicely colored commit diff
        const diff = Utils.formatDiff(stagedDiff);
        if(diff === Utils.FORMAT_DIFF_TOO_LARGE) {
            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'commit', "diffTooLarge");
        }
        $dialog.find(".commit-diff").append(diff);

        // Enable / Disable amend checkbox
        var toggleAmendCheckbox = function (bool) {
            $dialog.find(".amend-commit")
                .prop("disabled", !bool)
                .parent()
                .attr("title", !bool ? Strings.AMEND_COMMIT_FORBIDDEN : null);
        };
        toggleAmendCheckbox(false);

        Git.getCommitCounts()
            .then(function (commits) {
                var hasRemote = $gitPanel.find(".git-selected-remote").data("remote") != null;
                var hasCommitsAhead = commits.ahead > 0;
                toggleAmendCheckbox(!hasRemote || hasRemote && hasCommitsAhead);
            })
            .catch(function (err) {
                ErrorHandler.logError(err);
            });

        function getCommitMessageElement() {
            var r = $dialog.find("[name='commit-message']:visible");
            if (r.length !== 1) {
                r = $dialog.find("[name='commit-message']");
                for (var i = 0; i < r.length; i++) {
                    if ($(r[i]).css("display") !== "none") {
                        return $(r[i]);
                    }
                }
            }
            return r;
        }

        var $commitMessageCount = $dialog.find("input[name='commit-message-count']");

        // Add event to count characters in commit message
        var recalculateMessageLength = function () {
            var val = getCommitMessageElement().val().trim(),
                length = val.length;

            if (val.indexOf("\n")) {
                // longest line
                length = Math.max.apply(null, val.split("\n").map(function (l) { return l.length; }));
            }

            $commitMessageCount
                .val(length)
                .toggleClass("over50", length > 50 && length <= 100)
                .toggleClass("over100", length > 100);
        };

        var usingTextArea = false;

        // commit message handling
        function switchCommitMessageElement() {
            usingTextArea = !usingTextArea;

            var findStr = "[name='commit-message']",
                currentValue = $dialog.find(findStr + ":visible").val();
            $dialog.find(findStr).toggle();
            $dialog.find(findStr + ":visible")
                .val(currentValue)
                .focus();
            recalculateMessageLength();
        }

        $dialog.find("button.primary").on("click", function (e) {
            var $commitMessage = getCommitMessageElement();
            if ($commitMessage.val().trim().length === 0) {
                e.stopPropagation();
                $commitMessage.addClass("invalid");
            } else {
                $commitMessage.removeClass("invalid");
            }
        });

        $dialog.find("button.extendedCommit").on("click", function () {
            switchCommitMessageElement();
            // this value will be set only when manually triggered
            Preferences.set("useTextAreaForCommitByDefault", usingTextArea);
        });

        function prefillMessage(msg) {
            if (msg.indexOf("\n") !== -1 && !usingTextArea) {
                switchCommitMessageElement();
            }
            $dialog.find("[name='commit-message']:visible").val(msg);
            recalculateMessageLength();
        }

        // Assign action to amend checkbox
        $dialog.find(".amend-commit").on("click", function () {
            if ($(this).prop("checked") === false) {
                prefillMessage("");
            } else {
                Git.getLastCommitMessage().then(function (msg) {
                    prefillMessage(msg);
                });
            }
        });

        if (Preferences.get("useTextAreaForCommitByDefault")) {
            switchCommitMessageElement();
        }

        if (prefilledMessage) {
            prefillMessage(prefilledMessage.trim());
        }

        // Add focus to commit message input
        getCommitMessageElement().focus();

        $dialog.find("[name='commit-message']")
            .on("keyup", recalculateMessageLength)
            .on("change", recalculateMessageLength);
        recalculateMessageLength();

        dialog.done(function (buttonId) {
            const commitMessageElement = getCommitMessageElement();
            if(commitMessageElement){
                lastCommitMessage[ProjectManager.getProjectRoot().fullPath] = commitMessageElement.val();
            }
            if (buttonId === "ok") {
                if (commitMode === COMMIT_MODE.ALL || commitMode === COMMIT_MODE.CURRENT) {
                    var filePaths = _.map(files, function (next) {
                        return next.file;
                    });
                    Git.stage(filePaths)
                    .then(function () {
                        return _getStagedDiff();
                    })
                    .then(function (diff) {
                        _doGitCommit($dialog, getCommitMessageElement, diff);
                    })
                    .catch(function (err) {
                        ErrorHandler.showError(err, Strings.ERROR_CANT_GET_STAGED_DIFF);
                    });
                } else {
                    _doGitCommit($dialog, getCommitMessageElement, stagedDiff);
                }
            } else {
                Git.status();
            }
        });
    }

    function _doGitCommit($dialog, getCommitMessageElement, stagedDiff) {
        // this event won't launch when commit-message is empty so its safe to assume that it is not
        var commitMessage = getCommitMessageElement().val(),
            amendCommit = $dialog.find(".amend-commit").prop("checked"),
            noVerify = $dialog.find(".commit-no-verify").prop("checked");

        // if commit message is extended and has a newline, put an empty line after first line to separate subject and body
        var s = commitMessage.split("\n");
        if (s.length > 1 && s[1].trim() !== "") {
            s.splice(1, 0, "");
        }
        commitMessage = s.join("\n");

        // save lastCommitMessage in case the commit will fail
        lastCommitMessage[ProjectManager.getProjectRoot().fullPath] = commitMessage;

        // now we are going to be paranoid and we will check if some mofo didn't change our diff
        _getStagedDiff().then(function (diff) {
            if (diff === stagedDiff) {
                const tracker = ProgressDialog.newProgressTracker();
                return ProgressDialog.show(Git.commit(commitMessage, amendCommit, noVerify, tracker),
                    tracker, {
                        title: Strings.GIT_COMMIT_IN_PROGRESS,
                        options: { preDelay: 1, postDelay: 1 }
                    })
                    .then(function () {
                        // clear lastCommitMessage because the commit was successful
                        lastCommitMessage[ProjectManager.getProjectRoot().fullPath] = null;
                    });
            } else {
                throw new ExpectedError(Strings.ERROR_MODIFIED_DIALOG_FILES);
            }
        }).then(()=>{
            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'commit', "success");
        }).catch(function (err) {
            if (ErrorHandler.contains(err, "Please tell me who you are")) {
                return new Promise((resolve)=>{
                    EventEmitter.emit(Events.GIT_CHANGE_USERNAME, function () {
                        EventEmitter.emit(Events.GIT_CHANGE_EMAIL, function () {
                            resolve();
                        });
                    });
                });
            }

            ErrorHandler.showError(err, Strings.ERROR_GIT_COMMIT_FAILED, {errorMetric: "commit"});
            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'commit', "fail");

        }).finally(function () {
            EventEmitter.emit(Events.GIT_COMMITED);
            refresh();
        });
    }

    function _showAuthors(file, blame, fromLine, toLine) {
        var linesTotal = blame.length;
        var blameStats = blame.reduce(function (stats, lineInfo) {
            var name = lineInfo.author + " " + lineInfo["author-mail"];
            if (stats[name]) {
                stats[name] += 1;
            } else {
                stats[name] = 1;
            }
            return stats;
        }, {});
        blameStats = _.reduce(blameStats, function (arr, val, key) {
            arr.push({
                authorName: key,
                lines: val,
                percentage: Math.round(val / (linesTotal / 100))
            });
            return arr;
        }, []);
        blameStats = _.sortBy(blameStats, "lines").reverse();

        if (fromLine || toLine) {
            file += " (" + Strings.LINES + " " + fromLine + "-" + toLine + ")";
        }

        var compiledTemplate = Mustache.render(gitAuthorsDialogTemplate, {
                file: file,
                blameStats: blameStats,
                Strings: Strings
            });
        Dialogs.showModalDialogUsingTemplate(compiledTemplate);
    }

    function _getCurrentFilePath(editor) {
        var gitRoot = Preferences.get("currentGitRoot"),
            document = editor ? editor.document : DocumentManager.getCurrentDocument(),
            filePath = document.file.fullPath;
        if (filePath.indexOf(gitRoot) === 0) {
            filePath = filePath.substring(gitRoot.length);
        }
        return filePath;
    }

    function handleAuthorsSelection() {
        var editor = EditorManager.getActiveEditor(),
            filePath = _getCurrentFilePath(editor),
            currentSelection = editor.getSelection(),
            fromLine = currentSelection.start.line + 1,
            toLine = currentSelection.end.line + 1;

        // fix when nothing is selected on that line
        if (currentSelection.end.ch === 0) { toLine = toLine - 1; }

        var isSomethingSelected = currentSelection.start.line !== currentSelection.end.line ||
                                  currentSelection.start.ch !== currentSelection.end.ch;
        if (!isSomethingSelected) {
            ErrorHandler.showError(new ExpectedError(Strings.ERROR_NOTHING_SELECTED));
            return;
        }

        if (editor.document.isDirty) {
            ErrorHandler.showError(new ExpectedError(Strings.ERROR_SAVE_FIRST));
            return;
        }

        Git.getBlame(filePath, fromLine, toLine).then(function (blame) {
            return _showAuthors(filePath, blame, fromLine, toLine);
        }).catch(function (err) {
            ErrorHandler.showError(err, Strings.ERROR_GIT_BLAME_FAILED);
        });
    }

    function handleAuthorsFile() {
        var filePath = _getCurrentFilePath();
        Git.getBlame(filePath).then(function (blame) {
            return _showAuthors(filePath, blame);
        }).catch(function (err) {
            ErrorHandler.showError(err, Strings.ERROR_GIT_BLAME_FAILED);
        });
    }

    function handleGitDiff(file) {
        if (Preferences.get("useDifftool")) {
            Git.difftool(file);
        } else {
            Git.diffFileNice(file).then(function (diff) {
                // show the dialog with the diff
                var compiledTemplate = Mustache.render(gitDiffDialogTemplate, { file: file, Strings: Strings }),
                    dialog           = Dialogs.showModalDialogUsingTemplate(compiledTemplate),
                    $dialog          = dialog.getElement();
                _makeDialogBig($dialog);
                const diffVal = Utils.formatDiff(diff);
                if(diffVal === Utils.FORMAT_DIFF_TOO_LARGE) {
                    Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'diffBtn', "diffTooLarge");
                } else {
                    Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'diffBtn', "success");
                }
                $dialog.find(".commit-diff").append(diffVal);
            }).catch(function (err) {
                Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'diffBtn', "error");
                ErrorHandler.showError(err, Strings.ERROR_GIT_DIFF_FAILED);
            });
        }
    }

    function handleGitUndo(file) {
        var compiledTemplate = Mustache.render(questionDialogTemplate, {
            title: Strings.UNDO_CHANGES,
            question: StringUtils.format(Strings.Q_UNDO_CHANGES, _.escape(file)),
            Strings: Strings
        });
        Dialogs.showModalDialogUsingTemplate(compiledTemplate).done(function (buttonId) {
            if (buttonId === "ok") {
                Git.discardFileChanges(file).then(function () {
                    var gitRoot = Preferences.get("currentGitRoot");
                    DocumentManager.getAllOpenDocuments().forEach(function (doc) {
                        if (doc.file.fullPath === gitRoot + file) {
                            Utils.reloadDoc(doc);
                        }
                    });
                    refresh();
                }).catch(function (err) {
                    ErrorHandler.showError(err, Strings.ERROR_DISCARD_CHANGES_FAILED);
                });
            }
        });
    }

    function handleGitDelete(file) {
        FileSystem.resolve(Preferences.get("currentGitRoot") + file, function (err, fileEntry) {
            if (err) {
                ErrorHandler.showError(err, Strings.ERROR_COULD_NOT_RESOLVE_FILE);
                return;
            }
            CommandManager.execute(Commands.FILE_DELETE, {file: fileEntry});
        });
    }

    function _getStagedDiff(commitMode, files = []) {
        const tracker = ProgressDialog.newProgressTracker();
        const fileNamesString = files.map(file => file.file).join(", ");
        return ProgressDialog.show(_getStagedDiffForCommitMode(commitMode, files), tracker, {
            title: Strings.GETTING_STAGED_DIFF_PROGRESS,
            initialMessage: `${fileNamesString}\n${Strings.PLEASE_WAIT}`,
            options: { preDelay: 3, postDelay: 1 }
        })
        .catch(function (err) {
            if (ErrorHandler.contains(err, "cleanup")) {
                return false; // will display list of staged files instead
            }
            throw err;
        })
        .then(function (diff) {
            if (!diff) {
                return Git.getListOfStagedFiles().then(function (filesList) {
                    return Strings.DIFF_FAILED_SEE_FILES + "\n\n" + filesList;
                });
            }
            return diff;
        });
    }

    function _getStagedDiffForCommitMode(commitMode, files) {

        if (commitMode === COMMIT_MODE.ALL) {
            return _getStaggedDiffForAllFiles();
        }

        if (commitMode === COMMIT_MODE.CURRENT && _.isArray(files)) {
            if (files.length > 1) {
                return Promise.reject("_getStagedDiffForCommitMode() got files.length > 1");
            }

            var isUntracked = files[0].status.indexOf(Git.FILE_STATUS.UNTRACKED) !== -1;
            if (isUntracked) {
                return _getDiffForUntrackedFiles(files[0].file);
            } else {
                return Git.getDiffOfAllIndexFiles(files[0].file);
            }
        }

        return Git.getDiffOfStagedFiles();
    }

    function _getStaggedDiffForAllFiles() {
        return Git.status().then(function (statusFiles) {
            var untrackedFiles = [];
            var fileArray = [];

            statusFiles.forEach(function (fileObject) {
                var isUntracked = fileObject.status.indexOf(Git.FILE_STATUS.UNTRACKED) !== -1;
                if (isUntracked) {
                    untrackedFiles.push(fileObject.file);
                } else {
                    fileArray.push(fileObject.file);
                }
            });

            if (untrackedFiles.length > 0) {
                return _getDiffForUntrackedFiles(fileArray.concat(untrackedFiles));
            } else {
                return Git.getDiffOfAllIndexFiles(fileArray);
            }
        });
    }

    function _getDiffForUntrackedFiles(files) {
        var diff;
        return Git.stage(files, false)
            .then(function () {
                return Git.getDiffOfStagedFiles();
            })
            .then(function (_diff) {
                diff = _diff;
                return Git.resetIndex();
            })
            .then(function () {
                return diff;
            });
    }

    // whatToDo gets values "continue" "skip" "abort"
    function handleRebase(whatToDo) {
        Git.rebase(whatToDo).then(function () {
            EventEmitter.emit(Events.REFRESH_ALL);
        }).catch(function (err) {
            ErrorHandler.showError(err, "Rebase " + whatToDo + " failed");
        });
    }

    function abortMerge() {
        Git.discardAllChanges().then(function () {
            EventEmitter.emit(Events.REFRESH_ALL);
        }).catch(function (err) {
            ErrorHandler.showError(err, Strings.ERROR_MERGE_ABORT_FAILED);
        });
    }

    function findConflicts() {
        FindInFiles.doSearch(/^<<<<<<<\s|^=======\s|^>>>>>>>\s/gm);
    }

    function commitMerge() {
        Utils.loadPathContent(Preferences.get("currentGitRoot") + "/.git/MERGE_MSG").then(function (msg) {
            handleGitCommit(msg, true, COMMIT_MODE.DEFAULT);
            EventEmitter.once(Events.GIT_COMMITED, function () {
                EventEmitter.emit(Events.REFRESH_ALL);
            });
        }).catch(function (err) {
            ErrorHandler.showError(err, "Merge commit failed");
        });
    }

    function inspectFiles(gitStatusResults, $dialog) {
        const lintResults = [];
        let totalFiles = gitStatusResults.length,
            totalFilesLinted = 0,
            filesDone = 0;
        function showProgress() {
            const $progressBar = $dialog.find('.accordion-progress-bar-inner');
            if ($progressBar.length) {
                $progressBar[0].style.width = `${filesDone/totalFiles*100}%`;
            }
            if(filesDone === totalFiles){
                $dialog.find('.accordion-progress-bar').addClass("forced-inVisible");
            }
            const progressString = StringUtils.format(Strings.CODE_INSPECTION_DONE_FILES, filesDone, totalFiles);
            $dialog.find(".lint-errors").html(progressString);
        }

        const codeInspectionPromises = gitStatusResults.map(function (fileObj) {
            const isDeleted = fileObj.status.indexOf(Git.FILE_STATUS.DELETED) !== -1;
            if(isDeleted){
                filesDone++;
                showProgress();
                return;
            }

            // Do a code inspection for the file, if it was not deleted
            return new Promise((resolve) => {
                // Delay lintFile execution to give the event loop some breathing room
                setTimeout(() => {
                    lintFile(fileObj.file)
                        .catch(function () {
                            return [
                                {
                                    provider: { name: "See console [F12] for details" },
                                    result: {
                                        errors: [
                                            {
                                                pos: { line: 0, ch: 0 },
                                                message: "CodeInspection failed to execute for this file."
                                            }
                                        ]
                                    }
                                }
                            ];
                        })
                        .then(function (result) {
                            if (result) {
                                lintResults.push({
                                    filename: fileObj.file,
                                    result: result
                                });
                            }
                            resolve();
                        }).finally(()=>{
                            filesDone++;
                            totalFilesLinted++;
                            showProgress();
                        });
                }, 0); // Delay of 0ms to defer to the next tick of the event loop
            });
        });

        return Promise.all(_.compact(codeInspectionPromises)).then(function () {
            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'commit', "files" + Metrics.getRangeName(totalFiles));
            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'commit', "lint" + Metrics.getRangeName(totalFilesLinted));
            return lintResults;
        });
    }


    function handleGitCommit(prefilledMessage, isMerge, commitMode) {
        if(Utils.isLoading($gitPanel.find(".git-commit"))){
            return;
        }

        var stripWhitespace = Preferences.get("stripWhitespaceFromCommits");

        // Disable button (it will be enabled when selecting files after reset)
        Utils.setLoading($gitPanel.find(".git-commit"));

        var p;

        // First reset staged files, then add selected files to the index.
        if (commitMode === COMMIT_MODE.DEFAULT) {
            p = Git.status().then(function (files) {
                files = _.filter(files, function (file) {
                    return file.status.indexOf(Git.FILE_STATUS.STAGED) !== -1;
                });

                if (files.length === 0 && !isMerge) {
                    return ErrorHandler.showError(
                        new Error("Commit button should have been disabled"),
                        "Nothing staged to commit"
                    );
                }

                return handleGitCommitInternal(stripWhitespace,
                                               files,
                                               commitMode,
                                               prefilledMessage);
            });
        } else if (commitMode === COMMIT_MODE.ALL) {
            p = Git.status().then(function (files) {
                return handleGitCommitInternal(stripWhitespace,
                                               files,
                                               commitMode,
                                               prefilledMessage);
            });
        } else if (commitMode === COMMIT_MODE.CURRENT) {
            p = Git.status().then(function (files) {
                var gitRoot = Preferences.get("currentGitRoot");
                var currentDoc = DocumentManager.getCurrentDocument();
                if (currentDoc) {
                    var relativePath = currentDoc.file.fullPath.substring(gitRoot.length);
                    var currentFile = _.filter(files, function (next) {
                        return relativePath === next.file;
                    });
                    return handleGitCommitInternal(stripWhitespace, currentFile, commitMode, prefilledMessage);
                }
            });
        }

        p.catch(function (err) {
            ErrorHandler.showError(err, Strings.ERROR_PREPARING_COMMIT_DIALOG);
        }).finally(function () {
            Utils.unsetLoading($gitPanel.find(".git-commit"));
        });

    }

    function handleGitCommitInternal(stripWhitespace, files, commitMode, prefilledMessage) {
        let queue = Promise.resolve();

        if (stripWhitespace) {
            queue = queue.then(function () {
                const tracker = ProgressDialog.newProgressTracker();
                return ProgressDialog.show(
                    Utils.stripWhitespaceFromFiles(files, commitMode === COMMIT_MODE.DEFAULT, tracker),
                    tracker, {
                        title: Strings.CLEANING_WHITESPACE_PROGRESS,
                        options: { preDelay: 3, postDelay: 1 }
                    }
                );
            });
        }

        return queue.then(function () {
            // All files are in the index now, get the diff and show dialog.
            return _getStagedDiff(commitMode, files).then(function (diff) {
                return _showCommitDialog(diff, prefilledMessage, commitMode, files);
            });
        });
    }

    function refreshCurrentFile() {
        var gitRoot = Preferences.get("currentGitRoot");
        var currentDoc = DocumentManager.getCurrentDocument();
        if (currentDoc) {
            $gitPanel.find("tr").each(function () {
                var currentFullPath = currentDoc.file.fullPath,
                    thisFile = $(this).attr("x-file");
                $(this).toggleClass("selected", gitRoot + thisFile === currentFullPath);
            });
        } else {
            $gitPanel.find("tr").removeClass("selected");
        }
    }

    function shouldShow(fileObj) {
        if (showFileWhiteList.test(fileObj.name)) {
            return true;
        }
        return ProjectManager.shouldShow(fileObj);
    }

    function _refreshTableContainer(files) {
        if (!gitPanel.isVisible()) {
            return;
        }

        // remove files that we should not show
        files = _.filter(files, function (file) {
            return shouldShow(file);
        });

        var allStaged = files.length > 0 && _.all(files, function (file) { return file.status.indexOf(Git.FILE_STATUS.STAGED) !== -1; });
        $gitPanel.find(".check-all").prop("checked", allStaged).prop("disabled", files.length === 0);

        var $editedList = $tableContainer.find(".git-edited-list");
        var visibleBefore = $editedList.length ? $editedList.is(":visible") : true;
        $editedList.remove();

        if (files.length === 0) {
            $tableContainer.append($("<p class='git-edited-list nothing-to-commit' />").text(Strings.NOTHING_TO_COMMIT));
        } else {
            // if desired, remove untracked files from the results
            if (showingUntracked === false) {
                files = _.filter(files, function (file) {
                    return file.status.indexOf(Git.FILE_STATUS.UNTRACKED) === -1;
                });
            }
            // -
            files.forEach(function (file) {
                file.staged = file.status.indexOf(Git.FILE_STATUS.STAGED) !== -1;
                file.statusText = file.status.map(function (status) {
                    return Strings["FILE_" + status];
                }).join(", ");
                file.allowDiff = file.status.indexOf(Git.FILE_STATUS.UNTRACKED) === -1 &&
                                 file.status.indexOf(Git.FILE_STATUS.RENAMED) === -1 &&
                                 file.status.indexOf(Git.FILE_STATUS.DELETED) === -1;
                file.allowDelete = file.status.indexOf(Git.FILE_STATUS.UNTRACKED) !== -1 ||
                                   file.status.indexOf(Git.FILE_STATUS.STAGED) !== -1 &&
                                   file.status.indexOf(Git.FILE_STATUS.ADDED) !== -1;
                file.allowUndo = !file.allowDelete;
            });
            $tableContainer.append(Mustache.render(gitPanelResultsTemplate, {
                files: files,
                Strings: Strings
            }));

            refreshCurrentFile();
        }
        $tableContainer.find(".git-edited-list").toggle(visibleBefore);
    }

    function _setName(commandID, newName) {
        const command = CommandManager.get(commandID);
        if (command) {
            command.setName(newName);
        }
    }

    function refreshCommitCounts() {
        // Find Push and Pull buttons
        var $pullBtn = $gitPanel.find(".git-pull");
        var $pushBtn = $gitPanel.find(".git-push");
        var clearCounts = function () {
            $pullBtn.children("span").remove();
            $pushBtn.children("span").remove();
            _setName(Constants.CMD_GIT_PULL, Strings.PULL_SHORTCUT);
            _setName(Constants.CMD_GIT_PUSH, Strings.PUSH_SHORTCUT);
        };

        // Check if there's a remote, resolve if there's not
        var remotes = Preferences.get("defaultRemotes") || {};
        var defaultRemote = remotes[Preferences.get("currentGitRoot")];
        if (!defaultRemote) {
            clearCounts();
            return Promise.resolve();
        }

        // Get the commit counts and append them to the buttons
        return Git.getCommitCounts().then(function (commits) {
            clearCounts();
            if (commits.behind > 0) {
                $pullBtn.append($("<span/>").text(" (" + commits.behind + ")"));
                _setName(Constants.CMD_GIT_PULL,
                    StringUtils.format(Strings.PULL_SHORTCUT_BEHIND, commits.behind));
            }
            if (commits.ahead > 0) {
                $pushBtn.append($("<span/>").text(" (" + commits.ahead + ")"));
                _setName(Constants.CMD_GIT_PUSH,
                    StringUtils.format(Strings.PUSH_SHORTCUT_AHEAD, commits.ahead));
            }
        }).catch(function (err) {
            clearCounts();
            ErrorHandler.logError(err);
        });
    }

    function refresh() {
        // set the history panel to false and remove the class that show the button history active when refresh
        $gitPanel.find(".git-history-toggle").removeClass("active").attr("title", Strings.TOOLTIP_SHOW_HISTORY);
        $gitPanel.find(".git-file-history").removeClass("active").attr("title", Strings.TOOLTIP_SHOW_FILE_HISTORY);

        if (gitPanelMode === "not-repo") {
            $tableContainer.empty();
            return Promise.resolve();
        }

        $tableContainer.find("#git-history-list").remove();
        $tableContainer.find(".git-edited-list").show();

        var p1 = Git.status().catch(function (err) {
            // this is an expected "error"
            if (ErrorHandler.contains(err, "Not a git repository")) {
                return;
            }
        });

        var p2 = refreshCommitCounts();

        // Clone button
        $gitPanel.find(".git-clone").prop("disabled", false);

        // FUTURE: who listens for this?
        return Promise.all([p1, p2]);
    }

    function toggle(bool) {
        if (gitPanelDisabled === true) {
            return;
        }
        if (typeof bool !== "boolean") {
            bool = !gitPanel.isVisible();
        }
        Preferences.set("panelEnabled", bool);
        Main.$icon.toggleClass("on", bool);
        Main.$icon.toggleClass("selected-button", bool);
        gitPanel.setVisible(bool);

        // Mark menu item as enabled/disabled.
        CommandManager.get(Constants.CMD_GIT_TOGGLE_PANEL).setChecked(bool);

        if (bool) {
            $("#git-toolbar-icon").removeClass("forced-hidden");
            refresh();
        }
    }

    function handleToggleUntracked() {
        showingUntracked = !showingUntracked;
        const command = CommandManager.get(Constants.CMD_GIT_TOGGLE_UNTRACKED);
        if (command) {
            command.setChecked(!showingUntracked);
        }

        refresh();
    }

    function commitCurrentFile() {
        // do not return anything here, core expects jquery promise
        jsPromise(CommandManager.execute("file.save"))
            .then(function () {
                return Git.resetIndex();
            })
            .then(function () {
                return handleGitCommit(lastCommitMessage[ProjectManager.getProjectRoot().fullPath],
                    false, COMMIT_MODE.CURRENT);
            }).catch((err)=>{
                console.error(err);
                // rethrowing with stripped git error details as it may have sensitive info
                throw new Error("Error commitCurrentFile in git panel.js. this should not have happened here.");
            });
    }

    function commitAllFiles() {
        // do not return anything here, core expects jquery promise
        jsPromise(CommandManager.execute("file.saveAll"))
            .then(function () {
                return Git.resetIndex();
            })
            .then(function () {
                return handleGitCommit(lastCommitMessage[ProjectManager.getProjectRoot().fullPath],
                    false, COMMIT_MODE.ALL);
            }).catch((err)=>{
                console.error(err);
                // rethrowing with stripped git error details as it may have sensitive info
                throw new Error("Error commitAllFiles in git panel.js. this should not have happened here.");
            });
    }

    // Disable "commit" button if there aren't staged files to commit
    function _toggleCommitButton(files) {
        var anyStaged = _.any(files, function (file) { return file.status.indexOf(Git.FILE_STATUS.STAGED) !== -1; });
        $gitPanel.find(".git-commit").prop("disabled", !anyStaged);
    }

    EventEmitter.on(Events.GIT_STATUS_RESULTS, function (results) {
        _refreshTableContainer(results);
        _toggleCommitButton(results);
    });

    function undoLastLocalCommit() {
        return Utils.askQuestion(Strings.UNDO_COMMIT, Strings.UNDO_LOCAL_COMMIT_CONFIRM, {booleanResponse: true})
            .then(function (response) {
                if (response) {
                    Git.undoLastLocalCommit()
                        .catch(function (err) {
                            ErrorHandler.showError(err, Strings.ERROR_UNDO_LAST_COMMIT_FAILED);
                        })
                        .finally(function () {
                            refresh();
                        });
                }
            });
    }

    var lastCheckOneClicked = null;

    function attachDefaultTableHandlers() {
        $tableContainer = $gitPanel.find(".table-container")
            .off()
            .on("click", ".check-one", function (e) {
                e.stopPropagation();
                var $tr = $(this).closest("tr"),
                    file = $tr.attr("x-file"),
                    status = $tr.attr("x-status"),
                    isChecked = $(this).is(":checked");

                if (e.shiftKey) {
                    // stage/unstage all file between
                    var lc = lastCheckOneClicked.localeCompare(file),
                        lcClickedSelector = "[x-file='" + lastCheckOneClicked + "']",
                        sequence;

                    if (lc < 0) {
                        sequence = $tr.prevUntil(lcClickedSelector).andSelf();
                    } else if (lc > 0) {
                        sequence = $tr.nextUntil(lcClickedSelector).andSelf();
                    }

                    if (sequence) {
                        sequence = sequence.add($tr.parent().children(lcClickedSelector));
                        var promises = sequence.map(function () {
                            var $this = $(this),
                                method = isChecked ? "stage" : "unstage",
                                file = $this.attr("x-file"),
                                status = $this.attr("x-status");
                            return Git[method](file, status === Git.FILE_STATUS.DELETED);
                        }).toArray();
                        return Promise.all(promises).then(function () {
                            return Git.status();
                        }).catch(function (err) {
                            ErrorHandler.showError(err, Strings.ERROR_MODIFY_FILE_STATUS_FAILED);
                        });
                    }
                }

                lastCheckOneClicked = file;

                if (isChecked) {
                    Git.stage(file, status === Git.FILE_STATUS.DELETED).then(function () {
                        Git.status();
                    });
                } else {
                    Git.unstage(file).then(function () {
                        Git.status();
                    });
                }
            })
            .on("dblclick", ".check-one", function (e) {
                e.stopPropagation();
            })
            .on("click", ".btn-git-diff", function (e) {
                e.stopPropagation();
                handleGitDiff($(e.target).closest("tr").attr("x-file"));
            })
            .on("click", ".btn-git-undo", function (e) {
                e.stopPropagation();
                handleGitUndo($(e.target).closest("tr").attr("x-file"));
            })
            .on("click", ".btn-git-delete", function (e) {
                e.stopPropagation();
                handleGitDelete($(e.target).closest("tr").attr("x-file"));
            })
            .on("mousedown", ".modified-file", function (e) {
                var $this = $(e.currentTarget);
                // we listen on mousedown event for faster file switch perception. but this results in
                // this handler getting triggered before the above click handlers for table buttons and
                // Check boxes. So we do a check to see if the clicked element is NOT a button,
                // input, or tag inside a button.
                if ($(e.target).is("button, input") || $(e.target).closest("button").length) {
                    return;
                }
                if ($this.attr("x-status") === Git.FILE_STATUS.DELETED) {
                    return;
                }
                CommandManager.execute(Commands.FILE_OPEN, {
                    fullPath: Preferences.get("currentGitRoot") + $this.attr("x-file")
                });
            })
            .on("dblclick", ".modified-file", function (e) {
                var $this = $(e.currentTarget);
                if ($this.attr("x-status") === Git.FILE_STATUS.DELETED) {
                    return;
                }
                FileViewController.openFileAndAddToWorkingSet(Preferences.get("currentGitRoot") + $this.attr("x-file"));
            });

    }

    EventEmitter.on(Events.GIT_CHANGE_USERNAME, function (callback) {
        return Git.getConfig("user.name").then(function (currentUserName) {
            return Utils.askQuestion(Strings.CHANGE_USER_NAME_TITLE, Strings.ENTER_NEW_USER_NAME, { defaultValue: currentUserName })
                .then(function (userName) {
                    if (!userName.length) { userName = currentUserName; }
                    return Git.setConfig("user.name", userName, true).catch(function (err) {
                        ErrorHandler.showError(err, Strings.ERROR_CHANGE_USERNAME_FAILED);
                    }).then(function () {
                        EventEmitter.emit(Events.GIT_USERNAME_CHANGED, userName);
                    }).finally(function () {
                        if (callback) {
                            callback(userName);
                        }
                    });
                });
        });
    });

    EventEmitter.on(Events.GIT_CHANGE_EMAIL, function (callback) {
        return Git.getConfig("user.email").then(function (currentUserEmail) {
            return Utils.askQuestion(Strings.CHANGE_USER_EMAIL_TITLE, Strings.ENTER_NEW_USER_EMAIL, { defaultValue: currentUserEmail })
                .then(function (userEmail) {
                    if (!userEmail.length) { userEmail = currentUserEmail; }
                    return Git.setConfig("user.email", userEmail, true).catch(function (err) {
                        ErrorHandler.showError(err, Strings.ERROR_CHANGE_EMAIL_FAILED);
                    }).then(function () {
                        EventEmitter.emit(Events.GIT_EMAIL_CHANGED, userEmail);
                    }).finally(function () {
                        if (callback) {
                            callback(userEmail);
                        }
                    });
                });
        });
    });

    EventEmitter.on(Events.GERRIT_TOGGLE_PUSH_REF, function () {
        // update preference and emit so the menu item updates
        return Git.getConfig("gerrit.pushref").then(function (strEnabled) {
            var toggledValue = strEnabled !== "true";

            // Set the global preference
            // Saving a preference to tell the GitCli.push() method to check for gerrit push ref enablement
            // so we don't slow down people who aren't using gerrit.
            Preferences.set("gerritPushref", toggledValue);

            return Git.setConfig("gerrit.pushref", toggledValue, true)
                .then(function () {
                    EventEmitter.emit(Events.GERRIT_PUSH_REF_TOGGLED, toggledValue);
                });
        }).catch(function (err) {
            ErrorHandler.showError(err, Strings.ERROR_TOGGLE_GERRIT_PUSH_REF_FAILED);
        });
    });

    EventEmitter.on(Events.GERRIT_PUSH_REF_TOGGLED, function (enabled) {
        setGerritCheckState(enabled);
    });

    function setGerritCheckState(enabled) {
        const command = CommandManager.get(Constants.CMD_GIT_GERRIT_PUSH_REF);
        if (command) {
            command.setChecked(enabled);
        }
    }

    function discardAllChanges() {
        return Utils.askQuestion(Strings.RESET_LOCAL_REPO, Strings.RESET_LOCAL_REPO_CONFIRM, {
            booleanResponse: true, customOkBtn: Strings.DISCARD_CHANGES, customOkBtnClass: "danger"})
            .then(function (response) {
                if (response) {
                    return Git.discardAllChanges().catch(function (err) {
                        ErrorHandler.showError(err, Strings.ERROR_RESET_LOCAL_REPO_FAILED);
                    }).then(function () {
                        refresh();
                    });
                }
            });
    }

    /**
     * Retrieves the hash of the selected history commit in the panel. if panel not visible
     * or if there is no selection, returns null.
     *
     * @returns {{hash: string, subject: string}|{}} The `hash` value and commit string
     *              of the selected history commit if visible, otherwise {}.
     */
    function getSelectedHistoryCommit() {
        const $historyRow = $(".history-commit.selected");
        if($historyRow.is(":visible")){
            return {
                hash: $historyRow.attr("x-hash"),
                subject: $historyRow.find(".commit-subject").text()
            };
        }
        return {};
    }

    function _panelResized(_entries) {
        if(!$mainToolbar || !$mainToolbar.is(":visible")){
            return;
        }
        const mainToolbarWidth = $mainToolbar.width();
        let overFlowWidth = 565;
        const breakpoints = [
            { width: overFlowWidth, className: "hide-when-small" },
            { width: 400, className: "hide-when-x-small" }
        ];

        if(mainToolbarWidth < overFlowWidth) {
            $gitPanel.find(".mainToolbar").addClass("hide-overflow");
        } else {
            $gitPanel.find(".mainToolbar").removeClass("hide-overflow");
        }
        breakpoints.forEach(bp => {
            if (mainToolbarWidth < bp.width) {
                $gitPanel.find(`.${bp.className}`).addClass("forced-hidden");
            } else {
                $gitPanel.find(`.${bp.className}`).removeClass("forced-hidden");
            }
        });
    }

    function init() {
        // Add panel
        var panelHtml = Mustache.render(gitPanelTemplate, {
            S: Strings
        });
        var $panelHtml = $(panelHtml);
        $panelHtml.find(".git-available, .git-not-available").hide();

        gitPanel = WorkspaceManager.createBottomPanel("main-git.panel", $panelHtml, 100);
        $gitPanel = gitPanel.$panel;
        const resizeObserver = new ResizeObserver(_panelResized);
        resizeObserver.observe($gitPanel[0]);
        $mainToolbar = $gitPanel.find(".mainToolbar");
        $gitPanel
            .on("click", ".close", toggle)
            .on("click", ".check-all", function () {
                if ($(this).is(":checked")) {
                    return Git.stageAll().then(function () {
                        return Git.status();
                    }).catch((err)=>{
                        console.error(err);
                        // rethrowing with stripped git error details as it may have sensitive info
                        throw new Error("Error stage all by checkbox in git panel.js. this should not have happened");
                    });
                }
                return Git.resetIndex().then(function () {
                    return Git.status();
                }).catch((err)=>{
                    console.error(err);
                    // rethrowing with stripped git error details as it may have sensitive info
                    throw new Error("Error unstage all by checkbox in git panel.js. this should not have happened");
                });
            })
            .on("click", ".git-refresh", EventEmitter.getEmitter(Events.REFRESH_ALL, ["panel", "refreshBtn"]))
            .on("click", ".git-commit", EventEmitter.getEmitter(Events.HANDLE_GIT_COMMIT))
            .on("click", ".git-rebase-continue", function (e) { handleRebase("continue", e); })
            .on("click", ".git-rebase-skip", function (e) { handleRebase("skip", e); })
            .on("click", ".git-rebase-abort", function (e) { handleRebase("abort", e); })
            .on("click", ".git-commit-merge", commitMerge)
            .on("click", ".git-merge-abort", abortMerge)
            .on("click", ".git-find-conflicts", findConflicts)
            .on("click", ".git-prev-gutter", ()=>{
                Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'panel', "prevBtn");
                GutterManager.goToPrev();
            })
            .on("click", ".git-next-gutter", ()=>{
                Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'panel', "nextBtn");
                GutterManager.goToNext();
            })
            .on("click", ".git-file-history", EventEmitter.getEmitter(Events.HISTORY_SHOW_FILE))
            .on("click", ".git-history-toggle", EventEmitter.getEmitter(Events.HISTORY_SHOW_GLOBAL))
            .on("click", ".git-fetch", EventEmitter.getEmitter(Events.HANDLE_FETCH, ["panel", "fetchBtn"]))
            .on("click", ".git-push", function () {
                Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'panel', "pushBtn");
                var typeOfRemote = $(this).attr("x-selected-remote-type");
                if (typeOfRemote === "git") {
                    EventEmitter.emit(Events.HANDLE_PUSH);
                }
            })
            .on("click", ".git-pull", EventEmitter.getEmitter(Events.HANDLE_PULL, ["panel", "pullBtn"]))
            .on("click", ".git-init", EventEmitter.getEmitter(Events.HANDLE_GIT_INIT))
            .on("click", ".git-clone", EventEmitter.getEmitter(Events.HANDLE_GIT_CLONE))
            .on("click", ".change-remote", EventEmitter.getEmitter(Events.HANDLE_REMOTE_PICK, ["panel", "changeRemote"]))
            .on("click", ".remove-remote", EventEmitter.getEmitter(Events.HANDLE_REMOTE_DELETE, ["panel", "removeRemote"]))
            .on("click", ".git-remote-new", EventEmitter.getEmitter(Events.HANDLE_REMOTE_CREATE, ["panel", "newRemote"]))
            .on("contextmenu", "tr", function (e) {
                const $this = $(this);
                if ($this.hasClass("history-commit")) {
                    Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'cmenu', "history");
                    if(!$this.hasClass("selected")){
                        $this.click();
                    }
                    Menus.getContextMenu(Constants.GIT_PANEL_HISTORY_CMENU).open(e);
                    return;
                }

                $this.click();
                setTimeout(function () {
                    Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'cmenu', "filechanges");
                    Menus.getContextMenu(Constants.GIT_PANEL_CHANGES_CMENU).open(e);
                }, 1);
            });

        // Attaching table handlers
        attachDefaultTableHandlers();

        // Add command to menu.
        CommandManager.register(Strings.PANEL_COMMAND, Constants.CMD_GIT_TOGGLE_PANEL, toggle);
        CommandManager.register(Strings.COMMIT_CURRENT_SHORTCUT, Constants.CMD_GIT_COMMIT_CURRENT, commitCurrentFile);
        CommandManager.register(Strings.COMMIT_ALL_SHORTCUT, Constants.CMD_GIT_COMMIT_ALL, commitAllFiles);
        CommandManager.register(Strings.PUSH_SHORTCUT, Constants.CMD_GIT_PUSH, EventEmitter.getEmitter(Events.HANDLE_PUSH));
        CommandManager.register(Strings.PULL_SHORTCUT, Constants.CMD_GIT_PULL, EventEmitter.getEmitter(Events.HANDLE_PULL));
        CommandManager.register(Strings.FETCH_SHORTCUT, Constants.CMD_GIT_FETCH, EventEmitter.getEmitter(Events.HANDLE_FETCH));
        CommandManager.register(Strings.GOTO_PREVIOUS_GIT_CHANGE, Constants.CMD_GIT_GOTO_PREVIOUS_CHANGE, GutterManager.goToPrev);
        CommandManager.register(Strings.GOTO_NEXT_GIT_CHANGE, Constants.CMD_GIT_GOTO_NEXT_CHANGE, GutterManager.goToNext);
        CommandManager.register(Strings.REFRESH_GIT, Constants.CMD_GIT_REFRESH, EventEmitter.getEmitter(Events.REFRESH_ALL));
        CommandManager.register(Strings.RESET_LOCAL_REPO, Constants.CMD_GIT_DISCARD_ALL_CHANGES, discardAllChanges);
        CommandManager.register(Strings.UNDO_LAST_LOCAL_COMMIT, Constants.CMD_GIT_UNDO_LAST_COMMIT, undoLastLocalCommit);
        CommandManager.register(Strings.CHANGE_USER_NAME, Constants.CMD_GIT_CHANGE_USERNAME, EventEmitter.getEmitter(Events.GIT_CHANGE_USERNAME));
        CommandManager.register(Strings.CHANGE_USER_EMAIL, Constants.CMD_GIT_CHANGE_EMAIL, EventEmitter.getEmitter(Events.GIT_CHANGE_EMAIL));
        CommandManager.register(Strings.ENABLE_GERRIT_PUSH_REF, Constants.CMD_GIT_GERRIT_PUSH_REF, EventEmitter.getEmitter(Events.GERRIT_TOGGLE_PUSH_REF));
        CommandManager.register(Strings.VIEW_AUTHORS_SELECTION, Constants.CMD_GIT_AUTHORS_OF_SELECTION, handleAuthorsSelection);
        CommandManager.register(Strings.VIEW_AUTHORS_FILE, Constants.CMD_GIT_AUTHORS_OF_FILE, handleAuthorsFile);
        CommandManager.register(Strings.HIDE_UNTRACKED, Constants.CMD_GIT_TOGGLE_UNTRACKED, handleToggleUntracked);
        CommandManager.register(Strings.GIT_INIT, Constants.CMD_GIT_INIT, EventEmitter.getEmitter(Events.HANDLE_GIT_INIT));
        CommandManager.register(Strings.GIT_CLONE, Constants.CMD_GIT_CLONE, EventEmitter.getEmitter(Events.HANDLE_GIT_CLONE));

        // Show gitPanel when appropriate
        if (Preferences.get("panelEnabled") && Setup.isExtensionActivated()) {
            toggle(true);
        }
        _panelResized();
        GutterManager.init();
    } // function init() {

    function enable() {
        EventEmitter.emit(Events.GIT_ENABLED);
        // this function is called after every Branch.refresh
        gitPanelMode = null;
        //
        $gitPanel.find(".git-available").show();
        $gitPanel.find(".git-not-available").hide();
        Utils.enableCommand(Constants.CMD_GIT_INIT, false);
        Utils.enableCommand(Constants.CMD_GIT_CLONE, false);
        //
        Main.$icon.removeClass("warning");
        gitPanelDisabled = false;
        // after all is enabled
        refresh();
    }

    function disable(cause) {
        EventEmitter.emit(Events.GIT_DISABLED, cause);
        gitPanelMode = cause;
        // causes: not-repo
        if (gitPanelMode === "not-repo") {
            $gitPanel.find(".git-available").hide();
            $gitPanel.find(".git-not-available").show();
            Utils.enableCommand(Constants.CMD_GIT_INIT, true);
            Utils.enableCommand(Constants.CMD_GIT_CLONE, true);
        } else {
            Main.$icon.addClass("warning");
            toggle(false);
            gitPanelDisabled = true;
        }
        refresh();
    }

    // Event listeners
    EventEmitter.on(Events.GIT_USERNAME_CHANGED, function (userName) {
        if(userName){
            _setName(Constants.CMD_GIT_CHANGE_USERNAME,
                StringUtils.format(Strings.CHANGE_USER_NAME_MENU, userName));
        } else {
            _setName(Constants.CMD_GIT_CHANGE_USERNAME, Strings.CHANGE_USER_NAME);
        }
    });

    EventEmitter.on(Events.GIT_EMAIL_CHANGED, function (email) {
        $gitPanel.find(".git-user-email").text(email);
        if(email){
            _setName(Constants.CMD_GIT_CHANGE_EMAIL,
                StringUtils.format(Strings.CHANGE_USER_EMAIL_MENU, email));
        } else {
            _setName(Constants.CMD_GIT_CHANGE_EMAIL, Strings.CHANGE_USER_EMAIL);
        }
    });

    EventEmitter.on(Events.GIT_REMOTE_AVAILABLE, function () {
        $gitPanel.find(".git-pull, .git-push, .git-fetch").prop("disabled", false);
    });

    EventEmitter.on(Events.GIT_REMOTE_NOT_AVAILABLE, function () {
        $gitPanel.find(".git-pull, .git-push, .git-fetch").prop("disabled", true);
    });

    EventEmitter.on(Events.GIT_ENABLED, function () {
        if(!StateManager.get(GIT_PANEL_SHOWN_ON_FIRST_BOOT)){
            StateManager.set(GIT_PANEL_SHOWN_ON_FIRST_BOOT, true);
            toggle(true);
            NotificationUI.createFromTemplate(
                Strings.GIT_TOAST_TITLE,
                Strings.GIT_TOAST_MESSAGE,
                "git-toolbar-icon", {
                    allowedPlacements: ['left'],
                    dismissOnClick: true,
                    toastStyle: "width-250"
                }
            );
        }
        Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'project', "enabled");
        // Add info from Git to panel
        Git.getConfig("user.name").then(function (currentUserName) {
            EventEmitter.emit(Events.GIT_USERNAME_CHANGED, currentUserName);
        });
        Git.getConfig("user.email").then(function (currentEmail) {
            EventEmitter.emit(Events.GIT_EMAIL_CHANGED, currentEmail);
        });
        Git.getConfig("gerrit.pushref").then(function (strEnabled) {
            var enabled = strEnabled === "true";
            // Handle the case where we switched to a repo that is using gerrit
            if (enabled && !Preferences.get("gerritPushref")) {
                Preferences.set("gerritPushref", true);
            }
            EventEmitter.emit(Events.GERRIT_PUSH_REF_TOGGLED, enabled);
        });
    });

    EventEmitter.on(Events.BRACKETS_CURRENT_DOCUMENT_CHANGE, function () {
        if (!gitPanel) { return; }
        refreshCurrentFile();
    });

    EventEmitter.on(Events.BRACKETS_DOCUMENT_SAVED, function () {
        if (!gitPanel) { return; }
        refresh();
    });

    EventEmitter.on(Events.BRACKETS_FILE_CHANGED, function (fileSystemEntry) {
        // files are added or deleted from the directory
        if (fileSystemEntry.isDirectory) {
            refresh();
        }
    });

    EventEmitter.on(Events.REBASE_MERGE_MODE, function (rebaseEnabled, mergeEnabled) {
        $gitPanel.find(".git-rebase").toggle(rebaseEnabled);
        $gitPanel.find(".git-merge").toggle(mergeEnabled);
        $gitPanel.find("button.git-commit").toggle(!rebaseEnabled && !mergeEnabled);
    });

    EventEmitter.on(Events.FETCH_STARTED, function () {
        $gitPanel.find(".git-fetch")
            .addClass("btn-loading")
            .prop("disabled", true);
    });

    EventEmitter.on(Events.FETCH_COMPLETE, function () {
        $gitPanel.find(".git-fetch")
            .removeClass("btn-loading")
            .prop("disabled", false);
        refreshCommitCounts();
    });

    EventEmitter.on(Events.REFRESH_COUNTERS, function () {
        refreshCommitCounts();
    });

    EventEmitter.on(Events.HANDLE_GIT_COMMIT, function () {
        handleGitCommit(lastCommitMessage[ProjectManager.getProjectRoot().fullPath], false, COMMIT_MODE.DEFAULT);
    });

    exports.init = init;
    exports.refresh = refresh;
    exports.toggle = toggle;
    exports.enable = enable;
    exports.disable = disable;
    exports.getSelectedHistoryCommit = getSelectedHistoryCommit;
    exports.getPanel = function () { return $gitPanel; };

});

define("src/Preferences", function (require, exports, module) {

    var _                   = brackets.getModule("thirdparty/lodash"),
        PreferencesManager  = brackets.getModule("preferences/PreferencesManager"),
        StateManager        = PreferencesManager.stateManager,
        prefix              = "git";

    var defaultPreferences = {
        // features
        "stripWhitespaceFromCommits": {     "type": "boolean",           "value": true              },
        "addEndlineToTheEndOfFile": {       "type": "boolean",           "value": true              },
        "removeByteOrderMark": {            "type": "boolean",           "value": false             },
        "normalizeLineEndings": {           "type": "boolean",           "value": false             },
        "useGitGutter": {                   "type": "boolean",           "value": true              },
        "markModifiedInTree": {             "type": "boolean",           "value": true              },
        "useVerboseDiff": {                 "type": "boolean",           "value": false             },
        "useDifftool": {                    "type": "boolean",           "value": false             },
        "clearWhitespaceOnSave": {          "type": "boolean",           "value": false             },
        "gerritPushref": {                  "type": "boolean",           "value": false             },
        // system
        "enableGit": {                      "type": "boolean",           "value": true              },
        "gitTimeout": {                     "type": "number",            "value": 30                },
        "gitPath": {                        "type": "string",            "value": ""                }
    };

    var prefs = PreferencesManager.getExtensionPrefs(prefix);
    _.each(defaultPreferences, function (definition, key) {
        if (definition.os && definition.os[brackets.platform]) {
            prefs.definePreference(key, definition.type, definition.os[brackets.platform].value);
        } else {
            prefs.definePreference(key, definition.type, definition.value);
        }
    });
    prefs.save();

    function get(key) {
        var location = defaultPreferences[key] ? PreferencesManager : StateManager;
        arguments[0] = prefix + "." + key;
        return location.get.apply(location, arguments);
    }

    function set(key) {
        var location = defaultPreferences[key] ? PreferencesManager : StateManager;
        arguments[0] = prefix + "." + key;
        return location.set.apply(location, arguments);
    }

    function getAll() {
        var obj = {};
        _.each(defaultPreferences, function (definition, key) {
            obj[key] = get(key);
        });
        return obj;
    }

    function getDefaults() {
        var obj = {};
        _.each(defaultPreferences, function (definition, key) {
            var defaultValue;
            if (definition.os && definition.os[brackets.platform]) {
                defaultValue = definition.os[brackets.platform].value;
            } else {
                defaultValue = definition.value;
            }
            obj[key] = defaultValue;
        });
        return obj;
    }

    function getType(key) {
        return defaultPreferences[key].type;
    }

    function getGlobal(key) {
        return PreferencesManager.get(key);
    }

    function getExtensionPref() {
        return prefs;
    }

    function save() {
        PreferencesManager.save();
    }

    module.exports = {
        get: get,
        set: set,
        getAll: getAll,
        getDefaults: getDefaults,
        getType: getType,
        getGlobal: getGlobal,
        getExtensionPref: getExtensionPref,
        save: save
    };

});

define("src/ProjectTreeMarks", function (require) {

    var _                 = brackets.getModule("thirdparty/lodash"),
        FileSystem        = brackets.getModule("filesystem/FileSystem"),
        ProjectManager    = brackets.getModule("project/ProjectManager");

    var EventEmitter      = require("src/EventEmitter"),
        Events            = require("src/Events"),
        Git               = require("src/git/Git"),
        Preferences       = require("src/Preferences");

    var ignoreEntries = [],
        newPaths      = [],
        modifiedPaths = [];

    if (!Preferences.get("markModifiedInTree")) {
        // end here, no point in processing the code below
        return;
    }

    function loadIgnoreContents() {
        return new Promise((resolve)=>{
            let gitRoot = Preferences.get("currentGitRoot"),
                excludeContents,
                gitignoreContents;

            const finish = _.after(2, function () {
                resolve(excludeContents + "\n" + gitignoreContents);
            });

            FileSystem.getFileForPath(gitRoot + ".git/info/exclude").read(function (err, content) {
                excludeContents = err ? "" : content;
                finish();
            });

            FileSystem.getFileForPath(gitRoot + ".gitignore").read(function (err, content) {
                gitignoreContents = err ? "" : content;
                finish();
            });

        });
    }

    function refreshIgnoreEntries() {
        function regexEscape(str) {
            // NOTE: We cannot use StringUtils.regexEscape() here because we don't wanna replace *
            return str.replace(/([.?+\^$\\(){}|])/g, "\\$1");
        }

        return loadIgnoreContents().then(function (content) {
            var gitRoot = Preferences.get("currentGitRoot");

            ignoreEntries = _.compact(_.map(content.split("\n"), function (line) {
                // Rules: http://git-scm.com/docs/gitignore
                var type = "deny",
                    leadingSlash,
                    trailingSlash,
                    regex;

                line = line.trim();
                if (!line || line.indexOf("#") === 0) {
                    return;
                }

                // handle explicitly allowed files/folders with a leading !
                if (line.indexOf("!") === 0) {
                    line = line.slice(1);
                    type = "accept";
                }
                // handle lines beginning with a backslash, which is used for escaping ! or #
                if (line.indexOf("\\") === 0) {
                    line = line.slice(1);
                }
                // handle lines beginning with a slash, which only matches files/folders in the root dir
                if (line.indexOf("/") === 0) {
                    line = line.slice(1);
                    leadingSlash = true;
                }
                // handle lines ending with a slash, which only exludes dirs
                if (line.lastIndexOf("/") === line.length) {
                    // a line ending with a slash ends with **
                    line += "**";
                    trailingSlash = true;
                }

                // NOTE: /(.{0,})/ is basically the same as /(.*)/, but we can't use it because the asterisk
                // would be replaced later on

                // create the intial regexp here. We need the absolute path 'cause it could be that there
                // are external files with the same name as a project file
                regex = regexEscape(gitRoot) + (leadingSlash ? "" : "((.+)/)?") + regexEscape(line) + (trailingSlash ? "" : "(/.{0,})?");
                // replace all the possible asterisks
                regex = regex.replace(/\*\*$/g, "(.{0,})").replace(/(\*\*|\*$)/g, "(.+)").replace(/\*/g, "([^/]*)");
                regex = "^" + regex + "$";

                return {
                    regexp: new RegExp(regex),
                    type: type
                };
            }));
        });
    }

    function isIgnored(path) {
        var ignored = false;
        _.forEach(ignoreEntries, function (entry) {
            if (entry.regexp.test(path)) {
                ignored = (entry.type === "deny");
            }
        });
        return ignored;
    }

    function isNew(fullPath) {
        return newPaths.indexOf(fullPath) !== -1;
    }

    function isModified(fullPath) {
        return modifiedPaths.indexOf(fullPath) !== -1;
    }

    ProjectManager.addClassesProvider(function (data) {
        var fullPath = data.fullPath;
        if (isIgnored(fullPath)) {
            return "git-ignored";
        } else if (isNew(fullPath)) {
            return "git-new";
        } else if (isModified(fullPath)) {
            return "git-modified";
        }
    });

    function _refreshOpenFiles() {
        $("#working-set-list-container").find("li").each(function () {
            var $li = $(this),
                data = $li.data("file");
            if (data) {
                var fullPath = data.fullPath;
                $li.toggleClass("git-ignored", isIgnored(fullPath))
                   .toggleClass("git-new", isNew(fullPath))
                   .toggleClass("git-modified", isModified(fullPath));
            }
        });
    }

    var refreshOpenFiles = _.debounce(function () {
        _refreshOpenFiles();
    }, 100);

    function attachEvents() {
        $("#working-set-list-container").on("contentChanged", refreshOpenFiles).triggerHandler("contentChanged");
    }

    function detachEvents() {
        $("#working-set-list-container").off("contentChanged", refreshOpenFiles);
    }

    // this will refresh ignore entries when .gitignore is modified
    EventEmitter.on(Events.BRACKETS_FILE_CHANGED, function (file) {
        if (file.fullPath === Preferences.get("currentGitRoot") + ".gitignore") {
            refreshIgnoreEntries().finally(function () {
                refreshOpenFiles();
            });
        }
    });

    // this will refresh new/modified paths on every status results
    EventEmitter.on(Events.GIT_STATUS_RESULTS, function (files) {
        var gitRoot = Preferences.get("currentGitRoot");

        newPaths = [];
        modifiedPaths = [];

        files.forEach(function (entry) {
            var isNew = entry.status.indexOf(Git.FILE_STATUS.UNTRACKED) !== -1 ||
                        entry.status.indexOf(Git.FILE_STATUS.ADDED) !== -1;

            var fullPath = gitRoot + entry.file;
            if (isNew) {
                newPaths.push(fullPath);
            } else {
                modifiedPaths.push(fullPath);
            }
        });

        ProjectManager.rerenderTree();
        refreshOpenFiles();
    });

    // this will refresh ignore entries when git project is opened
    EventEmitter.on(Events.GIT_ENABLED, function () {
        refreshIgnoreEntries();
        attachEvents();
    });

    // this will clear entries when non-git project is opened
    EventEmitter.on(Events.GIT_DISABLED, function () {
        ignoreEntries = [];
        newPaths      = [];
        modifiedPaths = [];
        detachEvents();
    });

});

define("src/Remotes", function (require) {

    // Brackets modules
    var _               = brackets.getModule("thirdparty/lodash"),
        DefaultDialogs  = brackets.getModule("widgets/DefaultDialogs"),
        Dialogs         = brackets.getModule("widgets/Dialogs"),
        Mustache        = brackets.getModule("thirdparty/mustache/mustache"),
        Metrics         = brackets.getModule("utils/Metrics"),
        Strings         = brackets.getModule("strings"),
        StringUtils     = brackets.getModule("utils/StringUtils");

    // Local modules
    var ErrorHandler    = require("src/ErrorHandler"),
        Events          = require("src/Events"),
        EventEmitter    = require("src/EventEmitter"),
        Git             = require("src/git/Git"),
        Preferences     = require("src/Preferences"),
        ProgressDialog  = require("src/dialogs/Progress"),
        PullDialog      = require("src/dialogs/Pull"),
        PushDialog      = require("src/dialogs/Push"),
        Utils           = require("src/Utils");

    // Templates
    var gitRemotesPickerTemplate = `<!-- List of remotes defined for the current local repository -->
{{#remotes}}
<li class="remote">
    <a href="#" data-remote-name="{{name}}" data-type="git" class="remote-name">
        {{#deletable}}<span class="trash-icon hover-icon remove-remote">&times;</span>{{/deletable}}
        <span class="change-remote">{{name}}</span>
    </a>
</li>
{{/remotes}}
<li><a class="git-remote-new"><span>{{Strings.CREATE_NEW_REMOTE}}</span></a></li>
`;

    // Module variables
    var $selectedRemote  = null,
        $remotesDropdown = null,
        $gitPanel = null,
        $gitPush = null;

    function initVariables() {
        $gitPanel = $("#git-panel");
        $selectedRemote = $gitPanel.find(".git-selected-remote");
        $remotesDropdown = $gitPanel.find(".git-remotes-dropdown");
        $gitPush = $gitPanel.find(".git-push");
    }

    // Implementation

    function getDefaultRemote(allRemotes) {
        var defaultRemotes = Preferences.get("defaultRemotes") || {},
            candidate = defaultRemotes[Preferences.get("currentGitRoot")];

        var exists = _.find(allRemotes, function (remote) {
            return remote.name === candidate;
        });
        if (!exists) {
            candidate = null;
            if (allRemotes.length > 0) {
                candidate = _.first(allRemotes).name;
            }
        }

        return candidate;
    }

    function setDefaultRemote(remoteName) {
        var defaultRemotes = Preferences.get("defaultRemotes") || {};
        defaultRemotes[Preferences.get("currentGitRoot")] = remoteName;
        Preferences.set("defaultRemotes", defaultRemotes);
    }

    function clearRemotePicker() {
        $selectedRemote
            .html("&mdash;")
            .data("remote", null);
    }

    function selectRemote(remoteName, type) {
        if (!remoteName) {
            return clearRemotePicker();
        }

        // Set as default remote only if is a normal git remote
        if (type === "git") { setDefaultRemote(remoteName); }

        // Disable pull if it is not a normal git remote
        $gitPanel.find(".git-pull").prop("disabled", type !== "git");

        // Enable push and set selected-remote-type to Git push button by type of remote
        $gitPush
            .prop("disabled", false)
            .attr("x-selected-remote-type", type);

        // Update remote name of $selectedRemote
        $selectedRemote
            .text(remoteName)
            .attr("data-type", type) // use attr to apply CSS styles
            .data("remote", remoteName);
    }

    function refreshRemotesPicker() {
        Git.getRemotes().then(function (remotes) {
            // Set default remote name and cache the remotes dropdown menu
            var defaultRemoteName = getDefaultRemote(remotes);

            // Disable Git-push and Git-pull if there are not remotes defined
            $gitPanel
                .find(".git-pull, .git-push, .git-fetch")
                .prop("disabled", remotes.length === 0);

            // Add options to change remote
            remotes.forEach(function (remote) {
                remote.deletable = remote.name !== "origin";
            });

            // Pass to Mustache the needed data
            var compiledTemplate = Mustache.render(gitRemotesPickerTemplate, {
                Strings: Strings,
                remotes: remotes
            });

            // Inject the rendered template inside the $remotesDropdown
            $remotesDropdown.html(compiledTemplate);

            // Notify others that they may add more stuff to this dropdown
            EventEmitter.emit(Events.REMOTES_REFRESH_PICKER);
            // TODO: is it possible to wait for listeners to finish?

            // TODO: if there're no remotes but there are some ftp remotes
            // we need to adjust that something other may be put as default
            // low priority
            if (remotes.length > 0) {
                selectRemote(defaultRemoteName, "git");
            } else {
                clearRemotePicker();
            }
        }).catch(function (err) {
            ErrorHandler.showError(err, Strings.ERROR_GETTING_REMOTES);
        });
    }

    function handleRemoteCreation() {
        return Utils.askQuestion(Strings.CREATE_NEW_REMOTE, Strings.ENTER_REMOTE_NAME)
            .then(function (name) {
                return Utils.askQuestion(Strings.CREATE_NEW_REMOTE, Strings.ENTER_REMOTE_URL).then(function (url) {
                    return [name, url];
                });
            })
            .then(function ([name, url]) {
                return Git.createRemote(name, url).then(function () {
                    return refreshRemotesPicker();
                });
            })
            .catch(function (err) {
                if (!ErrorHandler.equals(err, Strings.USER_ABORTED)) {
                    ErrorHandler.showError(err, Strings.ERROR_REMOTE_CREATION);
                }
            });
    }

    function deleteRemote(remoteName) {
        return Utils.askQuestion(Strings.DELETE_REMOTE, StringUtils.format(Strings.DELETE_REMOTE_NAME, remoteName), { booleanResponse: true })
            .then(function (response) {
                if (response === true) {
                    return Git.deleteRemote(remoteName).then(function () {
                        return refreshRemotesPicker();
                    });
                }
            })
            .catch(function (err) {
                ErrorHandler.logError(err);
            });
    }

    function showPushResult(result) {
        if (typeof result.remoteUrl === "string") {
            result.remoteUrl = Utils.encodeSensitiveInformation(result.remoteUrl);
        }

        var template = [
            "<h3>{{flagDescription}}</h3>",
            "Info:",
            "Remote url - {{remoteUrl}}",
            "Local branch - {{from}}",
            "Remote branch - {{to}}",
            "Summary - {{summary}}",
            "<h4>Status - {{status}}</h4>"
        ].join("<br>");

        Dialogs.showModalDialog(
            DefaultDialogs.DIALOG_ID_INFO,
            Strings.GIT_PUSH_RESPONSE, // title
            Mustache.render(template, result) // message
        );
    }

    function pushToRemote(remote) {
        if (!remote) {
            return ErrorHandler.showError(StringUtils.format(Strings.ERROR_NO_REMOTE_SELECTED, "push"));
        }

        var pushConfig = {
            remote: remote
        };

        PushDialog.show(pushConfig)
            .then(function (pushConfig) {
                var q = Promise.resolve(),
                    additionalArgs = [];

                if (pushConfig.tags) {
                    additionalArgs.push("--tags");
                }
                if (pushConfig.noVerify) {
                    additionalArgs.push("--no-verify");
                }

                // set a new tracking branch if desired
                if (pushConfig.branch && pushConfig.setBranchAsTracking) {
                    q = q.then(function () {
                        return Git.setUpstreamBranch(pushConfig.remote, pushConfig.branch);
                    });
                }
                // put username and password into remote url
                if (pushConfig.remoteUrlNew) {
                    q = q.then(function () {
                        return Git.setRemoteUrl(pushConfig.remote, pushConfig.remoteUrlNew);
                    });
                }
                // do the pull itself (we are not using pull command)
                q = q.then(function () {
                    let op;
                    const progressTracker = ProgressDialog.newProgressTracker();
                    if (pushConfig.pushToNew) {
                        op = Git.pushToNewUpstream(pushConfig.remote, pushConfig.branch, {
                            noVerify: true, progressTracker});
                    } else if (pushConfig.strategy === "DEFAULT") {
                        op = Git.push(pushConfig.remote, pushConfig.branch, additionalArgs, progressTracker);
                    } else if (pushConfig.strategy === "FORCED") {
                        op = Git.pushForced(pushConfig.remote, pushConfig.branch, {
                            noVerify: true, progressTracker});
                    } else if (pushConfig.strategy === "DELETE_BRANCH") {
                        op = Git.deleteRemoteBranch(pushConfig.remote, pushConfig.branch, {
                            noVerify: true, progressTracker});
                    }
                    return ProgressDialog.show(op, progressTracker)
                        .then(function (result) {
                            return ProgressDialog.waitForClose().then(function () {
                                Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'push', "success");
                                showPushResult(result);
                            });
                        })
                        .catch(function (err) {
                            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'push', "fail");
                            ErrorHandler.showError(err, Strings.ERROR_PUSHING_REMOTE, {errorMetric: "push"});
                        });
                });
                // restore original url if desired
                if (pushConfig.remoteUrlRestore) {
                    q = q.finally(function () {
                        return Git.setRemoteUrl(pushConfig.remote, pushConfig.remoteUrlRestore);
                    });
                }

                return q.finally(function () {
                    EventEmitter.emit(Events.REFRESH_ALL);
                });
            })
            .catch(function (err) {
                // when dialog is cancelled, there's no error
                if (err) { ErrorHandler.showError(err, Strings.ERROR_PUSHING_OPERATION); }
            });
    }

    function pullFromRemote(remote) {
        if (!remote) {
            return ErrorHandler.showError(StringUtils.format(Strings.ERROR_NO_REMOTE_SELECTED, "pull"));
        }

        var pullConfig = {
            remote: remote
        };

        PullDialog.show(pullConfig)
            .then(function (pullConfig) {
                var q = Promise.resolve();

                // set a new tracking branch if desired
                if (pullConfig.branch && pullConfig.setBranchAsTracking) {
                    q = q.then(function () {
                        return Git.setUpstreamBranch(pullConfig.remote, pullConfig.branch);
                    });
                }
                // put username and password into remote url
                if (pullConfig.remoteUrlNew) {
                    q = q.then(function () {
                        return Git.setRemoteUrl(pullConfig.remote, pullConfig.remoteUrlNew);
                    });
                }
                // do the pull itself (we are not using pull command)
                q = q.then(function () {
                    // fetch the remote first
                    const progressTracker = ProgressDialog.newProgressTracker();
                    return ProgressDialog.show(Git.fetchRemote(pullConfig.remote, progressTracker), progressTracker)
                        .then(function () {
                            if (pullConfig.strategy === "DEFAULT") {
                                return Git.mergeRemote(pullConfig.remote, pullConfig.branch,
                                    false, false, {progressTracker});
                            } else if (pullConfig.strategy === "AVOID_MERGING") {
                                return Git.mergeRemote(pullConfig.remote, pullConfig.branch,
                                    true, false, {progressTracker});
                            } else if (pullConfig.strategy === "MERGE_NOCOMMIT") {
                                return Git.mergeRemote(pullConfig.remote, pullConfig.branch,
                                    false, true, {progressTracker});
                            } else if (pullConfig.strategy === "REBASE") {
                                return Git.rebaseRemote(pullConfig.remote, pullConfig.branch, progressTracker);
                            } else if (pullConfig.strategy === "RESET") {
                                return Git.resetRemote(pullConfig.remote, pullConfig.branch, progressTracker);
                            }
                        })
                        .then(function (result) {
                            return ProgressDialog.waitForClose().then(function () {
                                // Git writes status messages (including informational messages) to stderr,
                                // even when the command succeeds. For example, during `git pull --rebase`,
                                // the "Successfully rebased and updated" message is sent to stderr,
                                // leaving the result as empty in stdout.
                                // If we reach this point, the command has succeeded,
                                // so we display a success message if `result` is "".
                                Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'pull', "success");
                                return Utils.showOutput(result || Strings.GIT_PULL_SUCCESS,
                                    Strings.GIT_PULL_RESPONSE);
                            });
                        })
                        .catch(function (err) {
                            Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'pull', "fail");
                            ErrorHandler.showError(err, Strings.ERROR_PULLING_REMOTE, {errorMetric: "pull"});
                        });
                });
                // restore original url if desired
                if (pullConfig.remoteUrlRestore) {
                    q = q.finally(function () {
                        return Git.setRemoteUrl(pullConfig.remote, pullConfig.remoteUrlRestore);
                    });
                }

                return q.finally(function () {
                    EventEmitter.emit(Events.REFRESH_ALL);
                });
            })
            .catch(function (err) {
                // when dialog is cancelled, there's no error
                if (err) { ErrorHandler.showError(err, Strings.ERROR_PULLING_OPERATION); }
            });
    }

    function handleFetch() {

        // Tell the rest of the plugin that the fetch has started
        EventEmitter.emit(Events.FETCH_STARTED);

        const tracker = ProgressDialog.newProgressTracker();
        return ProgressDialog.show(Git.fetchAllRemotes(tracker), tracker)
            .then(()=>{
                Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'fetch', "success");
            })
            .catch(function (err) {
                Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'fetch', "fail");
                ErrorHandler.showError(err, undefined, {errorMetric: "fetch"});
            })
            .then(ProgressDialog.waitForClose)
            .finally(function () {
                EventEmitter.emit(Events.FETCH_COMPLETE);
            });
    }

    // Event subscriptions
    EventEmitter.on(Events.GIT_ENABLED, function () {
        initVariables();
        refreshRemotesPicker();
    });
    EventEmitter.on(Events.HANDLE_REMOTE_PICK, function (event) {
        var $remote     = $(event.target).closest(".remote-name"),
            remoteName  = $remote.data("remote-name"),
            type        = $remote.data("type");
        selectRemote(remoteName, type);
        EventEmitter.emit(Events.REFRESH_COUNTERS);
    });
    EventEmitter.on(Events.HANDLE_REMOTE_CREATE, function () {
        handleRemoteCreation();
    });
    EventEmitter.on(Events.HANDLE_REMOTE_DELETE, function (event) {
        var remoteName = $(event.target).closest(".remote-name").data("remote-name");
        deleteRemote(remoteName);
    });
    EventEmitter.on(Events.HANDLE_PULL, function () {
        var remoteName = $selectedRemote.data("remote");
        pullFromRemote(remoteName);
    });
    EventEmitter.on(Events.HANDLE_PUSH, function () {
        var remoteName = $selectedRemote.data("remote");
        pushToRemote(remoteName);
    });
    EventEmitter.on(Events.HANDLE_FETCH, function () {
        handleFetch();
    });

});

define("src/SettingsDialog", function (require, exports) {

    // Brackets modules
    const Dialogs                 = brackets.getModule("widgets/Dialogs"),
        Mustache                = brackets.getModule("thirdparty/mustache/mustache"),
        Preferences             = require("./Preferences"),
        Strings             = brackets.getModule("strings"),
        Git                     = require("./git/Git"),
        Setup                   = require("src/utils/Setup"),
        settingsDialogTemplate  = `<div id="git-settings-dialog" class="git modal">
    <div class="modal-header">
        <h1 class="dialog-title">{{Strings.GIT_SETTINGS_TITLE}}</h1>
    </div>
    <div class="modal-body" style="max-height: fit-content;">
        <div>
            <label for="git-settings-enableGit">
                <input id="git-settings-enableGit" type="checkbox" settingsProperty="enableGit" />
                {{Strings.ENABLE_GIT}}&nbsp;&nbsp;<i title="{{Strings.REQUIRES_APP_RESTART_SETTING}}" class="settings-info-i fa-solid fa-circle-info"></i>
            </label>
        </div>
        <div class="git-settings-content {{#gitDisabled}}forced-inVisible{{/gitDisabled}}">
            <!-- #features -->
            <div>
                <div>
                    <label for="git-settings-stripWhitespaceFromCommits">
                        <input id="git-settings-stripWhitespaceFromCommits" type="checkbox" settingsProperty="stripWhitespaceFromCommits" />
                        {{Strings.STRIP_WHITESPACE_FROM_COMMITS}}
                    </label>
                </div>
                <div>
                    <label for="git-settings-addEndlineToTheEndOfFile">
                        <input id="git-settings-addEndlineToTheEndOfFile" type="checkbox" settingsProperty="addEndlineToTheEndOfFile" />
                        {{Strings.ADD_ENDLINE_TO_THE_END_OF_FILE}}
                    </label>
                </div>
            </div>
            <div>
                <div>
                    <label for="git-settings-removeByteOrderMark">
                        <input id="git-settings-removeByteOrderMark" type="checkbox" settingsProperty="removeByteOrderMark" />
                        {{Strings.REMOVE_BOM}}
                    </label>
                </div>
                <div>
                    <label for="git-settings-normalizeLineEndings">
                        <input id="git-settings-normalizeLineEndings" type="checkbox" settingsProperty="normalizeLineEndings" />
                        {{Strings.NORMALIZE_LINE_ENDINGS}}
                    </label>
                </div>
            </div>
            <div>
                <div>
                    <label for="git-settings-useGitGutter">
                        <input id="git-settings-useGitGutter" type="checkbox" settingsProperty="useGitGutter" />
                        {{Strings.USE_GIT_GUTTER}}&nbsp;&nbsp;<i title="{{Strings.REQUIRES_APP_RESTART_SETTING}}" class="settings-info-i fa-solid fa-circle-info"></i>
                    </label>
                </div>
                <div>
                    <label for="git-settings-markModifiedInTree">
                        <input id="git-settings-markModifiedInTree" type="checkbox" settingsProperty="markModifiedInTree" />
                        {{Strings.MARK_MODIFIED_FILES_IN_TREE}}&nbsp;&nbsp;<i title="{{Strings.REQUIRES_APP_RESTART_SETTING}}" class="settings-info-i fa-solid fa-circle-info"></i>
                    </label>
                </div>
            </div>
            <div>
                <div>
                    <label for="git-settings-useVerboseDiff">
                        <input id="git-settings-useVerboseDiff" type="checkbox" settingsProperty="useVerboseDiff" />
                        {{Strings.USE_VERBOSE_DIFF}}
                    </label>
                </div>
                <div>
                    <label for="git-settings-useDifftool">
                        <input id="git-settings-useDifftool" type="checkbox" settingsProperty="useDifftool" />
                        {{Strings.USE_DIFFTOOL}}
                    </label>
                </div>
            </div>
            <div>
                <div>
                    <label for="git-settings-clearWhitespaceOnSave">
                        <input id="git-settings-clearWhitespaceOnSave" type="checkbox" settingsProperty="clearWhitespaceOnSave" />
                        {{Strings.CLEAR_WHITESPACE_ON_FILE_SAVE}}
                    </label>
                </div>
            </div>
            <!-- /features -->
            <!-- #gitConfig -->
            <h4>{{Strings.SYSTEM_CONFIGURATION}}</h4>
            <div class="row-fluid">
                {{#gitNotFound}}
                <div class="alert alert-warning">
                    {{Strings.GIT_NOT_FOUND_MESSAGE}}
                </div>
                {{/gitNotFound}}
                <label for="git-settings-gitPath">
                    {{Strings.PATH_TO_GIT_EXECUTABLE}}:&nbsp;&nbsp;
                    {{#gitNotFound}}
                    <i title="{{Strings.REQUIRES_APP_RESTART_SETTING}}" class="settings-info-i fa-solid fa-circle-info"></i>
                    {{/gitNotFound}}
                </label>
                <input id="git-settings-gitPath" type="text" settingsProperty="gitPath" autocomplete="off" spellcheck="false"/>
            </div>
            <div class="row-fluid">
                <label for="git-settings-gitTimeout">{{Strings.DEFAULT_GIT_TIMEOUT}}:</label>
                <input id="git-settings-gitTimeout" type="number" settingsProperty="gitTimeout" />
            </div>
            <!-- /gitConfig -->
        </div>


    </div>
    <div class="modal-footer">
        <button data-button-id="defaults"  class="dialog-button btn left"          >{{Strings.BUTTON_DEFAULTS}}</button>
        <button data-button-id="cancel"    class="dialog-button btn cancel btn-80" >{{Strings.BUTTON_CANCEL}}</button>
        <button data-button-id="ok"        class="dialog-button btn primary btn-80">{{Strings.BUTTON_SAVE}}</button>
    </div>
</div>
`;

    var dialog,
        $dialog;

    function setValues(values) {
        $("*[settingsProperty]", $dialog).each(function () {
            var $this = $(this),
                type = $this.attr("type"),
                tag = $this.prop("tagName").toLowerCase(),
                property = $this.attr("settingsProperty");
            if (type === "checkbox") {
                $this.prop("checked", values[property]);
            } else if (tag === "select") {
                $("option[value=" + values[property] + "]", $this).prop("selected", true);
            } else {
                $this.val(values[property]);
            }
        });
    }

    function collectDialogValues() {
        $("*[settingsProperty]", $dialog).each(function () {
            var $this = $(this),
                type = $this.attr("type"),
                property = $this.attr("settingsProperty"),
                prefType = Preferences.getType(property);
            if (type === "checkbox") {
                Preferences.set(property, $this.prop("checked"));
            } else if (prefType === "number") {
                var newValue = parseInt($this.val().trim(), 10);
                if (isNaN(newValue)) { newValue = Preferences.getDefaults()[property]; }
                Preferences.set(property, newValue);
            } else {
                Preferences.set(property, $this.val().trim() || null);
            }
        });
        Preferences.save();
    }

    function assignActions() {
        var $useDifftoolCheckbox = $("#git-settings-useDifftool", $dialog);

        Git.getConfig("diff.tool").then(function (diffToolConfiguration) {

            if (!diffToolConfiguration) {
                $useDifftoolCheckbox.prop({
                    checked: false,
                    disabled: true
                });
            } else {
                $useDifftoolCheckbox.prop({
                    disabled: false
                });
            }

        }).catch(function () {

            // an error with git
            // we were not able to check whether diff tool is configured or not
            // so we disable it just to be sure
            $useDifftoolCheckbox.prop({
                checked: false,
                disabled: true
            });

        });

        $("#git-settings-stripWhitespaceFromCommits", $dialog).on("change", function () {
            var on = $(this).is(":checked");
            $("#git-settings-addEndlineToTheEndOfFile,#git-settings-removeByteOrderMark,#git-settings-normalizeLineEndings", $dialog)
                .prop("checked", on)
                .prop("disabled", !on);
        });

        $("button[data-button-id='defaults']", $dialog).on("click", function (e) {
            e.stopPropagation();
            setValues(Preferences.getDefaults());
        });
    }

    function init() {
        setValues(Preferences.getAll());
        assignActions();
    }

    exports.show = function () {
        const enableGitPreference = Preferences.get("enableGit");
        const compiledTemplate = Mustache.render(settingsDialogTemplate, {
            Strings,
            gitDisabled: !enableGitPreference,
            gitNotFound: enableGitPreference ? !Setup.isExtensionActivated() : false
        });

        dialog = Dialogs.showModalDialogUsingTemplate(compiledTemplate);
        $dialog = dialog.getElement();

        init();
        $dialog.find("#git-settings-enableGit").on("change", function () {
            const anyChecked = $dialog.find("#git-settings-enableGit:checked").length > 0;
            if (anyChecked) {
                $dialog.find(".git-settings-content").removeClass("forced-inVisible");
            } else {
                $dialog.find(".git-settings-content").addClass("forced-inVisible");
            }
        });

        dialog.done(function (buttonId) {
            if (buttonId === "ok") {
                // Save everything to preferences
                collectDialogValues();
            }
        });
    };
});

/*globals jsPromise, logger*/
define("src/Utils", function (require, exports, module) {

    // Brackets modules
    const _               = brackets.getModule("thirdparty/lodash"),
        CommandManager  = brackets.getModule("command/CommandManager"),
        Commands        = brackets.getModule("command/Commands"),
        Dialogs         = brackets.getModule("widgets/Dialogs"),
        DocumentManager = brackets.getModule("document/DocumentManager"),
        FileSystem      = brackets.getModule("filesystem/FileSystem"),
        FileUtils       = brackets.getModule("file/FileUtils"),
        LanguageManager = brackets.getModule("language/LanguageManager"),
        Mustache        = brackets.getModule("thirdparty/mustache/mustache"),
        ProjectManager  = brackets.getModule("project/ProjectManager");

    // Local modules
    const ErrorHandler    = require("src/ErrorHandler"),
        Events          = require("src/Events"),
        EventEmitter    = require("src/EventEmitter"),
        Git             = require("src/git/Git"),
        Preferences     = require("src/Preferences"),
        Setup           = require("src/utils/Setup"),
        Constants       = require("src/Constants"),
        Strings         = brackets.getModule("strings");

    const FORMAT_DIFF_TOO_LARGE = "<div>" + Strings.DIFF_TOO_LONG + "</div>";

    // Module variables
    const formatDiffTemplate      = `<table>
    <tbody>
        {{#files}}
            <tr class="meta-file">
                <th colspan="3">{{name}}</th>
            </tr>
            {{#lines}}
                <tr class="diff-row {{lineClass}}">
                    <td class="row-num">{{numLineOld}}</td>
                    <td class="row-num">{{numLineNew}}</td>
                    <td><pre>{{{line}}}</pre></td>
                </tr>
            {{/lines}}
            <tr class="separator"></tr>
        {{/files}}
    </tbody>
</table>
`,
        questionDialogTemplate  = `<div id="git-question-dialog" class="modal">
    <div class="modal-header">
        <h1 class="dialog-title">{{title}}</h1>
    </div>
    <div class="modal-body table-striped tab-content">
        <p>{{{question}}}</p>
        {{#stringInput}}
        <input class="stringInput" type="text" value="{{defaultValue}}" autocomplete="off" spellcheck="false" />
        {{/stringInput}}
        {{#passwordInput}}
        <input class="stringInput" type="password" value="{{defaultValue}}" autocomplete="off" spellcheck="false" />
        {{/passwordInput}}
    </div>
    <div class="modal-footer">
        <button data-button-id="cancel" class="dialog-button btn cancel btn-80" >{{Strings.BUTTON_CANCEL}}</button>
        <button data-button-id="ok"     class="dialog-button btn btn-80 {{#customOkBtnClass}}{{customOkBtnClass}}{{/customOkBtnClass}}{{^customOkBtnClass}}primary{{/customOkBtnClass}}">
            {{#customOkBtn}}{{customOkBtn}}{{/customOkBtn}}{{^customOkBtn}}{{Strings.BUTTON_OK}}{{/customOkBtn}}
        </button>
    </div>
</div>
`,
        outputDialogTemplate    = `<div id="git-output-dialog" class="modal">
    {{#title}}
    <div class="modal-header">
        <h1 class="dialog-title">{{title}}</h1>
    </div>
    {{/title}}
    <div class="modal-body table-striped tab-content">
        <pre class="git-output">{{{output}}}</pre>
        {{#question}}
        <h4>{{question}}</h4>
        {{/question}}
    </div>
    <div class="modal-footer">
        <button data-button-id="close" class="dialog-button btn btn-80">{{Strings.BUTTON_CLOSE}}</button>
        {{#question}}
        <button data-button-id="ok"    class="dialog-button btn primary btn-80">{{Strings.BUTTON_OK}}</button>
        {{/question}}
    </div>
</div>
`,
        writeTestResults        = {},
        EXT_NAME                = "[brackets-git] ";

    // Implementation
    function getProjectRoot() {
        var projectRoot = ProjectManager.getProjectRoot();
        return projectRoot ? projectRoot.fullPath : null;
    }

    // returns "C:/Users/Zaggi/AppData/Roaming/Brackets/extensions/user/zaggino.brackets-git/"
    function getExtensionDirectory() {
        throw new Error("api unsupported");
        // var modulePath = ExtensionUtils.getModulePath(module);
        // return modulePath.slice(0, -1 * "src/".length);
    }

    function formatDiff(diff) {
        var DIFF_MAX_LENGTH = 2000;

        var tabReplace   = "",
            verbose      = Preferences.get("useVerboseDiff"),
            numLineOld   = 0,
            numLineNew   = 0,
            lastStatus   = 0,
            diffData     = [];

        var i = Preferences.getGlobal("tabSize");
        while (i--) {
            tabReplace += "&nbsp;";
        }

        var LINE_STATUS = {
            HEADER: 0,
            UNCHANGED: 1,
            REMOVED: 2,
            ADDED: 3,
            EOF: 4
        };

        var diffSplit = diff.split("\n");

        if (diffSplit.length > DIFF_MAX_LENGTH) {
            return "" + FORMAT_DIFF_TOO_LARGE; // create new str to return
        }

        diffSplit.forEach(function (line) {
            if (line === " ") { line = ""; }

            var lineClass   = "",
                pushLine    = true;

            if (line.indexOf("diff --git") === 0) {
                lineClass = "diffCmd";

                diffData.push({
                    name: line.split("b/")[1],
                    lines: []
                });

                if (!verbose) {
                    pushLine = false;
                }
            } else if (line.match(/index\s[A-z0-9]{7}\.\.[A-z0-9]{7}/)) {
                if (!verbose) {
                    pushLine = false;
                }
            } else if (line.substr(0, 3) === "+++" || line.substr(0, 3) === "---") {
                if (!verbose) {
                    pushLine = false;
                }
            } else if (line.indexOf("@@") === 0) {
                lineClass = "position";

                // Define the type of the line: Header
                lastStatus = LINE_STATUS.HEADER;

                // This read the start line for the diff and substract 1 for this line
                var m = line.match(/^@@ -([,0-9]+) \+([,0-9]+) @@/);
                var s1 = m[1].split(",");
                var s2 = m[2].split(",");

                numLineOld = s1[0] - 1;
                numLineNew = s2[0] - 1;
            } else if (line[0] === "+") {
                lineClass = "added";
                line = line.substring(1);

                // Define the type of the line: Added
                lastStatus = LINE_STATUS.ADDED;

                // Add 1 to the num line for new document
                numLineNew++;
            } else if (line[0] === "-") {
                lineClass = "removed";
                line = line.substring(1);

                // Define the type of the line: Removed
                lastStatus = LINE_STATUS.REMOVED;

                // Add 1 to the num line for old document
                numLineOld++;
            } else if (line[0] === " " || line === "") {
                lineClass = "unchanged";
                line = line.substring(1);

                // Define the type of the line: Unchanged
                lastStatus = LINE_STATUS.UNCHANGED;

                // Add 1 to old a new num lines
                numLineOld++;
                numLineNew++;
            } else if (line === "\\ No newline at end of file") {
                lastStatus = LINE_STATUS.EOF;
                lineClass = "end-of-file";
            } else {
                console.log("Unexpected line in diff: " + line);
            }

            if (pushLine) {
                var _numLineOld = "",
                    _numLineNew = "";

                switch (lastStatus) {
                    case LINE_STATUS.HEADER:
                    case LINE_STATUS.EOF:
                        // _numLineOld = "";
                        // _numLineNew = "";
                        break;
                    case LINE_STATUS.UNCHANGED:
                        _numLineOld = numLineOld;
                        _numLineNew = numLineNew;
                        break;
                    case LINE_STATUS.REMOVED:
                        _numLineOld = numLineOld;
                        // _numLineNew = "";
                        break;
                    // case LINE_STATUS.ADDED:
                    default:
                        // _numLineOld = "";
                        _numLineNew = numLineNew;
                }

                // removes ZERO WIDTH NO-BREAK SPACE character (BOM)
                line = line.replace(/\uFEFF/g, "");

                // exposes other potentially harmful characters
                line = line.replace(/[\u2000-\uFFFF]/g, function (x) {
                    return "<U+" + x.charCodeAt(0).toString(16).toUpperCase() + ">";
                });

                line = _.escape(line)
                    .replace(/\t/g, tabReplace)
                    .replace(/\s/g, "&nbsp;");

                line = line.replace(/(&nbsp;)+$/g, function (trailingWhitespace) {
                    return "<span class='trailingWhitespace'>" + trailingWhitespace + "</span>";
                });

                if (diffData.length > 0) {
                    _.last(diffData).lines.push({
                        "numLineOld": _numLineOld,
                        "numLineNew": _numLineNew,
                        "line": line,
                        "lineClass": lineClass
                    });
                }
            }
        });

        return Mustache.render(formatDiffTemplate, { files: diffData });
    }

    function askQuestion(title, question, options) {
        return new Promise(function (resolve, reject) {
            options = options || {};

            if (!options.noescape) {
                question = _.escape(question);
            }

            var compiledTemplate = Mustache.render(questionDialogTemplate, {
                title: title,
                question: question,
                stringInput: !options.booleanResponse && !options.password,
                passwordInput: options.password,
                defaultValue: options.defaultValue,
                customOkBtn: options.customOkBtn,
                customOkBtnClass: options.customOkBtnClass,
                Strings: Strings
            });

            var dialog  = Dialogs.showModalDialogUsingTemplate(compiledTemplate),
                $dialog = dialog.getElement();

            _.defer(function () {
                var $input = $dialog.find("input:visible");
                if ($input.length > 0) {
                    $input.focus();
                } else {
                    $dialog.find(".primary").focus();
                }
            });

            dialog.done(function (buttonId) {
                if (options.booleanResponse) {
                    return resolve(buttonId === "ok");
                }
                if (buttonId === "ok") {
                    resolve(dialog.getElement().find("input").val().trim());
                } else {
                    reject(Strings.USER_ABORTED);
                }
            });
        });
    }

    function showOutput(output, title, options) {
        return new Promise(function (resolve) {
            options = options || {};
            var compiledTemplate = Mustache.render(outputDialogTemplate, {
                title: title,
                output: output,
                Strings: Strings,
                question: options.question
            });
            var dialog = Dialogs.showModalDialogUsingTemplate(compiledTemplate);
            dialog.getElement().find("button").focus();
            dialog.done(function (buttonId) {
                resolve(buttonId === "ok");
            });
        });
    }

    function isProjectRootWritable() {
        return new Promise(function (resolve) {

            var folder = getProjectRoot();

            // if we previously tried, assume nothing has changed
            if (writeTestResults[folder]) {
                return resolve(writeTestResults[folder]);
            }

            // create entry for temporary file
            var fileEntry = FileSystem.getFileForPath(folder + ".phoenixGitTemp");

            function finish(bool) {
                // delete the temp file and resolve
                fileEntry.unlink(function () {
                    writeTestResults[folder] = bool;
                    resolve(bool);
                });
            }

            // try writing some text into the temp file
            jsPromise(FileUtils.writeText(fileEntry, ""))
                .then(function () {
                    finish(true);
                })
                .catch(function () {
                    finish(false);
                });
        });
    }

    function pathExists(path) {
        return new Promise(function (resolve) {
            FileSystem.resolve(path, function (err, entry) {
                resolve(!err && entry ? true : false);
            });
        });
    }

    function loadPathContent(path) {
        return new Promise(function (resolve) {
            FileSystem.resolve(path, function (err, entry) {
                if (err) {
                    return resolve(null);
                }
                if (entry._clearCachedData) {
                    entry._clearCachedData();
                }
                if (entry.isFile) {
                    entry.read(function (err, content) {
                        if (err) {
                            return resolve(null);
                        }
                        resolve(content);
                    });
                } else {
                    entry.getContents(function (err, contents) {
                        if (err) {
                            return resolve(null);
                        }
                        resolve(contents);
                    });
                }
            });
        });
    }

    function isLoading($btn) {
        return $btn.hasClass("btn-loading");
    }

    function setLoading($btn) {
        $btn.prop("disabled", true).addClass("btn-loading");
    }

    function unsetLoading($btn) {
        $btn.prop("disabled", false).removeClass("btn-loading");
    }

    function encodeSensitiveInformation(str) {
        // should match passwords in http/https urls
        str = str.replace(/(https?:\/\/)([^:@\s]*):([^:@]*)?@/g, function (a, protocol, user/*, pass*/) {
            return protocol + user + ":***@";
        });
        // should match user name in windows user folders
        str = str.replace(/(users)(\\|\/)([^\\\/]+)(\\|\/)/i, function (a, users, slash1, username, slash2) {
            return users + slash1 + "***" + slash2;
        });
        return str;
    }

    function consoleWarn(msg) {
        console.warn(encodeSensitiveInformation(msg));
    }

    function consoleError(msg) {
        console.error(encodeSensitiveInformation(msg));
    }

    function consoleDebug(msg) {
        if (logger.loggingOptions.logGit) {
            console.log(EXT_NAME + encodeSensitiveInformation(msg));
        }
    }

    /**
     * Reloads the Document's contents from disk, discarding any unsaved changes in the editor.
     *
     * @param {!Document} doc
     * @return {Promise} Resolved after editor has been refreshed; rejected if unable to load the
     *      file's new content. Errors are logged but no UI is shown.
     */
    function reloadDoc(doc) {
        return jsPromise(FileUtils.readAsText(doc.file))
            .then(function (text) {
                doc.refreshText(text, new Date());
            })
            .catch(function (err) {
                ErrorHandler.logError("Error reloading contents of " + doc.file.fullPath);
                ErrorHandler.logError(err);
            });
    }

    /**
     *  strips trailing whitespace from all the diffs and adds \n to the end
     */
    function stripWhitespaceFromFile(filename, clearWholeFile) {
        return new Promise(function (resolve, reject) {

            var fullPath                  = Preferences.get("currentGitRoot") + filename,
                addEndlineToTheEndOfFile  = Preferences.get("addEndlineToTheEndOfFile"),
                removeBom                 = Preferences.get("removeByteOrderMark"),
                normalizeLineEndings      = Preferences.get("normalizeLineEndings");

            var _cleanLines = function (lineNumbers) {
                // do not clean if there's nothing to clean
                if (lineNumbers && lineNumbers.length === 0) {
                    return resolve();
                }
                // clean the file
                var fileEntry = FileSystem.getFileForPath(fullPath);
                return jsPromise(FileUtils.readAsText(fileEntry))
                    .catch(function (err) {
                        ErrorHandler.logError(err + " on FileUtils.readAsText for " + fileEntry.fullPath);
                        return null;
                    })
                    .then(function (text) {
                        if (text === null) {
                            return resolve();
                        }

                        if (removeBom) {
                            // remove BOM - \uFEFF
                            text = text.replace(/\uFEFF/g, "");
                        }
                        if (normalizeLineEndings) {
                            // normalizes line endings
                            text = text.replace(/\r\n/g, "\n");
                        }
                        // process lines
                        var lines = text.split("\n");

                        if (lineNumbers) {
                            lineNumbers.forEach(function (lineNumber) {
                                if (typeof lines[lineNumber] === "string") {
                                    lines[lineNumber] = lines[lineNumber].replace(/\s+$/, "");
                                }
                            });
                        } else {
                            lines.forEach(function (ln, lineNumber) {
                                if (typeof lines[lineNumber] === "string") {
                                    lines[lineNumber] = lines[lineNumber].replace(/\s+$/, "");
                                }
                            });
                        }

                        // add empty line to the end, i've heard that git likes that for some reason
                        if (addEndlineToTheEndOfFile) {
                            var lastLineNumber = lines.length - 1;
                            if (lines[lastLineNumber].length > 0) {
                                lines[lastLineNumber] = lines[lastLineNumber].replace(/\s+$/, "");
                            }
                            if (lines[lastLineNumber].length > 0) {
                                lines.push("");
                            }
                        }

                        text = lines.join("\n");
                        return jsPromise(FileUtils.writeText(fileEntry, text))
                            .catch(function (err) {
                                ErrorHandler.logError("Wasn't able to clean whitespace from file: " + fullPath);
                                resolve();
                                throw err;
                            })
                            .then(function () {
                                // refresh the file if it's open in the background
                                DocumentManager.getAllOpenDocuments().forEach(function (doc) {
                                    if (doc.file.fullPath === fullPath) {
                                        reloadDoc(doc);
                                    }
                                });
                                // diffs were cleaned in this file
                                resolve();
                            });
                    });
            };

            if (clearWholeFile) {
                _cleanLines(null);
            } else {
                Git.diffFile(filename).then(function (diff) {
                    // if git returned an empty diff
                    if (!diff) { return resolve(); }

                    // if git detected that the file is binary
                    if (diff.match(/^binary files.*differ$/img)) { return resolve(); }

                    var modified = [],
                        changesets = diff.split("\n").filter(function (l) { return l.match(/^@@/) !== null; });
                    // collect line numbers to clean
                    changesets.forEach(function (line) {
                        var i,
                            m = line.match(/^@@ -([,0-9]+) \+([,0-9]+) @@/),
                            s = m[2].split(","),
                            from = parseInt(s[0], 10),
                            to = from - 1 + (parseInt(s[1], 10) || 1);
                        for (i = from; i <= to; i++) { modified.push(i > 0 ? i - 1 : 0); }
                    });
                    _cleanLines(modified);
                }).catch(function (ex) {
                    // This error will bubble up to preparing commit dialog so just log here
                    ErrorHandler.logError(ex);
                    reject(ex);
                });
            }
        });
    }

    function stripWhitespaceFromFiles(gitStatusResults, stageChanges, progressTracker) {
        return new Promise((resolve, reject)=>{
            const startTime = (new Date()).getTime();
            let queue = Promise.resolve();

            gitStatusResults.forEach(function (fileObj) {
                var isDeleted = fileObj.status.indexOf(Git.FILE_STATUS.DELETED) !== -1;

                // strip whitespace if the file was not deleted
                if (!isDeleted) {
                    // strip whitespace only for recognized languages so binary files won't get corrupted
                    var langId = LanguageManager.getLanguageForPath(fileObj.file).getId();
                    if (["unknown", "binary", "image", "markdown", "audio"].indexOf(langId) === -1) {

                        queue = queue.then(function () {
                            var clearWholeFile = fileObj.status.indexOf(Git.FILE_STATUS.UNTRACKED) !== -1 ||
                                fileObj.status.indexOf(Git.FILE_STATUS.RENAMED) !== -1;

                            var t = (new Date()).getTime() - startTime;
                            progressTracker.trigger(Events.GIT_PROGRESS_EVENT,
                                t + "ms - " + Strings.CLEAN_FILE_START + ": " + fileObj.file);

                            return stripWhitespaceFromFile(fileObj.file, clearWholeFile).then(function () {
                                // stage the files again to include stripWhitespace changes
                                var notifyProgress = function () {
                                    var t = (new Date()).getTime() - startTime;
                                    progressTracker.trigger(Events.GIT_PROGRESS_EVENT,
                                        t + "ms - " + Strings.CLEAN_FILE_END + ": " + fileObj.file);
                                };
                                if (stageChanges) {
                                    return Git.stage(fileObj.file).then(notifyProgress);
                                } else {
                                    notifyProgress();
                                }
                            });
                        });

                    }
                }
            });

            queue
                .then(function () {
                    resolve();
                })
                .catch(function () {
                    reject();
                });
        });
    }

    function openEditorForFile(file, relative) {
        if (relative) {
            file = getProjectRoot() + file;
        }
        CommandManager.execute(Commands.FILE_OPEN, {
            fullPath: file
        });
    }

    let clearWhitespace = Preferences.get("clearWhitespaceOnSave");
    Preferences.getExtensionPref().on("change", "clearWhitespaceOnSave", ()=>{
        clearWhitespace = Preferences.get("clearWhitespaceOnSave");
    });

    EventEmitter.on(Events.BRACKETS_DOCUMENT_SAVED, function (doc) {
        if(!clearWhitespace){
            return;
        }
        var fullPath       = doc.file.fullPath,
            currentGitRoot = Preferences.get("currentGitRoot"),
            path           = fullPath.substring(currentGitRoot.length);
        stripWhitespaceFromFile(path);
    });

    function enableCommand(commandID, enabled) {
        const command = CommandManager.get(commandID);
        if(!command){
            return;
        }
        enabled = commandID === Constants.CMD_GIT_SETTINGS_COMMAND_ID ?
            true : enabled && Setup.isExtensionActivated();
        command.setEnabled(enabled);
    }

    // Public API
    exports.FORMAT_DIFF_TOO_LARGE       = FORMAT_DIFF_TOO_LARGE;
    exports.formatDiff                  = formatDiff;
    exports.getProjectRoot              = getProjectRoot;
    exports.getExtensionDirectory       = getExtensionDirectory;
    exports.askQuestion                 = askQuestion;
    exports.showOutput                  = showOutput;
    exports.isProjectRootWritable       = isProjectRootWritable;
    exports.pathExists                  = pathExists;
    exports.loadPathContent             = loadPathContent;
    exports.setLoading                  = setLoading;
    exports.unsetLoading                = unsetLoading;
    exports.isLoading                   = isLoading;
    exports.consoleWarn                 = consoleWarn;
    exports.consoleError                = consoleError;
    exports.consoleDebug                = consoleDebug;
    exports.encodeSensitiveInformation  = encodeSensitiveInformation;
    exports.reloadDoc                   = reloadDoc;
    exports.stripWhitespaceFromFiles    = stripWhitespaceFromFiles;
    exports.openEditorForFile           = openEditorForFile;
    exports.enableCommand               = enableCommand;

});

define("src/dialogs/Clone", function (require, exports) {

    // Brackets modules
    const Dialogs = brackets.getModule("widgets/Dialogs"),
        Mustache = brackets.getModule("thirdparty/mustache/mustache");

    // Local modules
    const RemoteCommon    = require("src/dialogs/RemoteCommon"),
        Strings           = brackets.getModule("strings");

    // Templates
    const template            = `<div id="git-clone-dialog" class="git modal">
    <div class="modal-header">
        <h1 class="dialog-title">{{Strings.CLONE_REPOSITORY}}</h1>
    </div>
    <div class="modal-body">

        <label for="git-clone-url">{{Strings.ENTER_REMOTE_GIT_URL}}</label>
        <input type="text" class="stringInput" id="git-clone-url" autocomplete="off" spellcheck="false" />

        <hr>

        <div class="accordion">
            <!-- Hidden checkbox to toggle the accordion -->
            <input type="checkbox" id="advancedAccordionToggle" class="accordion-toggle" />

            <!-- Accordion Header -->
            <label for="advancedAccordionToggle" class="accordion-header">
                {{Strings.MORE_OPTIONS}}
                <i class="fas fa-chevron-down"></i>
            </label>

            <!-- Accordion Content -->
            <div class="accordion-content">
                <label class="text-bold">
                    {{Strings.CREDENTIALS}}
                </label>
                <div>
                    <label class="text-quiet">
                        {{Strings.SAVE_CREDENTIALS_HELP}}
                    </label>
                </div>

                <div>
                    <label>
                        {{Strings.USERNAME}}:
                    </label>
                    <label>
                        <input type="text" name="username" value="{{config.remoteUsername}}" autocomplete="off" spellcheck="false"/>
                    </label>
                </div>

                <div>
                    <label>
                        {{Strings.PASSWORD}}:
                    </label>
                    <label>
                        <input type="password" name="password" value="{{config.remotePassword}}" autocomplete="off" spellcheck="false"/>
                    </label>
                </div>

                <div>
                    <label>
                        <input type="checkbox" name="saveToUrl" />
                        {{Strings.SAVE_CREDENTIALS_IN_URL}}
                    </label>
                </div>
            </div>
        </div>


    </div>
    <div class="modal-footer">
        <button class="dialog-button btn" data-button-id="cancel">{{Strings.CANCEL}}</button>
        <button class="dialog-button btn primary" data-button-id="ok">{{Strings.OK}}</button>
    </div>
</div>
`;

    // Module variables
    let $cloneInput;

    // Implementation
    function _attachEvents($dialog) {
        // Detect changes to URL, disable auth if not http
        $cloneInput.on("keyup change", function () {
            var $authInputs = $dialog.find("input[name='username'],input[name='password'],input[name='saveToUrl']");
            if ($(this).val().length > 0) {
                if (/^https?:/.test($(this).val())) {
                    $authInputs.prop("disabled", false);

                    // Update the auth fields if the URL contains auth
                    var auth = /:\/\/([^:]+):?([^@]*)@/.exec($(this).val());
                    if (auth) {
                        $("input[name=username]", $dialog).val(auth[1]);
                        $("input[name=password]", $dialog).val(auth[2]);
                    }
                } else {
                    $authInputs.prop("disabled", true);
                }
            } else {
                $authInputs.prop("disabled", false);
            }
        });
        $cloneInput.focus();
    }

    function show() {
        return new Promise((resolve, reject)=>{
            const templateArgs = {
                modeLabel: Strings.CLONE_REPOSITORY,
                Strings: Strings
            };

            var compiledTemplate = Mustache.render(template, templateArgs),
                dialog = Dialogs.showModalDialogUsingTemplate(compiledTemplate),
                $dialog = dialog.getElement();

            $cloneInput = $dialog.find("#git-clone-url");

            _attachEvents($dialog);

            dialog.done(function (buttonId) {
                if (buttonId === "ok") {
                    var cloneConfig = {};
                    cloneConfig.remote = "origin";
                    cloneConfig.remoteUrl = $cloneInput.val();
                    RemoteCommon.collectValues(cloneConfig, $dialog);
                    resolve(cloneConfig);
                } else {
                    reject();
                }
            });

        });
    }

    exports.show = show;
});

define("src/dialogs/Progress", function (require, exports) {
    const EventDispatcher = brackets.getModule("utils/EventDispatcher");
    // Brackets modules
    const Dialogs = brackets.getModule("widgets/Dialogs"),
        Strings             = brackets.getModule("strings"),
        Mustache = brackets.getModule("thirdparty/mustache/mustache");

    // Local modules
    const Events        = require("src/Events");

    // Templates
    var template = `<div id="git-progress-dialog" class="modal">
    <div class="modal-header">
        <h1 class="dialog-title">{{title}}</h1>
    </div>
    <div class="modal-body">
        <textarea readonly="readonly"></textarea>
    </div>
    <!--
    <div class="modal-footer">
        <button class="dialog-button btn" data-button-id="cancel">{{Strings.CANCEL}}</button>
        <button class="dialog-button btn primary" data-button-id="ok">{{Strings.OK}}</button>
    </div>
    -->
</div>
`;

    // Module variables
    var lines,
        $textarea;

    const maxLines = 5000;
    // some git commit may have pre commit/push hooks which
    // may run tests suits that print large amount of data on the console, so we need to
    // debounce and truncate the git output we get in progress window.
    function addLine(str) {
        if (lines.length >= maxLines) {
            lines.shift(); // Remove the oldest line
        }
        lines.push(str);
    }
    let updateTimeout = null;
    function updateTextarea() {
        if(updateTimeout){
            // an update is scheduled, debounce, we dont need to print now
            return;
        }
        updateTimeout = setTimeout(() => {
            updateTimeout = null;
            if(!$textarea || !lines.length){
                return;
            }
            $textarea.val(lines.join("\n"));
            $textarea.scrollTop($textarea[0].scrollHeight - $textarea.height());
        }, 100);
    }

    function onProgress(str) {
        if (typeof str === "string") {
            addLine(str);
        }
        updateTextarea();
    }

    function show(promise, progressTracker, showOpts = {}) {
        if (!promise || !promise.finally) {
            throw new Error("Invalid promise argument for progress dialog!");
        }
        if(!progressTracker) {
            throw new Error("Invalid progressTracker argument for progress dialog!");
        }

        const title = showOpts.title;
        const options = showOpts.options || {};

        return new Promise(function (resolve, reject) {

            lines = showOpts.initialMessage ? [showOpts.initialMessage] : [];
            $textarea = null;

            var dialog,
                finished = false;

            function showDialog() {
                if (finished) {
                    return;
                }

                var templateArgs = {
                    title: title || Strings.OPERATION_IN_PROGRESS_TITLE,
                    Strings: Strings
                };

                var compiledTemplate = Mustache.render(template, templateArgs);
                dialog = Dialogs.showModalDialogUsingTemplate(compiledTemplate);

                $textarea = dialog.getElement().find("textarea");
                $textarea.val(Strings.PLEASE_WAIT);
                onProgress();
            }

            let finalValue, finalError;
            function finish() {
                finished = true;
                if (dialog) {
                    dialog.close();
                }
                if(finalError){
                    reject(finalError);
                } else {
                    resolve(finalValue);
                }
            }

            if (!options.preDelay) {
                showDialog();
            } else {
                setTimeout(function () {
                    showDialog();
                }, options.preDelay * 1000);
            }

            progressTracker.off(`${Events.GIT_PROGRESS_EVENT}.progressDlg`);
            progressTracker.on(`${Events.GIT_PROGRESS_EVENT}.progressDlg`, (_evt, data)=>{
                onProgress(data);
            });
            promise
                .then(val => {
                    finalValue = val;
                })
                .catch(err => {
                    finalError = err;
                })
                .finally(function () {
                    progressTracker.off(`${Events.GIT_PROGRESS_EVENT}.progressDlg`);
                    onProgress("Finished!");
                    if (!options.postDelay || !dialog) {
                        finish();
                    } else {
                        setTimeout(function () {
                            finish();
                        }, options.postDelay * 1000);
                    }
                });

        });
    }

    function waitForClose() {
        return new Promise(function (resolve) {
            function check() {
                var visible = $("#git-progress-dialog").is(":visible");
                if (!visible) {
                    resolve();
                } else {
                    setTimeout(check, 20);
                }
            }
            setTimeout(check, 20);
        });
    }

    function newProgressTracker() {
        const tracker = {};
        EventDispatcher.makeEventDispatcher(tracker);
        return tracker;
    }

    exports.show = show;
    exports.newProgressTracker = newProgressTracker;
    exports.waitForClose = waitForClose;

});

define("src/dialogs/Pull", function (require, exports) {

    // Brackets modules
    const Dialogs = brackets.getModule("widgets/Dialogs"),
        Mustache = brackets.getModule("thirdparty/mustache/mustache");

    // Local modules
    const Preferences     = require("src/Preferences"),
        RemoteCommon    = require("src/dialogs/RemoteCommon"),
        Strings         = brackets.getModule("strings");

    // Templates
    const template            = `<div id="git-pull-dialog" class="git modal">
    <div class="modal-header">
        <h1 class="dialog-title">{{Strings.DIALOG_PULL_TITLE}} &mdash; {{config.remote}}</h1>
    </div>
    <div class="modal-body">

        {{> remotes}}

        <hr>
        <label class="text-bold">
            {{Strings.PULL_BEHAVIOR}}
        </label>
        <div>
            <label>
                <input type="radio" name="strategy" value="DEFAULT"> {{Strings.PULL_DEFAULT}}
            </label>
        </div>

        <div>
            <label>
                <input type="radio" name="strategy" value="AVOID_MERGING"> {{Strings.PULL_AVOID_MERGING}}
            </label>
        </div>

        <div>
            <label>
                <input type="radio" name="strategy" value="MERGE_NOCOMMIT"> {{Strings.PULL_MERGE_NOCOMMIT}}
            </label>
        </div>

        <div>
            <label>
                <input type="radio" name="strategy" value="REBASE"> {{Strings.PULL_REBASE}}
            </label>
        </div>

        <div>
            <label>
                <input type="radio" name="strategy" value="RESET"> {{Strings.PULL_RESET}}
            </label>
        </div>

        <hr>

        <div class="accordion">
            <!-- Hidden checkbox to toggle the accordion -->
            <input type="checkbox" id="advancedAccordionToggle" class="accordion-toggle" />

            <!-- Accordion Header -->
            <label for="advancedAccordionToggle" class="accordion-header">
                {{Strings.MORE_OPTIONS}}
                <i class="fas fa-chevron-down"></i>
            </label>

            <!-- Accordion Content -->
            <div class="accordion-content">
                <label class="text-bold">
                    {{Strings.CREDENTIALS}}
                </label>
                <div>
                    <label class="text-quiet">
                        {{Strings.SAVE_CREDENTIALS_HELP}}
                    </label>
                </div>

                <div>
                    <label>
                        {{Strings.USERNAME}}:
                    </label>
                    <label>
                        <input type="text" name="username" value="{{config.remoteUsername}}" autocomplete="off" spellcheck="false"/>
                    </label>
                </div>

                <div>
                    <label>
                        {{Strings.PASSWORD}}:
                    </label>
                    <label>
                        <input type="password" name="password" value="{{config.remotePassword}}" autocomplete="off" spellcheck="false"/>
                    </label>
                </div>

                <div>
                    <label>
                        <input type="checkbox" name="saveToUrl" />
                        {{Strings.SAVE_CREDENTIALS_IN_URL}}
                    </label>
                </div>
            </div>
        </div>

    </div>
    <div class="modal-footer">
        <button class="dialog-button btn" data-button-id="cancel">{{Strings.CANCEL}}</button>
        <button class="dialog-button btn primary" data-button-id="ok">{{Strings.OK}}</button>
    </div>
</div>
`,
        remotesTemplate     = `<div class="current-tracking-branch">
    <label>
        {{Strings.CURRENT_TRACKING_BRANCH}}:
    </label>
    <label class="text-bold">
        {{config.currentTrackingBranch}}
        {{^config.currentTrackingBranch}}
        none - "{{config.currentBranchName}}" branch will be created on remote
        {{/config.currentTrackingBranch}}
    </label>
</div>

<div>
    <label class="text-bold">
        {{Strings.TARGET_BRANCH}}
    </label>
    <label>
        <input type="radio" name="action" value="{{mode}}_CURRENT" checked> {{modeLabel}} {{Strings._CURRENT_TRACKING_BRANCH}}
    </label>
</div>

<div>
    <label>
        <input type="radio" name="action" value="{{mode}}_SELECTED"> {{modeLabel}} {{Strings._ANOTHER_BRANCH}}
    </label>
</div>

<div class="only-from-selected" style="margin-left: 15px;">
    <div class="input-append">
        <select class="branchSelect" name="selectedBranch"></select>
        <button class="btn fetchBranches" type="button"><i class="octicon octicon-sync"></i></button>
    </div>
</div>

<div class="only-from-selected" style="margin-left: 15px;">
    <label>
        <input type="checkbox" name="setBranchAsTracking"> {{Strings.SET_THIS_BRANCH_AS_TRACKING}}
    </label>
</div>
`;

    // Implementation
    function _attachEvents($dialog, pullConfig) {
        RemoteCommon.attachCommonEvents(pullConfig, $dialog);

        // load last used
        $dialog
            .find("input[name='strategy']")
            .filter("[value='" + (Preferences.get("pull.strategy") || "DEFAULT") + "']")
            .prop("checked", true);
    }

    function _show(pullConfig, resolve, reject) {
        const templateArgs = {
            config: pullConfig,
            mode: "PULL_FROM",
            modeLabel: Strings.PULL_FROM,
            Strings: Strings
        };

        const compiledTemplate = Mustache.render(template, templateArgs, {
                remotes: remotesTemplate
            }),
            dialog = Dialogs.showModalDialogUsingTemplate(compiledTemplate),
            $dialog = dialog.getElement();

        _attachEvents($dialog, pullConfig);

        dialog.done(function (buttonId) {
            if (buttonId === "ok") {
                RemoteCommon.collectValues(pullConfig, $dialog);
                Preferences.set("pull.strategy", pullConfig.strategy);
                resolve(pullConfig);
            } else {
                reject();
            }
        });
    }

    function show(pullConfig) {
        return new Promise((resolve, reject) => {
            pullConfig.pull = true;
            // collectInfo never rejects
            RemoteCommon.collectInfo(pullConfig).then(()=>{
                _show(pullConfig, resolve, reject);
            });
        });
    }

    exports.show = show;

});

define("src/dialogs/Push", function (require, exports) {

    // Brackets modules
    const Dialogs = brackets.getModule("widgets/Dialogs"),
        Mustache = brackets.getModule("thirdparty/mustache/mustache");

    // Local modules
    const RemoteCommon    = require("src/dialogs/RemoteCommon"),
        Strings           = brackets.getModule("strings");

    // Templates
    const template            = `<div id="git-push-dialog" class="git modal">
    <div class="modal-header">
        <h1 class="dialog-title">{{Strings.DIALOG_PUSH_TITLE}} &mdash; {{config.remote}}</h1>
    </div>
    <div class="modal-body">

        {{> remotes}}

        <hr>
        <label class="text-bold">
            {{Strings.PUSH_BEHAVIOR}}
        </label>

        <div>
            <label>
                <input type="radio" name="strategy" value="DEFAULT"> {{Strings.PUSH_DEFAULT}}
            </label>
        </div>

        <div>
            <label>
                <input type="radio" name="strategy" value="FORCED"> {{Strings.PUSH_FORCED}}
            </label>
        </div>

        <div>
            <label>
                <input type="radio" name="strategy" value="DELETE_BRANCH"> {{Strings.PUSH_DELETE_BRANCH}}
            </label>
        </div>

        <hr>

        <div class="accordion">
            <!-- Hidden checkbox to toggle the accordion -->
            <input type="checkbox" id="advancedAccordionToggle" class="accordion-toggle" />

            <!-- Accordion Header -->
            <label for="advancedAccordionToggle" class="accordion-header">
                {{Strings.MORE_OPTIONS}}
                <i class="fas fa-chevron-down"></i>
            </label>

            <!-- Accordion Content -->
            <div class="accordion-content">
                <div>
                    <label>
                        <input type="checkbox" name="send_tags" value="true"> {{Strings.PUSH_SEND_TAGS}}
                    </label>
                </div>
                <div>
                    <label>
                        <input type="checkbox" name="push-no-verify" value="true"> {{Strings.SKIP_PRE_PUSH_CHECKS}}
                    </label>
                </div>
                <br>
                <label class="text-bold">
                    {{Strings.CREDENTIALS}}
                </label>
                <div>
                    <label class="text-quiet">
                        {{Strings.SAVE_CREDENTIALS_HELP}}
                    </label>
                </div>

                <div>
                    <label>
                        {{Strings.USERNAME}}:
                    </label>
                    <label>
                        <input type="text" name="username" value="{{config.remoteUsername}}" autocomplete="off" spellcheck="false"/>
                    </label>
                </div>

                <div>
                    <label>
                        {{Strings.PASSWORD}}:
                    </label>
                    <label>
                        <input type="password" name="password" value="{{config.remotePassword}}" autocomplete="off" spellcheck="false"/>
                    </label>
                </div>

                <div>
                    <label>
                        <input type="checkbox" name="saveToUrl" />
                        {{Strings.SAVE_CREDENTIALS_IN_URL}}
                    </label>
                </div>
            </div>
        </div>

    </div>
    <div class="modal-footer">
        <button class="dialog-button btn" data-button-id="cancel">{{Strings.CANCEL}}</button>
        <button class="dialog-button btn primary" data-button-id="ok">{{Strings.OK}}</button>
    </div>
</div>
`,
        remotesTemplate     = `<div class="current-tracking-branch">
    <label>
        {{Strings.CURRENT_TRACKING_BRANCH}}:
    </label>
    <label class="text-bold">
        {{config.currentTrackingBranch}}
        {{^config.currentTrackingBranch}}
        none - "{{config.currentBranchName}}" branch will be created on remote
        {{/config.currentTrackingBranch}}
    </label>
</div>

<div>
    <label class="text-bold">
        {{Strings.TARGET_BRANCH}}
    </label>
    <label>
        <input type="radio" name="action" value="{{mode}}_CURRENT" checked> {{modeLabel}} {{Strings._CURRENT_TRACKING_BRANCH}}
    </label>
</div>

<div>
    <label>
        <input type="radio" name="action" value="{{mode}}_SELECTED"> {{modeLabel}} {{Strings._ANOTHER_BRANCH}}
    </label>
</div>

<div class="only-from-selected" style="margin-left: 15px;">
    <div class="input-append">
        <select class="branchSelect" name="selectedBranch"></select>
        <button class="btn fetchBranches" type="button"><i class="octicon octicon-sync"></i></button>
    </div>
</div>

<div class="only-from-selected" style="margin-left: 15px;">
    <label>
        <input type="checkbox" name="setBranchAsTracking"> {{Strings.SET_THIS_BRANCH_AS_TRACKING}}
    </label>
</div>
`;

    // Implementation
    function _attachEvents($dialog, pushConfig) {
        RemoteCommon.attachCommonEvents(pushConfig, $dialog);

        // select default - we don't want to remember forced or delete branch as default
        $dialog
            .find("input[name='strategy']")
            .filter("[value='DEFAULT']")
            .prop("checked", true);
    }

    function _show(pushConfig, resolve, reject) {
        const templateArgs = {
            config: pushConfig,
            mode: "PUSH_TO",
            modeLabel: Strings.PUSH_TO,
            Strings: Strings
        };

        const compiledTemplate = Mustache.render(template, templateArgs, {
                remotes: remotesTemplate
            }),
            dialog = Dialogs.showModalDialogUsingTemplate(compiledTemplate),
            $dialog = dialog.getElement();

        _attachEvents($dialog, pushConfig);

        dialog.done(function (buttonId) {
            if (buttonId === "ok") {
                RemoteCommon.collectValues(pushConfig, $dialog);
                resolve(pushConfig);
            } else {
                reject();
            }
        });
    }

    function show(pushConfig) {
        return new Promise((resolve, reject) => {
            pushConfig.push = true;
            // collectInfo never rejects
            RemoteCommon.collectInfo(pushConfig).then(()=>{
                _show(pushConfig, resolve, reject);
            });
        });
    }

    exports.show = show;

});

define("src/dialogs/RemoteCommon", function (require, exports) {

    // Brackets modules
    const _ = brackets.getModule("thirdparty/lodash"),
        Strings = brackets.getModule("strings"),
        Mustache = brackets.getModule("thirdparty/mustache/mustache");

    // Local modules
    const ErrorHandler    = require("src/ErrorHandler"),
        Git             = require("src/git/Git"),
        ProgressDialog  = require("src/dialogs/Progress");

    // Implementation

    function fillBranches(config, $dialog) {
        Git.getAllBranches().then(function (branches) {
            // filter only branches for this remote
            branches = _.filter(branches, function (branch) {
                return branch.remote === config.remote;
            });

            const template = "{{#branches}}<option value='{{name}}' remote='{{remote}}' " +
                "{{#currentBranch}}selected{{/currentBranch}}>{{name}}</option>{{/branches}}";
            const html = Mustache.render(template, { branches: branches });
            $dialog.find(".branchSelect").html(html);
        }).catch(function (err) {
            ErrorHandler.showError(err, Strings.ERROR_BRANCH_LIST);
        });
    }

    // this should never reject for now, just show error message and bail out
    exports.collectInfo = function (config) {
        return Git.getCurrentUpstreamBranch().then(function (upstreamBranch) {
            config.currentTrackingBranch = upstreamBranch;

            return Git.getRemoteUrl(config.remote).then(function (remoteUrl) {
                config.remoteUrl = remoteUrl;

                if (remoteUrl.match(/^https?:/)) {
                    const url = new URL(remoteUrl);
                    config.remoteUsername = url.username;
                    config.remotePassword = url.password;
                } else {
                    // disable the inputs
                    config._usernamePasswordDisabled = true;
                }

                if (!upstreamBranch) {
                    return Git.getCurrentBranchName().then(function (currentBranchName) {
                        config.currentBranchName = currentBranchName;
                    });
                }
            });
        }).catch(function (err) {
            ErrorHandler.showError(err, Strings.ERROR_FETCH_REMOTE);
        });
    };

    exports.attachCommonEvents = function (config, $dialog) {
        const handleRadioChange = function () {
            const val = $dialog.find("input[name='action']:checked").val();
            $dialog.find(".only-from-selected").toggle(val === "PULL_FROM_SELECTED" || val === "PUSH_TO_SELECTED");
        };
        $dialog.on("change", "input[name='action']", handleRadioChange);
        handleRadioChange();

        let trackingBranchRemote = null;
        if (config.currentTrackingBranch) {
            trackingBranchRemote = config.currentTrackingBranch.substring(0, config.currentTrackingBranch.indexOf("/"));
        }

        // if we're pulling from another remote than current tracking remote
        if (config.currentTrackingBranch && trackingBranchRemote !== config.remote) {
            if (config.pull) {
                $dialog.find("input[value='PULL_FROM_CURRENT']").prop("disabled", true);
                $dialog.find("input[value='PULL_FROM_SELECTED']").prop("checked", true).trigger("change");
            } else {
                $dialog.find("input[value='PUSH_TO_CURRENT']").prop("disabled", true);
                $dialog.find("input[value='PUSH_TO_SELECTED']").prop("checked", true).trigger("change");
            }
        }

        $dialog.on("click", ".fetchBranches", function () {
            const tracker = ProgressDialog.newProgressTracker();
            ProgressDialog.show(Git.fetchRemote(config.remote, tracker), tracker)
                .then(function () {
                    fillBranches(config, $dialog);
                }).catch(function (err) {
                    ErrorHandler.showError(err, Strings.ERROR_FETCH_REMOTE);
                });
        });
        fillBranches(config, $dialog);

        if (config._usernamePasswordDisabled) {
            $dialog.find("input[name='username'],input[name='password'],input[name='saveToUrl']").prop("disabled", true);
        }
    };

    exports.collectValues = function (config, $dialog) {
        const action = $dialog.find("input[name='action']:checked").val();
        if (action === "PULL_FROM_CURRENT" || action === "PUSH_TO_CURRENT") {

            if (config.currentTrackingBranch) {
                config.branch = config.currentTrackingBranch.substring(config.remote.length + 1);
            } else {
                config.branch = config.currentBranchName;
                config.pushToNew = true;
            }

        } else if (action === "PULL_FROM_SELECTED" || action === "PUSH_TO_SELECTED") {
            config.branch = $dialog.find(".branchSelect").val().substring(config.remote.length + 1);
            config.setBranchAsTracking = $dialog.find("input[name='setBranchAsTracking']").is(":checked");
        }

        config.strategy = $dialog.find("input[name='strategy']:checked").val();
        config.tags = $dialog.find("input[name='send_tags']:checked").val();
        config.noVerify = $dialog.find("input[name='push-no-verify']:checked").val();

        config.remoteUsername = $dialog.find("input[name='username']").val();
        config.remotePassword = $dialog.find("input[name='password']").val();

        // new url that has to be set for merging
        let remoteUrlNew;
        if (config.remoteUrl.match(/^https?:/)) {
            const url = new URL(config.remoteUrl);
            url.username = config.remoteUsername;
            url.password = config.remotePassword;
            remoteUrlNew = url.toString();
        }

        // assign remoteUrlNew only if it's different from the original url
        if (remoteUrlNew && config.remoteUrl !== remoteUrlNew) {
            config.remoteUrlNew = remoteUrlNew;
        }

        // old url that has to be put back after merging
        const saveToUrl = $dialog.find("input[name='saveToUrl']").is(":checked");
        // assign restore branch only if remoteUrlNew has some value
        if (config.remoteUrlNew && !saveToUrl) {
            config.remoteUrlRestore = config.remoteUrl;
        }
    };

});

/*
    This file acts as an entry point to GitCli.js and other possible
    implementations of Git communication besides Cli. Application
    should not access GitCli directly.
*/
define("src/git/Git", function (require, exports) {

    // Local modules
    const Preferences = require("src/Preferences"),
        GitCli      = require("src/git/GitCli"),
        Utils       = require("src/Utils");

    // Implementation
    function pushToNewUpstream(remoteName, remoteBranch, options = {}) {
        const args = ["--set-upstream"];

        if (options.noVerify) {
            args.push("--no-verify");
        }

        return GitCli.push(remoteName, remoteBranch, args, options.progressTracker);
    }

    function getRemoteUrl(remote) {
        return GitCli.getConfig("remote." + remote + ".url");
    }

    function setRemoteUrl(remote, url) {
        return GitCli.setConfig("remote." + remote + ".url", url);
    }

    function sortBranches(branches) {
        return branches.sort(function (a, b) {
            var ar = a.remote || "",
                br = b.remote || "";
            // origin remote first
            if (br && ar === "origin" && br !== "origin") {
                return -1;
            } else if (ar && ar !== "origin" && br === "origin") {
                return 1;
            }
            // sort by remotes
            if (ar < br) {
                return -1;
            } else if (ar > br) {
                return 1;
            }
            // sort by sortPrefix (# character)
            if (a.sortPrefix < b.sortPrefix) {
                return -1;
            } else if (a.sortPrefix > b.sortPrefix) {
                return 1;
            }
            // master branch first
            if (a.sortName === "master" && b.sortName !== "master") {
                return -1;
            } else if (a.sortName !== "master" && b.sortName === "master") {
                return 1;
            }
            // sort by sortName (lowercased branch name)
            return a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0;
        });
    }

    function getBranches() {
        return GitCli.getBranches().then(function (branches) {
            return sortBranches(branches);
        });
    }

    function getAllBranches() {
        return GitCli.getAllBranches().then(function (branches) {
            return sortBranches(branches);
        });
    }

    function getHistory(branch, skip) {
        return GitCli.getHistory(branch, skip);
    }

    function getFileHistory(file, branch, skip) {
        return GitCli.getHistory(branch, skip, file);
    }

    function resetIndex() {
        return GitCli.reset();
    }

    function discardAllChanges() {
        return GitCli.reset("--hard").then(function () {
            return GitCli.clean();
        });
    }

    function getMergeInfo() {
        var baseCheck  = ["MERGE_MODE", "rebase-apply"],
            mergeCheck = ["MERGE_HEAD", "MERGE_MSG"],
            rebaseCheck = ["rebase-apply/next", "rebase-apply/last", "rebase-apply/head-name"],
            gitFolder  = Preferences.get("currentGitRoot") + ".git/";

        return Promise.all(baseCheck.map(function (fileName) {
            return Utils.loadPathContent(gitFolder + fileName);
        })).then(function ([mergeMode, rebaseMode]) {
            var obj = {
                mergeMode: mergeMode !== null,
                rebaseMode: rebaseMode !== null
            };
            if (obj.mergeMode) {

                return Promise.all(mergeCheck.map(function (fileName) {
                    return Utils.loadPathContent(gitFolder + fileName);
                })).then(function ([head, msg]) {

                    if (head) {
                        obj.mergeHead = head.trim();
                    }
                    var msgSplit = msg ? msg.trim().split(/conflicts:/i) : [];
                    if (msgSplit[0]) {
                        obj.mergeMessage = msgSplit[0].trim();
                    }
                    if (msgSplit[1]) {
                        obj.mergeConflicts = msgSplit[1].trim().split("\n").map(function (line) { return line.trim(); });
                    }
                    return obj;

                });

            }
            if (obj.rebaseMode) {

                return Promise.all(rebaseCheck.map(function (fileName) {
                    return Utils.loadPathContent(gitFolder + fileName);
                })).then(function ([next, last, head]) {

                    if (next) { obj.rebaseNext = next.trim(); }
                    if (last) { obj.rebaseLast = last.trim(); }
                    if (head) { obj.rebaseHead = head.trim().substring("refs/heads/".length); }
                    return obj;

                });

            }
            return obj;
        });
    }

    function discardFileChanges(file) {
        return GitCli.unstage(file).then(function () {
            return GitCli.checkout(file);
        });
    }

    function pushForced(remote, branch, options = {}) {
        const args = ["--force"];

        if (options.noVerify) {
            args.push("--no-verify");
        }

        return GitCli.push(remote, branch, args, options.progressTracker);
    }

    function deleteRemoteBranch(remote, branch, options = {}) {
        const args = ["--delete"];

        if (options.noVerify) {
            args.push("--no-verify");
        }

        return GitCli.push(remote, branch, args, options.progressTracker);
    }

    function undoLastLocalCommit() {
        return GitCli.reset("--soft", "HEAD~1");
    }

    // Public API
    exports.pushToNewUpstream       = pushToNewUpstream;
    exports.getBranches             = getBranches;
    exports.getAllBranches          = getAllBranches;
    exports.getHistory              = getHistory;
    exports.getFileHistory          = getFileHistory;
    exports.resetIndex              = resetIndex;
    exports.discardAllChanges       = discardAllChanges;
    exports.getMergeInfo            = getMergeInfo;
    exports.discardFileChanges      = discardFileChanges;
    exports.getRemoteUrl            = getRemoteUrl;
    exports.setRemoteUrl            = setRemoteUrl;
    exports.pushForced              = pushForced;
    exports.deleteRemoteBranch      = deleteRemoteBranch;
    exports.undoLastLocalCommit     = undoLastLocalCommit;

    Object.keys(GitCli).forEach(function (method) {
        if (!exports[method]) {
            exports[method] = GitCli[method];
        }
    });
});

/*globals jsPromise, fs*/

/*
    This module is used to communicate with Git through Cli
    Output string from Git should always be parsed here
    to provide more sensible outputs than just plain strings.
    Format of the output should be specified in Git.js
*/
define("src/git/GitCli", function (require, exports) {

    // Brackets modules
    const _           = brackets.getModule("thirdparty/lodash"),
        FileSystem  = brackets.getModule("filesystem/FileSystem"),
        Strings     = brackets.getModule("strings"),
        FileUtils   = brackets.getModule("file/FileUtils");

    // Local modules
    const Cli           = require("src/Cli"),
        ErrorHandler  = require("src/ErrorHandler"),
        Events        = require("src/Events"),
        EventEmitter  = require("src/EventEmitter"),
        ExpectedError = require("src/ExpectedError"),
        Preferences   = require("src/Preferences"),
        Utils         = require("src/Utils");

    // Module variables
    let _gitPath = null,
        _gitQueue = [],
        _gitQueueBusy = false,
        lastGitStatusResults;

    var FILE_STATUS = {
        STAGED: "STAGED",
        UNMODIFIED: "UNMODIFIED",
        IGNORED: "IGNORED",
        UNTRACKED: "UNTRACKED",
        MODIFIED: "MODIFIED",
        ADDED: "ADDED",
        DELETED: "DELETED",
        RENAMED: "RENAMED",
        COPIED: "COPIED",
        UNMERGED: "UNMERGED"
    };

    // This SHA1 represents the empty tree. You get it using `git mktree < /dev/null`
    var EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

    // Implementation
    function getGitPath() {
        if (_gitPath) { return _gitPath; }
        _gitPath = Preferences.get("gitPath");
        return _gitPath;
    }

    Preferences.getExtensionPref().on("change", "gitPath", ()=>{
        _gitPath = Preferences.get("gitPath");
    });

    function setGitPath(path) {
        if (path === true) { path = "git"; }
        Preferences.set("gitPath", path);
        _gitPath = path;
    }

    function strEndsWith(subjectString, searchString, position) {
        if (position === undefined || position > subjectString.length) {
            position = subjectString.length;
        }
        position -= searchString.length;
        var lastIndex = subjectString.indexOf(searchString, position);
        return lastIndex !== -1 && lastIndex === position;
    }

    /*
    function fixCygwinPath(path) {
        if (typeof path === "string" && brackets.platform === "win" && path.indexOf("/cygdrive/") === 0) {
            path = path.substring("/cygdrive/".length)
                       .replace(/^([a-z]+)\//, function (a, b) {
                           return b.toUpperCase() + ":/";
                       });
        }
        return path;
    }
    */

    function _processQueue() {
        // do nothing if the queue is busy
        if (_gitQueueBusy) {
            return;
        }
        // do nothing if the queue is empty
        if (_gitQueue.length === 0) {
            _gitQueueBusy = false;
            return;
        }
        // get item from queue
        const item  = _gitQueue.shift(),
            resolve = item[0],
            reject = item[1],
            args  = item[2],
            opts  = item[3];
        // execute git command in a queue so no two commands are running at the same time
        if (opts.nonblocking !== true) { _gitQueueBusy = true; }
        Cli.spawnCommand(getGitPath(), args, opts)
            .then(function (r) {
                resolve(r);
            })
            .catch(function (e) {
                const call = "call: git " + args.join(" ");
                e.stack = [call, e.stack].join("\n");
                reject(e);
            })
            .finally(function () {
                if (opts.nonblocking !== true) { _gitQueueBusy = false; }
                _processQueue();
            });
    }

    function git(args, opts) {
        return new Promise((resolve, reject) => {
            _gitQueue.push([resolve, reject, args || [], opts || {}]);
            setTimeout(_processQueue);
        });
    }

    /*
        git branch
        -d --delete Delete a branch.
        -D Delete a branch irrespective of its merged status.
        --no-color Turn off branch colors
        -r --remotes List or delete (if used with -d) the remote-tracking branches.
        -a --all List both remote-tracking branches and local branches.
        --track When creating a new branch, set up branch.<name>.remote and branch.<name>.merge
        --set-upstream If specified branch does not exist yet or if --force has been given, acts exactly like --track
    */

    function setUpstreamBranch(remoteName, remoteBranch, progressTracker) {
        if (!remoteName) { throw new TypeError("remoteName argument is missing!"); }
        if (!remoteBranch) { throw new TypeError("remoteBranch argument is missing!"); }
        return git(["branch", "--no-color", "-u", remoteName + "/" + remoteBranch],
            {progressTracker});
    }

    function branchDelete(branchName, progressTracker) {
        return git(["branch", "--no-color", "-d", branchName], {progressTracker});
    }

    function forceBranchDelete(branchName, progressTracker) {
        return git(["branch", "--no-color", "-D", branchName], {progressTracker});
    }

    function getBranches(moreArgs, progressTracker) {
        var args = ["branch", "--no-color"];
        if (moreArgs) { args = args.concat(moreArgs); }

        return git(args, {progressTracker}).then(function (stdout) {
            if (!stdout) { return []; }
            return stdout.split("\n").reduce(function (arr, l) {
                var name = l.trim(),
                    currentBranch = false,
                    remote = null,
                    sortPrefix = "";

                if (name.indexOf("->") !== -1) {
                    return arr;
                }

                if (name.indexOf("* ") === 0) {
                    name = name.substring(2);
                    currentBranch = true;
                }

                if (name.indexOf("remotes/") === 0) {
                    name = name.substring("remotes/".length);
                    remote = name.substring(0, name.indexOf("/"));
                }

                var sortName = name.toLowerCase();
                if (remote) {
                    sortName = sortName.substring(remote.length + 1);
                }
                if (sortName.indexOf("#") !== -1) {
                    sortPrefix = sortName.slice(0, sortName.indexOf("#"));
                }

                arr.push({
                    name: name,
                    sortPrefix: sortPrefix,
                    sortName: sortName,
                    currentBranch: currentBranch,
                    remote: remote
                });
                return arr;
            }, []);
        });
    }

    function getAllBranches(progressTracker) {
        return getBranches(["-a"], progressTracker);
    }

    /*
        git fetch
        --all Fetch all remotes.
        --dry-run Show what would be done, without making any changes.
        --multiple Allow several <repository> and <group> arguments to be specified. No <refspec>s may be specified.
        --prune After fetching, remove any remote-tracking references that no longer exist on the remote.
        --progress This flag forces progress status even if the standard error stream is not directed to a terminal.
    */

    function repositoryNotFoundHandler(err) {
        var m = ErrorHandler.matches(err, /Repository (.*) not found$/gim);
        if (m) {
            throw new ExpectedError(m[0]);
        }
        throw err;
    }

    function fetchRemote(remote, progressTracker) {
        return git(["fetch", "--progress", remote], {
            progressTracker,
            timeout: false // never timeout this
        }).catch(repositoryNotFoundHandler);
    }

    function fetchAllRemotes(progressTracker) {
        return git(["fetch", "--progress", "--all"], {
            progressTracker,
            timeout: false // never timeout this
        }).catch(repositoryNotFoundHandler);
    }

    /*
        git remote
        add Adds a remote named <name> for the repository at <url>.
        rename Rename the remote named <old> to <new>.
        remove Remove the remote named <name>.
        show Gives some information about the remote <name>.
        prune Deletes all stale remote-tracking branches under <name>.

    */

    function getRemotes() {
        return git(["remote", "-v"])
            .then(function (stdout) {
                return !stdout ? [] : _.uniq(stdout.replace(/\((push|fetch)\)/g, "").split("\n")).map(function (l) {
                    var s = l.trim().split("\t");
                    return {
                        name: s[0],
                        url: s[1]
                    };
                });
            });
    }

    function createRemote(name, url) {
        return git(["remote", "add", name, url])
            .then(function () {
                // stdout is empty so just return success
                return true;
            });
    }

    function deleteRemote(name) {
        return git(["remote", "rm", name])
            .then(function () {
                // stdout is empty so just return success
                return true;
            });
    }

    /*
        git pull
        --no-commit Do not commit result after merge
        --ff-only Refuse to merge and exit with a non-zero status
                  unless the current HEAD is already up-to-date
                  or the merge can be resolved as a fast-forward.
    */

    /**
     *
     * @param remote
     * @param branch
     * @param {boolean} [ffOnly]
     * @param {boolean} [noCommit]
     * @param {object} [options]
     * @param [options.progressTracker]
     * @returns {Promise<unknown>}
     */
    function mergeRemote(remote, branch, ffOnly, noCommit, options = {}) {
        var args = ["merge"];

        if (ffOnly) { args.push("--ff-only"); }
        if (noCommit) { args.push("--no-commit", "--no-ff"); }

        args.push(remote + "/" + branch);

        var readMergeMessage = function () {
            return Utils.loadPathContent(Preferences.get("currentGitRoot") + "/.git/MERGE_MSG").then(function (msg) {
                return msg;
            });
        };

        return git(args, {progressTracker: options.progressTracker})
            .then(function (stdout) {
                // return stdout if available - usually not
                if (stdout) { return stdout; }

                return readMergeMessage().then(function (msg) {
                    if (msg) { return msg; }
                    return "Remote branch " + branch + " from " + remote + " was merged to current branch";
                });
            })
            .catch(function (error) {
                return readMergeMessage().then(function (msg) {
                    if (msg) { return msg; }
                    throw error;
                });
            });
    }

    function rebaseRemote(remote, branch, progressTracker) {
        return git(["rebase", remote + "/" + branch], {progressTracker});
    }

    function resetRemote(remote, branch, progressTracker) {
        return git(["reset", "--soft", remote + "/" + branch], {progressTracker}).then(function (stdout) {
            return stdout || "Current branch was resetted to branch " + branch + " from " + remote;
        });
    }

    function mergeBranch(branchName, mergeMessage, useNoff) {
        var args = ["merge"];
        if (useNoff) { args.push("--no-ff"); }
        if (mergeMessage && mergeMessage.trim()) { args.push("-m", mergeMessage); }
        args.push(branchName);
        return git(args);
    }

    /*
        git push
        --porcelain Produce machine-readable output.
        --delete All listed refs are deleted from the remote repository. This is the same as prefixing all refs with a colon.
        --force Usually, the command refuses to update a remote ref that is not an ancestor of the local ref used to overwrite it.
        --set-upstream For every branch that is up to date or successfully pushed, add upstream (tracking) reference
        --progress This flag forces progress status even if the standard error stream is not directed to a terminal.
    */

    /*
        returns parsed push response in this format:
        {
            flag: "="
            flagDescription: "Ref was up to date and did not need pushing"
            from: "refs/heads/rewrite-remotes"
            remoteUrl: "http://github.com/zaggino/brackets-git.git"
            status: "Done"
            summary: "[up to date]"
            to: "refs/heads/rewrite-remotes"
        }
    */
    function push(remoteName, remoteBranch, additionalArgs, progressTracker) {
        if (!remoteName) { throw new TypeError("remoteName argument is missing!"); }

        var args = ["push", "--porcelain", "--progress"];
        if (Array.isArray(additionalArgs)) {
            args = args.concat(additionalArgs);
        }
        args.push(remoteName);

        if (remoteBranch && Preferences.get("gerritPushref")) {
            return getConfig("gerrit.pushref").then(function (strGerritEnabled) {
                if (strGerritEnabled === "true") {
                    args.push("HEAD:refs/for/" + remoteBranch);
                } else {
                    args.push(remoteBranch);
                }
                return doPushWithArgs(args, progressTracker);
            });
        }

        if (remoteBranch) {
            args.push(remoteBranch);
        }

        return doPushWithArgs(args, progressTracker);
    }

    function doPushWithArgs(args, progressTracker) {
        return git(args, {progressTracker})
            .catch(repositoryNotFoundHandler)
            .then(function (stdout) {
                // this should clear lines from push hooks
                var lines = stdout.split("\n");
                while (lines.length > 0 && lines[0].match(/^To/) === null) {
                    lines.shift();
                }

                var retObj = {},
                    lineTwo = lines[1].split("\t");

                retObj.remoteUrl = lines[0].trim().split(" ")[1];
                retObj.flag = lineTwo[0];
                retObj.from = lineTwo[1].split(":")[0];
                retObj.to = lineTwo[1].split(":")[1];
                retObj.summary = lineTwo[2];
                retObj.status = lines[2];

                switch (retObj.flag) {
                    case " ":
                        retObj.flagDescription = Strings.GIT_PUSH_SUCCESS_MSG;
                        break;
                    case "+":
                        retObj.flagDescription = Strings.GIT_PUSH_FORCE_UPDATED_MSG;
                        break;
                    case "-":
                        retObj.flagDescription = Strings.GIT_PUSH_DELETED_MSG;
                        break;
                    case "*":
                        retObj.flagDescription = Strings.GIT_PUSH_NEW_REF_MSG;
                        break;
                    case "!":
                        retObj.flagDescription = Strings.GIT_PUSH_REJECTED_MSG;
                        break;
                    case "=":
                        retObj.flagDescription = Strings.GIT_PUSH_UP_TO_DATE_MSG;
                        break;
                    default:
                        retObj.flagDescription = "Unknown push flag received: " + retObj.flag; // internal error not translated
                }

                return retObj;
            });
    }

    function getCurrentBranchName() {
        return git(["branch", "--no-color"]).then(function (stdout) {
            var branchName = _.find(stdout.split("\n"), function (l) { return l[0] === "*"; });
            if (branchName) {
                branchName = branchName.substring(1).trim();

                var m = branchName.match(/^\(.*\s(\S+)\)$/); // like (detached from f74acd4)
                if (m) { return m[1]; }

                return branchName;
            }

            // no branch situation so we need to create one by doing a commit
            if (stdout.match(/^\s*$/)) {
                EventEmitter.emit(Events.GIT_NO_BRANCH_EXISTS);
                // master is the default name of the branch after git init
                return "master";
            }

            // alternative
            return git(["log", "--pretty=format:%H %d", "-1"]).then(function (stdout) {
                var m = stdout.trim().match(/^(\S+)\s+\((.*)\)$/);
                var hash = m[1].substring(0, 20);
                m[2].split(",").forEach(function (info) {
                    info = info.trim();

                    if (info === "HEAD") { return; }

                    var m = info.match(/^tag:(.+)$/);
                    if (m) {
                        hash = m[1].trim();
                        return;
                    }

                    hash = info;
                });
                return hash;
            });
        });
    }

    function getCurrentUpstreamBranch() {
        return git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
            .catch(function () {
                return null;
            });
    }

    // Get list of deleted files between two branches
    function getDeletedFiles(oldBranch, newBranch) {
        return git(["diff", "--no-ext-diff", "--name-status", oldBranch + ".." + newBranch])
            .then(function (stdout) {
                var regex = /^D/;
                return stdout.split("\n").reduce(function (arr, row) {
                    if (regex.test(row)) {
                        arr.push(row.substring(1).trim());
                    }
                    return arr;
                }, []);
            });
    }

    function getConfig(key) {
        return git(["config", key.replace(/\s/g, "")]);
    }

    function setConfig(key, value, allowGlobal) {
        key = key.replace(/\s/g, "");
        return git(["config", key, value]).catch(function (err) {

            if (allowGlobal && ErrorHandler.contains(err, "No such file or directory")) {
                return git(["config", "--global", key, value]);
            }

            throw err;

        });
    }

    function getHistory(branch, skipCommits, file) {
        var separator = "_._",
            newline   = "_.nw._",
            format = [
                "%h",  // abbreviated commit hash
                "%H",  // commit hash
                "%an", // author name
                "%aI", // author date, ISO 8601 format
                "%ae", // author email
                "%s",  // subject
                "%b",  // body
                "%d"   // tags
            ].join(separator) + newline;

        var args = ["log", "-100", "--date=iso"];
        if (skipCommits) { args.push("--skip=" + skipCommits); }
        args.push("--format=" + format, branch, "--");

        // follow is too buggy - do not use
        // if (file) { args.push("--follow"); }
        if (file) { args.push(file); }

        return git(args).then(function (stdout) {
            stdout = stdout.substring(0, stdout.length - newline.length);
            return !stdout ? [] : stdout.split(newline).map(function (line) {

                var data = line.trim().split(separator),
                    commit = {};

                commit.hashShort  = data[0];
                commit.hash       = data[1];
                commit.author     = data[2];
                commit.date       = data[3];
                commit.email      = data[4];
                commit.subject    = data[5];
                commit.body       = data[6];

                if (data[7]) {
                    var tags = data[7];
                    var regex = new RegExp("tag: ([^,|\)]+)", "g");
                    tags = tags.match(regex);

                    for (var key in tags) {
                        if (tags[key] && tags[key].replace) {
                            tags[key] = tags[key].replace("tag:", "");
                        }
                    }
                    commit.tags = tags;
                }

                return commit;

            });
        });
    }

    function init() {
        return git(["init"]);
    }

    function clone(remoteGitUrl, destinationFolder, progressTracker) {
        return git(["clone", remoteGitUrl, destinationFolder, "--progress"], {
            progressTracker,
            timeout: false // never timeout this
        });
    }

    function stage(fileOrFiles, updateIndex) {
        var args = ["add"];
        if (updateIndex) { args.push("-u"); }
        return git(args.concat("--", fileOrFiles));
    }

    function stageAll() {
        return git(["add", "--all"]);
    }

    function commit(message, amend, noVerify, progressTracker) {
        var lines = message.split("\n"),
            args = ["commit"];

        if (amend) {
            args.push("--amend", "--reset-author");
        }

        if (noVerify) {
            args.push("--no-verify");
        }

        if (lines.length === 1) {
            args.push("-m", message);
            return git(args, {progressTracker});
        } else {
            return new Promise(function (resolve, reject) {
                // FUTURE: maybe use git commit --file=-
                var fileEntry = FileSystem.getFileForPath(Preferences.get("currentGitRoot") + ".phoenixGitTemp");
                jsPromise(FileUtils.writeText(fileEntry, message))
                    .then(function () {
                        args.push("-F", ".phoenixGitTemp");
                        return git(args, {progressTracker});
                    })
                    .then(function (res) {
                        fileEntry.unlink(function () {
                            resolve(res);
                        });
                    })
                    .catch(function (err) {
                        fileEntry.unlink(function () {
                            reject(err);
                        });
                    });
            });
        }
    }

    function reset(type, hash) {
        var args = ["reset", type || "--mixed"]; // mixed is the default action
        if (hash) { args.push(hash, "--"); }
        return git(args);
    }

    function unstage(file) {
        return git(["reset", "--", file]);
    }

    function checkout(hash) {
        return git(["checkout", hash], {
            timeout: false // never timeout this
        });
    }

    function createBranch(branchName, originBranch, trackOrigin) {
        var args = ["checkout", "-b", branchName];

        if (originBranch) {
            if (trackOrigin) {
                args.push("--track");
            }
            args.push(originBranch);
        }

        return git(args);
    }

    function _isquoted(str) {
        return str[0] === "\"" && str[str.length - 1] === "\"";
    }

    function _unquote(str) {
        return str.substring(1, str.length - 1);
    }

    function _isescaped(str) {
        return /\\[0-9]{3}/.test(str);
    }

    function status(type) {
        return git(["status", "-u", "--porcelain"]).then(function (stdout) {
            if (!stdout) { return []; }

            var currentSubFolder = Preferences.get("currentGitSubfolder");

            // files that are modified both in index and working tree should be resetted
            var isEscaped = false,
                needReset = [],
                results = [],
                lines = stdout.split("\n");

            lines.forEach(function (line) {
                var statusStaged = line.substring(0, 1),
                    statusUnstaged = line.substring(1, 2),
                    status = [],
                    file = line.substring(3);

                // check if the file is quoted
                if (_isquoted(file)) {
                    file = _unquote(file);
                    if (_isescaped(file)) {
                        isEscaped = true;
                    }
                }

                if (statusStaged !== " " && statusUnstaged !== " " &&
                    statusStaged !== "?" && statusUnstaged !== "?") {
                    needReset.push(file);
                    return;
                }

                var statusChar;
                if (statusStaged !== " " && statusStaged !== "?") {
                    status.push(FILE_STATUS.STAGED);
                    statusChar = statusStaged;
                } else {
                    statusChar = statusUnstaged;
                }

                switch (statusChar) {
                    case " ":
                        status.push(FILE_STATUS.UNMODIFIED);
                        break;
                    case "!":
                        status.push(FILE_STATUS.IGNORED);
                        break;
                    case "?":
                        status.push(FILE_STATUS.UNTRACKED);
                        break;
                    case "M":
                        status.push(FILE_STATUS.MODIFIED);
                        break;
                    case "A":
                        status.push(FILE_STATUS.ADDED);
                        break;
                    case "D":
                        status.push(FILE_STATUS.DELETED);
                        break;
                    case "R":
                        status.push(FILE_STATUS.RENAMED);
                        break;
                    case "C":
                        status.push(FILE_STATUS.COPIED);
                        break;
                    case "U":
                        status.push(FILE_STATUS.UNMERGED);
                        break;
                    default:
                        throw new Error("Unexpected status: " + statusChar);
                }

                var display = file,
                    io = file.indexOf("->");
                if (io !== -1) {
                    file = file.substring(io + 2).trim();
                }

                // we don't want to display paths that lead to this file outside the project
                if (currentSubFolder && display.indexOf(currentSubFolder) === 0) {
                    display = display.substring(currentSubFolder.length);
                }

                results.push({
                    status: status,
                    display: display,
                    file: file,
                    name: file.substring(file.lastIndexOf("/") + 1)
                });
            });

            if (isEscaped) {
                return setConfig("core.quotepath", "false").then(function () {
                    if (type === "SET_QUOTEPATH") {
                        throw new Error("git status is calling itself in a recursive loop!");
                    }
                    return status("SET_QUOTEPATH");
                });
            }

            if (needReset.length > 0) {
                return Promise.all(needReset.map(function (fileName) {
                    if (fileName.indexOf("->") !== -1) {
                        fileName = fileName.split("->")[1].trim();
                    }
                    return unstage(fileName);
                })).then(function () {
                    if (type === "RECURSIVE_CALL") {
                        throw new Error("git status is calling itself in a recursive loop!");
                    }
                    return status("RECURSIVE_CALL");
                });
            }

            return results.sort(function (a, b) {
                if (a.file < b.file) {
                    return -1;
                }
                if (a.file > b.file) {
                    return 1;
                }
                return 0;
            });
        }).then(function (results) {
            lastGitStatusResults = results;
            EventEmitter.emit(Events.GIT_STATUS_RESULTS, results);
            return results;
        });
    }

    function hasStatusChanged() {
        const prevStatus = lastGitStatusResults;
        return status().then(function (currentStatus) {
            // the results are already sorted by file name
            // Compare the current statuses with the previous ones
            if (!prevStatus || prevStatus.length !== currentStatus.length) {
                return true;
            }
            for (let i = 0; i < prevStatus.length; i++) {
                if (prevStatus[i].file !== currentStatus[i].file ||
                    prevStatus[i].status.join(", ") !== currentStatus[i].status.join(", ")) {
                    return true;
                }
            }

            return false;
        }).catch(function (error) {
            console.error("Error fetching Git status in hasStatusChanged:", error);
            return false;
        });
    }

    function _isFileStaged(file) {
        return git(["status", "-u", "--porcelain", "--", file]).then(function (stdout) {
            if (!stdout) { return false; }
            return _.any(stdout.split("\n"), function (line) {
                return line[0] !== " " && line[0] !== "?" && // first character marks staged status
                    line.lastIndexOf(" " + file) === line.length - file.length - 1; // in case another file appeared here?
            });
        });
    }

    function getDiffOfStagedFiles() {
        return git(["diff", "--no-ext-diff", "--no-color", "--staged"], {
            timeout: false // never timeout this
        });
    }

    function getDiffOfAllIndexFiles(files) {
        var args = ["diff", "--no-ext-diff", "--no-color", "--full-index"];
        if (files) {
            args = args.concat("--", files);
        }
        return git(args, {
            timeout: false // never timeout this
        });
    }

    function getListOfStagedFiles() {
        return git(["diff", "--no-ext-diff", "--no-color", "--staged", "--name-only"], {
            timeout: false // never timeout this
        });
    }

    function diffFile(file) {
        return _isFileStaged(file).then(function (staged) {
            var args = ["diff", "--no-ext-diff", "--no-color"];
            if (staged) { args.push("--staged"); }
            args.push("-U0", "--", file);
            return git(args, {
                timeout: false // never timeout this
            });
        });
    }

    function diffFileNice(file) {
        return _isFileStaged(file).then(function (staged) {
            var args = ["diff", "--no-ext-diff", "--no-color"];
            if (staged) { args.push("--staged"); }
            args.push("--", file);
            return git(args, {
                timeout: false // never timeout this
            });
        });
    }

    function difftool(file) {
        return _isFileStaged(file).then(function (staged) {
            var args = ["difftool"];
            if (staged) {
                args.push("--staged");
            }
            args.push("--", file);
            return git(args, {
                timeout: false, // never timeout this
                nonblocking: true // allow running other commands before this command finishes its work
            });
        });
    }

    function clean() {
        return git(["clean", "-f", "-d"]);
    }

    function getFilesFromCommit(hash, isInitial) {
        var args = ["diff", "--no-ext-diff", "--name-only"];
        args = args.concat((isInitial ? EMPTY_TREE : hash + "^") + ".." + hash);
        args = args.concat("--");
        return git(args).then(function (stdout) {
            return !stdout ? [] : stdout.split("\n");
        });
    }

    function getDiffOfFileFromCommit(hash, file, isInitial) {
        var args = ["diff", "--no-ext-diff", "--no-color"];
        args = args.concat((isInitial ? EMPTY_TREE : hash + "^") + ".." + hash);
        args = args.concat("--", file);
        return git(args);
    }

    function difftoolFromHash(hash, file, isInitial) {
        return git(["difftool", (isInitial ? EMPTY_TREE : hash + "^") + ".." + hash, "--", file], {
            timeout: false // never timeout this
        });
    }

    function rebaseInit(branchName) {
        return git(["rebase", "--ignore-date", branchName]);
    }

    function rebase(whatToDo) {
        return git(["rebase", "--" + whatToDo]);
    }

    function getVersion() {
        return git(["--version"]).then(function (stdout) {
            var m = stdout.match(/[0-9].*/);
            return m ? m[0] : stdout.trim();
        });
    }

    function getCommitCountsFallback() {
        return git(["rev-list", "HEAD", "--not", "--remotes"])
            .then(function (stdout) {
                var ahead = stdout ? stdout.split("\n").length : 0;
                return "-1 " + ahead;
            })
            .catch(function (err) {
                ErrorHandler.logError(err);
                return "-1 -1";
            });
    }

    function getCommitCounts() {
        var remotes = Preferences.get("defaultRemotes") || {};
        var remote = remotes[Preferences.get("currentGitRoot")];
        return getCurrentBranchName()
            .then(function (branch) {
                if (!branch || !remote) {
                    return getCommitCountsFallback();
                }
                return git(["rev-list", "--left-right", "--count", remote + "/" + branch + "...@{0}", "--"])
                    .catch(function (err) {
                        ErrorHandler.logError(err);
                        return getCommitCountsFallback();
                    })
                    .then(function (stdout) {
                        var matches = /(-?\d+)\s+(-?\d+)/.exec(stdout);
                        return matches ? {
                            behind: parseInt(matches[1], 10),
                            ahead: parseInt(matches[2], 10)
                        } : {
                            behind: -1,
                            ahead: -1
                        };
                    });
            });
    }

    function getLastCommitMessage() {
        return git(["log", "-1", "--pretty=%B"]).then(function (stdout) {
            return stdout.trim();
        });
    }

    function getBlame(file, from, to) {
        var args = ["blame", "-w", "--line-porcelain"];
        if (from || to) { args.push("-L" + from + "," + to); }
        args.push(file);

        return git(args).then(function (stdout) {
            if (!stdout) { return []; }

            var sep  = "-@-BREAK-HERE-@-",
                sep2 = "$$#-#$BREAK$$-$#";
            stdout = stdout.replace(sep, sep2)
                .replace(/^\t(.*)$/gm, function (a, b) { return b + sep; });

            return stdout.split(sep).reduce(function (arr, lineInfo) {
                lineInfo = lineInfo.replace(sep2, sep).trimLeft();
                if (!lineInfo) { return arr; }

                var obj = {},
                    lines = lineInfo.split("\n"),
                    firstLine = _.first(lines).split(" ");

                obj.hash = firstLine[0];
                obj.num = firstLine[2];
                obj.content = _.last(lines);

                // process all but first and last lines
                for (var i = 1, l = lines.length - 1; i < l; i++) {
                    var line = lines[i],
                        io = line.indexOf(" "),
                        key = line.substring(0, io),
                        val = line.substring(io + 1);
                    obj[key] = val;
                }

                arr.push(obj);
                return arr;
            }, []);
        }).catch(function (stderr) {
            var m = stderr.match(/no such path (\S+)/);
            if (m) {
                throw new Error("File is not tracked by Git: " + m[1]);
            }
            throw stderr;
        });
    }

    function getGitRoot() {
        var projectRoot = Utils.getProjectRoot();
        return git(["rev-parse", "--show-toplevel"], {
            cwd: fs.getTauriPlatformPath(projectRoot)
        })
            .catch(function (e) {
                if (ErrorHandler.contains(e, "Not a git repository")) {
                    return null;
                }
                throw e;
            })
            .then(function (root) {
                if (root === null) {
                    return root;
                }

                // paths on cygwin look a bit different
                // root = fixCygwinPath(root);

                // we know projectRoot is in a Git repo now
                // because --show-toplevel didn't return Not a git repository
                // we need to find closest .git

                function checkPathRecursive(path) {

                    if (strEndsWith(path, "/")) {
                        path = path.slice(0, -1);
                    }

                    Utils.consoleDebug("Checking path for .git: " + path);

                    return new Promise(function (resolve) {

                        // keep .git away from file tree for now
                        // this branch of code will not run for intel xdk
                        if (typeof brackets !== "undefined" && brackets.fs && brackets.fs.stat) {
                            brackets.fs.stat(path + "/.git", function (err, result) {
                                var exists = err ? false : (result.isFile() || result.isDirectory());
                                if (exists) {
                                    Utils.consoleDebug("Found .git in path: " + path);
                                    resolve(path);
                                } else {
                                    Utils.consoleDebug("Failed to find .git in path: " + path);
                                    path = path.split("/");
                                    path.pop();
                                    path = path.join("/");
                                    resolve(checkPathRecursive(path));
                                }
                            });
                            return;
                        }

                        FileSystem.resolve(path + "/.git", function (err, item, stat) {
                            var exists = err ? false : (stat.isFile || stat.isDirectory);
                            if (exists) {
                                Utils.consoleDebug("Found .git in path: " + path);
                                resolve(path);
                            } else {
                                Utils.consoleDebug("Failed to find .git in path: " + path);
                                path = path.split("/");
                                path.pop();
                                path = path.join("/");
                                resolve(checkPathRecursive(path));
                            }
                        });

                    });

                }

                return checkPathRecursive(projectRoot).then(function (path) {
                    return path + "/";
                });

            });
    }

    function setTagName(tagname, commitHash) {
        const args = ["tag", tagname];
        if (commitHash) {
            args.push(commitHash); // Add the commit hash to the arguments if provided
        }
        return git(args).then(function (stdout) {
            return stdout.trim();
        });
    }

    // Public API
    exports._git                      = git;
    exports.setGitPath                = setGitPath;
    exports.FILE_STATUS               = FILE_STATUS;
    exports.fetchRemote               = fetchRemote;
    exports.fetchAllRemotes           = fetchAllRemotes;
    exports.getRemotes                = getRemotes;
    exports.createRemote              = createRemote;
    exports.deleteRemote              = deleteRemote;
    exports.push                      = push;
    exports.setUpstreamBranch         = setUpstreamBranch;
    exports.getCurrentBranchName      = getCurrentBranchName;
    exports.getCurrentUpstreamBranch  = getCurrentUpstreamBranch;
    exports.getConfig                 = getConfig;
    exports.setConfig                 = setConfig;
    exports.getBranches               = getBranches;
    exports.getAllBranches            = getAllBranches;
    exports.branchDelete              = branchDelete;
    exports.forceBranchDelete         = forceBranchDelete;
    exports.getDeletedFiles           = getDeletedFiles;
    exports.getHistory                = getHistory;
    exports.init                      = init;
    exports.clone                     = clone;
    exports.stage                     = stage;
    exports.unstage                   = unstage;
    exports.stageAll                  = stageAll;
    exports.commit                    = commit;
    exports.reset                     = reset;
    exports.checkout                  = checkout;
    exports.createBranch              = createBranch;
    exports.status                    = status;
    exports.hasStatusChanged          = hasStatusChanged;
    exports.diffFile                  = diffFile;
    exports.diffFileNice              = diffFileNice;
    exports.difftool                  = difftool;
    exports.clean                     = clean;
    exports.getFilesFromCommit        = getFilesFromCommit;
    exports.getDiffOfFileFromCommit   = getDiffOfFileFromCommit;
    exports.difftoolFromHash          = difftoolFromHash;
    exports.rebase                    = rebase;
    exports.rebaseInit                = rebaseInit;
    exports.mergeRemote               = mergeRemote;
    exports.rebaseRemote              = rebaseRemote;
    exports.resetRemote               = resetRemote;
    exports.getVersion                = getVersion;
    exports.getCommitCounts           = getCommitCounts;
    exports.getLastCommitMessage      = getLastCommitMessage;
    exports.mergeBranch               = mergeBranch;
    exports.getDiffOfAllIndexFiles    = getDiffOfAllIndexFiles;
    exports.getDiffOfStagedFiles      = getDiffOfStagedFiles;
    exports.getListOfStagedFiles      = getListOfStagedFiles;
    exports.getBlame                  = getBlame;
    exports.getGitRoot                = getGitRoot;
    exports.setTagName                = setTagName;
});

define("src/utils/Setup", function (require, exports) {

    // Brackets modules
    const _ = brackets.getModule("thirdparty/lodash"),
        Metrics = brackets.getModule("utils/Metrics");

    // Local modules
    const Cli         = require("src/Cli"),
        Git         = require("src/git/Git"),
        Preferences = require("src/Preferences");

    // Module variables
    let standardGitPathsWin = [
        "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
        "C:\\Program Files\\Git\\cmd\\git.exe"
    ];

    let standardGitPathsNonWin = [
        "/usr/local/git/bin/git",
        "/usr/local/bin/git",
        "/usr/bin/git"
    ];

    let extensionActivated = false;

    // Implementation
    function getGitVersion() {
        return new Promise(function (resolve, reject) {

            // TODO: do this in two steps - first check user config and then check all
            var pathsToLook = [Preferences.get("gitPath"), "git"].concat(brackets.platform === "win" ? standardGitPathsWin : standardGitPathsNonWin);
            pathsToLook = _.unique(_.compact(pathsToLook));

            var results = [],
                errors = [];
            var finish = _.after(pathsToLook.length, function () {

                var searchedPaths = "\n\nSearched paths:\n" + pathsToLook.join("\n");

                if (results.length === 0) {
                    // no git found
                    reject("No Git has been found on this computer" + searchedPaths);
                } else {
                    // at least one git is found
                    var gits = _.sortBy(results, "version").reverse(),
                        latestGit = gits[0],
                        m = latestGit.version.match(/([0-9]+)\.([0-9]+)/),
                        major = parseInt(m[1], 10),
                        minor = parseInt(m[2], 10);

                    if (major === 1 && minor < 8) {
                        return reject("Brackets Git requires Git 1.8 or later - latest version found was " + latestGit.version + searchedPaths);
                    }

                    // prefer the first defined so it doesn't change all the time and confuse people
                    latestGit = _.sortBy(_.filter(gits, function (git) { return git.version === latestGit.version; }), "index")[0];

                    // this will save the settings also
                    Git.setGitPath(latestGit.path);
                    resolve(latestGit.version);
                }

            });

            pathsToLook.forEach(function (path, index) {
                Cli.spawnCommand(path, ["--version"], {
                    cwd: "./"
                }).then(function (stdout) {
                    var m = stdout.match(/^git version\s+(.*)$/);
                    if (m) {
                        results.push({
                            path: path,
                            version: m[1],
                            index: index
                        });
                    }
                }).catch(function (err) {
                    errors.push({
                        path: path,
                        err: err
                    });
                }).finally(function () {
                    finish();
                });
            });

        });
    }

    function isExtensionActivated() {
        return extensionActivated && Preferences.get("enableGit");
    }

    /**
     * Initializes the Git extension by checking for the Git executable and returns true if active.
     *
     * @async
     * @function init
     * @returns {Promise<boolean>}
     *   A promise that resolves to a boolean indicating whether the extension was activated (`true`)
     *   or deactivated (`false`) due to a missing or inaccessible Git executable.
     * });
     */
    function init() {
        return new Promise((resolve) =>{
            if(!Preferences.get("enableGit")){
                resolve(false);
                console.log("Git is disabled in preferences.");
                return;
            }
            getGitVersion().then(function (_version) {
                extensionActivated = true;
                resolve(extensionActivated);
                Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'installed', "yes");
            }).catch(function (err) {
                extensionActivated = false;
                console.warn("Failed to launch Git executable. Deactivating Git extension. Is git installed?", err);
                resolve(extensionActivated);
                Metrics.countEvent(Metrics.EVENT_TYPE.GIT, 'installed', "no");
            });
        });
    }

    // Public API
    exports.init = init;
    exports.isExtensionActivated = isExtensionActivated;
    exports.getGitVersion = getGitVersion;

});
