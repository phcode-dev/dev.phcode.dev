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

/*global path, logger, jsPromise*/

define(function (require, exports, module) {
    const NativeApp = brackets.getModule("utils/NativeApp"),
        FileSystem = brackets.getModule("filesystem/FileSystem"),
        ProjectManager = brackets.getModule("project/ProjectManager"),
        MainViewManager = brackets.getModule("view/MainViewManager"),
        FileSystemError = brackets.getModule("filesystem/FileSystemError"),
        FileUtils = brackets.getModule("file/FileUtils"),
        DocumentManager = brackets.getModule("document/DocumentManager"),
        NotificationUI = brackets.getModule("widgets/NotificationUI"),
        Mustache = brackets.getModule("thirdparty/mustache/mustache"),
        Strings = brackets.getModule("strings"),
        FileViewController  = brackets.getModule("project/FileViewController"),
        recoveryTemplate = require("text!html/recovery-template.html"),
        EventDispatcher = brackets.getModule("utils/EventDispatcher"),
        EventManager = brackets.getModule("utils/EventManager");

    EventDispatcher.makeEventDispatcher(exports);
    EventManager.registerEventHandler("ph-recovery", exports);

    const BACKUP_INTERVAL_MS = 5000;
    const sessionRestoreDir = FileSystem.getDirectoryForPath(
        path.normalize(NativeApp.getApplicationSupportDirectory() + "/sessionRestore"));

    const trackedProjects = {};

    function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            let char = str.charCodeAt(i);
            // eslint-disable-next-line no-bitwise
            hash = ((hash << 5) - hash) + char;
            // eslint-disable-next-line no-bitwise
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash) + "";
    }

    function createDir(dir) {
        return new Promise((resolve, reject)=>{
            dir.create(function (err) {
                if (err && err !== FileSystemError.ALREADY_EXISTS) {
                    console.error("[recovery] Error creating project crash restore folder " + dir.fullPath, err);
                    reject(err);
                }
                resolve();
            });
        });
    }

    function silentlyRemoveFile(path) {
        return new Promise((resolve)=>{
            FileSystem.getFileForPath(path).unlink((err)=>{
                if(err) {
                    console.error(err);
                }
                resolve();
            });
        });
    }

    function silentlyRemoveDirectory(dir) {
        return new Promise((resolve)=>{
            dir.unlink((err)=>{
                if(err) {
                    console.error(err);
                }
                resolve();
            });
        });
    }

    function getProjectRestoreRoot(projectPath) {
        const baseName = path.basename(projectPath),
            restoreRootPath = path.normalize(`${sessionRestoreDir.fullPath}/${baseName}_${simpleHash(projectPath)}`);
        return FileSystem.getDirectoryForPath(restoreRootPath);
    }

    function getRestoreFilePath(projectFilePath, projectRootPath) {
        if(!projectFilePath.startsWith(projectRootPath) || !trackedProjects[projectRootPath]){
            console.error(`[recovery] cannot backed up as ${projectRootPath} is not in project ${projectRootPath}`);
            return null;
        }
        let pathWithinProject = projectFilePath.replace(projectRootPath, "");
        let restoreRoot = trackedProjects[projectRootPath].restoreRoot;
        return path.normalize(`${restoreRoot.fullPath}/${pathWithinProject}`);
    }

    // try not to use this
    function getProjectFilePath(restoreFilePath, projectRootPath) {
        const project = trackedProjects[projectRootPath];
        if(!project || !restoreFilePath.startsWith(project.restoreRoot.fullPath)){
            return null;
        }

        let filePathInProject = restoreFilePath.replace(project.restoreRoot.fullPath, "");
        return path.normalize(`${projectRootPath}/${filePathInProject}`);
    }

    /**
     * the restore folder may have empty folders as files get deleted according to backup algorithm. This fn will
     * ensure that there are no empty folders and restore folder exists
     * @param folder
     * @return {Promise<void>}
     */
    async function ensureFolderIsClean(folder) {
        await createDir(folder);
        await folder.unlinkEmptyDirectoryAsync();
        await createDir(folder);
    }

    async function loadLastBackedUpFileContents(projectRootPath) {
        const project = trackedProjects[projectRootPath];
        if(!project){
            console.error("[recovery] Cannot load backup, no tracking info of project " + projectRootPath);
            return;
        }
        const currentProjectLoadCount = project.projectLoadCount;
        let restoreFolder = project.restoreRoot;
        await ensureFolderIsClean(restoreFolder);
        let allEntries = await FileSystem.getAllDirectoryContents(restoreFolder);
        let backupExists = false;
        for(let entry of allEntries){
            if(entry.isDirectory){
                continue;
            }
            let text = await jsPromise(FileUtils.readAsText(entry));
            let projectFilePath = getProjectFilePath(entry.fullPath, projectRootPath);
            if(currentProjectLoadCount !== project.projectLoadCount){
                // this means that while we were tying to load a project backup, the user switched to another project
                // and then switched back to this project, all before the first backup load was complete. so
                // we just return without doing anything here. This function will be eventually called on projectOpened
                // event handler.
                return;
            }
            project.lastBackedUpFileContents[projectFilePath] = text;
            backupExists = true;
        }
        project.lastBackedupLoadInProgress = false;
        if(backupExists) {
            let notificationHTML = Mustache.render(recoveryTemplate, {
                Strings: Strings,
                PROJECT_TO_RECOVER: projectRootPath
            });
            project.restoreNotification = NotificationUI.createToastFromTemplate( Strings.RECOVER_UNSAVED_FILES_TITLE,
                notificationHTML, {
                    dismissOnClick: false,
                    toastStyle: NotificationUI.NOTIFICATION_STYLES_CSS_CLASS.SUCCESS
                });
        }
    }

    function projectOpened(_event, projectRoot) {
        if(projectRoot.fullPath === '/') {
            console.error("[recovery] Backups will not be done for root folder `/`");
            return;
        }
        if(trackedProjects[projectRoot.fullPath]){
            if(trackedProjects[projectRoot.fullPath].restoreNotification){
                trackedProjects[projectRoot.fullPath].restoreNotification.close();
                trackedProjects[projectRoot.fullPath].restoreNotification = null;
            }
            trackedProjects[projectRoot.fullPath].projectLoadCount++;// we use this to prevent race conditions
            // on frequent project switch before all project backup files are loaded.
            trackedProjects[projectRoot.fullPath].lastBackedUpFileContents = {};
            trackedProjects[projectRoot.fullPath].firstEditHandled = false;
            trackedProjects[projectRoot.fullPath].lastBackedupLoadInProgress = true;
            trackedProjects[projectRoot.fullPath].trackedFileUpdateTimestamps = {};
            trackedProjects[projectRoot.fullPath].trackedFileContents = {};
            trackedProjects[projectRoot.fullPath].changeErrorReported = false;
            loadLastBackedUpFileContents(projectRoot.fullPath).catch(err=>{
                console.error("[recovery] loadLastBackedUpFileContents failed ", err);
            });
            return;
        }
        trackedProjects[projectRoot.fullPath] = {
            projectLoadCount: 0, // we use this to prevent race conditions on frequent project switch before all
            // project backup files are loaded.
            projectRoot: projectRoot,
            restoreRoot: getProjectRestoreRoot(projectRoot.fullPath),
            lastBackedUpFileContents: {},
            firstEditHandled: false, // after a project is loaded, has the first edit by user on any file been handled?
            lastBackedupLoadInProgress: true, // while the backup is loading, we need to prevent write over the existing
            // backup with backup info of the current session
            trackedFileUpdateTimestamps: {},
            trackedFileContents: {},
            restoreNotification: null,
            changeErrorReported: false // we only report change errors once to prevent too many Bugsnag reports
        };
        loadLastBackedUpFileContents(projectRoot.fullPath).catch(err=>{
            console.error("[recovery] loadLastBackedUpFileContents failed ", err);
        });
    }

    async function writeFileIgnoreFailure(filePath, contents) {
        try {
            let parentDir = FileSystem.getDirectoryForPath(path.dirname(filePath));
            await createDir(parentDir);
            let file = FileSystem.getFileForPath(filePath);
            await jsPromise(FileUtils.writeText(file, contents, true));
        } catch (e) {
            console.error(e);
        }
    }

    async function backupChangedDocs(projectRoot) {
        const project = trackedProjects[projectRoot.fullPath];
        let trackedFilePaths =  Object.keys(project.trackedFileContents);
        for(let trackedFilePath of trackedFilePaths){
            const restorePath = getRestoreFilePath(trackedFilePath, projectRoot.fullPath);
            const content = project.trackedFileContents[trackedFilePath];
            await writeFileIgnoreFailure(restorePath, content);
            delete project.trackedFileContents[trackedFilePath];
        }
    }

    async function cleanupUntrackedFiles(docPathsToTrack, projectRoot) {
        const project = trackedProjects[projectRoot.fullPath];
        let allTrackingPaths = Object.keys(project.trackedFileUpdateTimestamps);
        for(let trackedPath of allTrackingPaths){
            if(!docPathsToTrack[trackedPath]){
                const restoreFile = getRestoreFilePath(trackedPath, projectRoot.fullPath);
                await silentlyRemoveFile(restoreFile);
                delete project.trackedFileUpdateTimestamps[trackedPath];
            }
        }
    }

    let backupInProgress = false;

    /**
     * This gets executed every 5 seconds and should be as light-weight as possible. If there are no changes to be
     * backed up, then this function should return as soon as possible without waiting for any async flows.
     * @return {Promise<void>}
     */
    async function changeScanner() {
        let currentProjectRoot = ProjectManager.getProjectRoot();
        const project = trackedProjects[currentProjectRoot.fullPath];
        if(backupInProgress || currentProjectRoot.fullPath === "/" || !project || project.lastBackedupLoadInProgress){
            // trackingProjectRoot can be "/" if debug>open virtual file system menu is clicked. Don't track root fs
            return;
        }
        backupInProgress = true;
        try{
            // do backup
            const openDocs = DocumentManager.getAllOpenDocuments();
            let docPathsToTrack = {}, dirtyDocsExists = false;
            for(let doc of openDocs){
                if(doc && doc.isDirty){
                    dirtyDocsExists = true;
                    docPathsToTrack[doc.file.fullPath] = true;
                    const lastTrackedTimestamp = project.trackedFileUpdateTimestamps[doc.file.fullPath];
                    if(!lastTrackedTimestamp || lastTrackedTimestamp !== doc.lastChangeTimestamp){
                        // Already backed up, only need to consider it again if its contents changed
                        project.trackedFileContents[doc.file.fullPath] = doc.getText();
                        project.trackedFileUpdateTimestamps[doc.file.fullPath] = doc.lastChangeTimestamp;
                    }
                }
            }
            if(!project.firstEditHandled && dirtyDocsExists) {
                // this means that the last backup session has been fully loaded in memory and a new edit has been
                // done by the user. The user may not have yet clicked on the restore backup button. But as the user
                // made an edit, we should delete the project restore folder to start a new backup session. The user
                // can still restore the last backup session from the in memory `project.lastBackedUpFileContents`
                await silentlyRemoveDirectory(project.restoreRoot);
                await createDir(project.restoreRoot);
                await backupChangedDocs(currentProjectRoot);
                project.firstEditHandled = true;
            } else {
                await backupChangedDocs(currentProjectRoot);
                await cleanupUntrackedFiles(docPathsToTrack, currentProjectRoot);
            }
        } catch (e) {
            console.error("[recovery] changeScanner error", e);
            if(!project.changeErrorReported){
                project.changeErrorReported = true;
                // we only report change errors once to prevent too many Bugsnag reports
                logger.reportError(e);
            }
        }
        backupInProgress = false;
    }

    function beforeProjectClosed() {
        let currentProjectRoot = ProjectManager.getProjectRoot();
        const project = trackedProjects[currentProjectRoot.fullPath];
        if(project.restoreNotification) {
            project.restoreNotification.close();
        }
        changeScanner().catch(err=>{
            console.error("[recovery] beforeProjectClosed failed which scanning for changes to backup", err);
        });
    }

    async function ensureOpenEditors(pathList) {
        let allOpenFiles = MainViewManager.getAllOpenFiles();
        let openFilePaths = {};
        for(let file of allOpenFiles){
            openFilePaths[file.fullPath] = true;
        }
        for(let path of pathList) {
            if(!openFilePaths[path]){
                let file = FileSystem.getFileForPath(path);
                await jsPromise(FileViewController.openFileAndAddToWorkingSet(file.fullPath));
            }
        }
    }

    async function restoreBtnClicked(_event, projectToRestore) {
        let currentProjectRoot = ProjectManager.getProjectRoot();
        const project = trackedProjects[currentProjectRoot.fullPath];
        if(!project || projectToRestore !== currentProjectRoot.fullPath){
            console.error(`[recovery] current project ${currentProjectRoot.fullPath} != restore ${projectToRestore}`);
            return;
        }
        let pathsToRestore = Object.keys(project.lastBackedUpFileContents);
        await ensureOpenEditors(pathsToRestore);
        for(let filePath of pathsToRestore){
            if(ProjectManager.isWithinProject(filePath)) {
                console.log("restoring", filePath);
                let document = await jsPromise(DocumentManager.getDocumentForPath(filePath));
                document.setText(project.lastBackedUpFileContents[filePath]);
            } else {
                console.error("[recovery] Skipping restore of non project file: ", filePath);
            }
        }
        if(project.restoreNotification){
            project.restoreNotification.close();
            project.restoreNotification = null;
        }
    }

    function init() {
        if(!window.testEnvironment){
            ProjectManager.on(ProjectManager.EVENT_AFTER_PROJECT_OPEN, projectOpened);
            ProjectManager.on(ProjectManager.EVENT_PROJECT_BEFORE_CLOSE, beforeProjectClosed);
            exports.on("restoreProject", restoreBtnClicked);
            createDir(sessionRestoreDir);
            setInterval(changeScanner, BACKUP_INTERVAL_MS);
        }
    }

    exports.init = init;
});