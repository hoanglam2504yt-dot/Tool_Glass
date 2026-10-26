#target illustrator

(function () {

    // =========================================================================
    // CAU HINH DUONG DAN
    // =========================================================================
    var IMAGE_FOLDER       = "X:/INPUT/GLASS";
    var TEMPLATE_FOLDER    = "L:/Glass/Tool_Glass/template";
    var IMAGE_DONE_FOLDER  = "L:/Glass/Tool_Glass/image_done";
    var IMAGE_ERROR_FOLDER = "L:/Glass/Tool_Glass/image_error";
    var OUTPUT_FOLDER      = "X:/OUTPUT/STO/GLASS/output_ai";
    var OUTPUT_PNG_FOLDER  = "X:/OUTPUT/STO/GLASS/output_png";

    var MAX_SLOT = 48; // So khung trong template (danh so 1 - 48)
    var OLD_USER_INTERACTION_LEVEL = app.userInteractionLevel;

    try {
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

        // 1. Khoi tao va kiem tra thu muc (to chuc theo thangN/D-M-YY)
        var outFolder    = getDatedSubFolder(OUTPUT_FOLDER);
        var outPngFolder = getDatedSubFolder(OUTPUT_PNG_FOLDER);
        var doneFolder   = getDatedSubFolder(IMAGE_DONE_FOLDER);
        var errorFolder  = getDatedSubFolder(IMAGE_ERROR_FOLDER);

        var tmplFolder = new Folder(TEMPLATE_FOLDER);
        if (!tmplFolder.exists) {
            throw new Error("Khong tim thay thu muc template: " + TEMPLATE_FOLDER);
        }

        var imgFolder = new Folder(IMAGE_FOLDER);
        if (!imgFolder.exists) {
            throw new Error("Khong tim thay thu muc anh nguon: " + IMAGE_FOLDER);
        }

        // 2. Lay danh sach file anh cho xu ly (tat ca dinh dang anh)
        var files = imgFolder.getFiles(function (f) {
            if (!(f instanceof File)) return false;
            if (f.hidden) return false;
            return /\.(png|jpg|jpeg|tif|tiff|bmp|psd)$/i.test(cleanFileName(f.name).toLowerCase());
        });

        if (!files || files.length === 0) {
            alert("Khong co anh can xu ly trong folder: " + IMAGE_FOLDER);
            app.userInteractionLevel = OLD_USER_INTERACTION_LEVEL;
            return;
        }

        // 3. Parse ten file va tao danh sach Job
        // File khong co chu "glass" trong ten -> da ve folder error
        var jobs = [];
        for (var f = 0; f < files.length; f++) {
            try {
                var name = cleanFileName(files[f].name).toLowerCase();

                // Kiem tra co chu "glass" trong ten khong
                if (name.indexOf("glass") === -1) {
                    $.writeln("File khong co chu 'glass' trong ten, chuyen sang error: " + files[f].fsName);
                    moveFileToErrorFolder(files[f], errorFolder);
                    continue;
                }

                var info = parseFileName(files[f].name);
                jobs.push({
                    file: files[f],
                    info: info,
                    qty: info.qty,
                    id: info.id
                });
            } catch (errParse) {
                $.writeln("File loi ten/dinh dang: " + files[f].fsName + " | " + getErrorMessage(errParse));
                moveFileToErrorFolder(files[f], errorFolder);
            }
        }

        // Sap xep uu tien theo so luong giam dan, sau do theo ID
        jobs.sort(function (a, b) {
            if (a.qty !== b.qty) return b.qty - a.qty;
            return String(a.id).localeCompare(String(b.id));
        });

        if (jobs.length === 0) {
            app.userInteractionLevel = OLD_USER_INTERACTION_LEVEL;
            return;
        }

        // 4. Bat dau vong lap dien template
        var pendingJobs = jobs.slice();
        var currentSlotIndex = 1;
        var doc = null;
        var currentSheetDoneFiles = [];

        var processedFileCount = 0;
        var placedCopyCount = 0;

        // Mo template trang dau tien
        doc = openTemplate(TEMPLATE_FOLDER);
        if (!doc) {
            throw new Error("Khong tim thay hoac khong mo duoc file template_new.ai trong " + TEMPLATE_FOLDER);
        }

        while (pendingJobs.length > 0) {
            var currentJob = pendingJobs[0];
            var remainQty = currentJob.qty;
            var qtyPlacedThisSheet = 0;

            // Dien cac ban sao cua job hien tai vao template cho den khi het remainQty hoac het slot
            while (remainQty > 0 && currentSlotIndex <= MAX_SLOT) {
                var success = placeImageInSlot(doc, currentSlotIndex, currentJob.file);
                if (success) {
                    placedCopyCount++;
                    qtyPlacedThisSheet++;
                    remainQty--;
                }
                // Tang index de di tiep sang o tiep theo
                currentSlotIndex++;
            }

            if (qtyPlacedThisSheet > 0) {
                queueDoneFileForCurrentSheet(
                    currentSheetDoneFiles,
                    currentJob.file,
                    currentJob.info,
                    qtyPlacedThisSheet,
                    remainQty
                );
            }

            // Cap nhat so luong con lai. Neu het thi chuyen sang job tiep theo.
            if (remainQty <= 0) {
                pendingJobs.shift();
            } else {
                currentJob.qty = remainQty;
            }

            // Xu ly tran trang (Pagination): Neu da dien den slot MAX_SLOT
            if (currentSlotIndex > MAX_SLOT) {
                saveAndCloseCurrentSheet(doc, outFolder, currentSheetDoneFiles, doneFolder, outPngFolder);
                processedFileCount += currentSheetDoneFiles.length;

                // Reset bien trang thai
                currentSheetDoneFiles = [];
                currentSlotIndex = 1;

                // Mo template moi cho cac job con lai
                if (pendingJobs.length > 0) {
                    doc = openTemplate(TEMPLATE_FOLDER);
                    if (!doc) throw new Error("Khong mo duoc template moi.");
                }
            }
        }

        // Luu trang cuoi cung neu con dang do (nhung da het job)
        if (currentSlotIndex > 1 && doc) {
            // Xoa cac slot chua duoc dien anh truoc khi luu
            removeUnusedSlots(doc, currentSlotIndex, MAX_SLOT);
            saveAndCloseCurrentSheet(doc, outFolder, currentSheetDoneFiles, doneFolder, outPngFolder);
            processedFileCount += currentSheetDoneFiles.length;
        }

        app.userInteractionLevel = OLD_USER_INTERACTION_LEVEL;
        alert("Hoan tat! Da xep thanh cong " + placedCopyCount + " artwork Glass.");

    } catch (e) {
        try { app.userInteractionLevel = OLD_USER_INTERACTION_LEVEL; } catch (restoreErr) { }
        alert("Da xay ra loi: " + getErrorMessage(e));
    }

    // =========================================================================
    // CAC HAM XU LY CHEN ANH VAO LAYER FRONT
    // =========================================================================

    function openTemplate(templateFolder) {
        var tmplFile = new File(templateFolder + "/template_new.ai");
        if (tmplFile.exists) {
            return app.open(tmplFile);
        }
        return null;
    }

    /**
     * Chen anh vao slot slotIndex trong layer "front".
     * - 2 nhanh xu ly: PlacedItem (thay link) va PathItem/GroupItem (add moi).
     * - Unlock va show layer truoc khi thao tac.
     * - Giu nguyen kich thuoc anh goc, can giua vao tam placeholder.
     * - Embed anh, xoa placeholder sau khi chen thanh cong.
     */
    function placeImageInSlot(doc, slotIndex, fileToPlace) {
        if (!fileToPlace) return false;

        var layer = getLayerByName(doc, "front");
        if (!layer) {
            $.writeln("Khong tim thay layer 'front' trong document.");
            return false;
        }

        layer.visible = true;
        layer.locked  = false;

        var slotName   = String(slotIndex);
        var targetItem = findSlotInContainer(layer, slotName);
        if (!targetItem) {
            $.writeln("Khong tim thay slot '" + slotName + "' trong layer 'front'.");
            return false;
        }

        // Kich thuoc co dinh: 3.2 inch = 3.2 * 72 = 230.4 pt
        var TARGET_SIZE_PT = 3.2 * 72; // = 230.4 pt

        try {
            var centerX = 0, centerY = 0;
            var canCenter = false;
            var newPlaced = null;

            if (targetItem.typename === "PlacedItem") {
                // Nhanh PlacedItem: thay the file link truc tiep
                try {
                    var bounds = targetItem.geometricBounds;
                    centerX = (bounds[0] + bounds[2]) / 2;
                    centerY = (bounds[1] + bounds[3]) / 2;
                    canCenter = true;
                } catch (errBounds) {
                    canCenter = false;
                }

                targetItem.file = fileToPlace;
                newPlaced = targetItem;

                // Scale ve kich thuoc co dinh 3.2 inch
                try {
                    var rawB = newPlaced.geometricBounds;
                    var rawW = Math.abs(rawB[2] - rawB[0]);
                    var rawH = Math.abs(rawB[1] - rawB[3]);
                    var rawMax = rawW > rawH ? rawW : rawH;
                    if (rawMax > 0) {
                        var scalePct = (TARGET_SIZE_PT / rawMax) * 100;
                        newPlaced.resize(scalePct, scalePct, true, true, true, true, scalePct);
                    }
                } catch (scaleErr) { }

                // Xoay 90 do
                try { newPlaced.rotate(90); } catch (rotErr) { }

                // Reflect horizontal (lat nguoc chieu ngang)
                try { newPlaced.resize(-100, 100, true, true, true, true, -100); } catch (refErr) { }

                if (canCenter) {
                    var imgBounds = newPlaced.geometricBounds;
                    var imgW = Math.abs(imgBounds[2] - imgBounds[0]);
                    var imgH = Math.abs(imgBounds[1] - imgBounds[3]);
                    newPlaced.position = [centerX - (imgW / 2), centerY + (imgH / 2)];
                }

                try { newPlaced.embed(); } catch (e) { }

            } else {
                // Nhanh PathItem / GroupItem: tao placedItem moi trong layer "front"
                var bounds = targetItem.geometricBounds;
                centerX = (bounds[0] + bounds[2]) / 2;
                centerY = (bounds[1] + bounds[3]) / 2;

                newPlaced = layer.placedItems.add();
                newPlaced.file = fileToPlace;
                newPlaced.name = slotName + "_img";

                // Dat anh ngay truoc placeholder (dung z-order)
                try {
                    newPlaced.move(targetItem, ElementPlacement.PLACEBEFORE);
                } catch (moveErr) { }

                // Scale ve kich thuoc co dinh 3.2 inch
                try {
                    var rawB2 = newPlaced.geometricBounds;
                    var rawW2 = Math.abs(rawB2[2] - rawB2[0]);
                    var rawH2 = Math.abs(rawB2[1] - rawB2[3]);
                    var rawMax2 = rawW2 > rawH2 ? rawW2 : rawH2;
                    if (rawMax2 > 0) {
                        var scalePct2 = (TARGET_SIZE_PT / rawMax2) * 100;
                        newPlaced.resize(scalePct2, scalePct2, true, true, true, true, scalePct2);
                    }
                } catch (scaleErr2) { }

                // Xoay 90 do
                try { newPlaced.rotate(90); } catch (rotErr2) { }

                // Reflect horizontal (lat nguoc chieu ngang)
                try { newPlaced.resize(-100, 100, true, true, true, true, -100); } catch (refErr2) { }

                // Can giua vao tam placeholder
                var imgBounds = newPlaced.geometricBounds;
                var imgW = Math.abs(imgBounds[2] - imgBounds[0]);
                var imgH = Math.abs(imgBounds[1] - imgBounds[3]);
                newPlaced.position = [centerX - (imgW / 2), centerY + (imgH / 2)];

                try { newPlaced.embed(); } catch (e) { }

                // Xoa placeholder hinh tron sau khi chen thanh cong
                try { targetItem.remove(); } catch (e) { }
            }

            return true;

        } catch (e) {
            $.writeln("Loi khi chen anh vao layer 'front' slot " + slotName + ": " + e.message);
            return false;
        }
    }

    /**
     * Tim phan tu theo ten ben trong 1 Layer hoac GroupItem (tim de quy).
     */
    function findSlotInContainer(container, slotName) {
        try {
            return container.pageItems.getByName(slotName);
        } catch (e) { }

        // Tim de quy trong sublayer
        if (container.layers) {
            for (var i = 0; i < container.layers.length; i++) {
                var foundInSub = findSlotInContainer(container.layers[i], slotName);
                if (foundInSub) return foundInSub;
            }
        }

        // Tim trong groupItems
        if (container.groupItems) {
            for (var g = 0; g < container.groupItems.length; g++) {
                var group = container.groupItems[g];
                if (group.name === slotName) return group;
                try {
                    return group.pageItems.getByName(slotName);
                } catch (errG) { }
            }
        }

        return null;
    }

    /**
     * Xoa 1 slot (placeholder chua duoc dien) trong layer "front".
     */
    function removeSlotInLayer(doc, slotIndex) {
        var layer = getLayerByName(doc, "front");
        if (!layer) return;
        layer.visible = true;
        layer.locked  = false;

        var item = findSlotInContainer(layer, String(slotIndex));
        if (item) {
            try { item.remove(); } catch (e) { }
        }
    }

    /**
     * Xoa toan bo placeholder danh so tu 1 -> maxSlot trong layer "front".
     */
    function removeAllSlots(doc, maxSlot) {
        for (var i = 1; i <= maxSlot; i++) {
            removeSlotInLayer(doc, i);
        }
    }

    /**
     * Xoa placeholder tu startSlot -> maxSlot (cac slot chua duoc dien anh).
     */
    function removeUnusedSlots(doc, startSlot, maxSlot) {
        for (var i = startSlot; i <= maxSlot; i++) {
            removeSlotInLayer(doc, i);
        }
    }

    // =========================================================================
    // LUU FILE VA XUAT PNG
    // =========================================================================

    function saveAndCloseCurrentSheet(doc, outFolder, currentSheetDoneFiles, doneFolder, outPngFolder) {
        // Xoa toan bo placeholder con lai truoc khi luu
        removeAllSlots(doc, MAX_SLOT);

        var baseName = makeTimeFileName();
        var outFile  = uniqueAiFile(outFolder, baseName);

        var opts = new IllustratorSaveOptions();
        opts.compatibility = Compatibility.ILLUSTRATOR17;
        opts.pdfCompatible = true;

        doc.selection = null;
        doc.saveAs(outFile, opts);

        // Xuat PNG tach nen 300 DPI
        try {
            exportPNG(doc, outPngFolder, stripExt(outFile.name) + ".png");
        } catch (pngErr) {
            $.writeln("Loi khi xuat PNG: " + getErrorMessage(pngErr));
        }

        doc.close(SaveOptions.DONOTSAVECHANGES);

        // Xu ly cac file nguon sau khi sheet da duoc luu an toan
        processQueuedDoneFiles(currentSheetDoneFiles, doneFolder);
    }

    /**
     * Xuat PNG tach nen tai 300 DPI, kich thuoc dung theo artboard.
     * Artboard template: 60cm x 70cm -> output: ~7087 x 8268 px.
     */
    function exportPNG(doc, folder, fileName) {
        var destFile   = new File(folder.fsName + "/" + fileName);
        var exportOpts = new ExportOptionsPNG24();
        exportOpts.transparency     = true;
        exportOpts.antiAliasing     = true;
        exportOpts.artBoardClipping = true;

        // 300 DPI: scalePercent = (300/72) x 100 = 416.67%
        var scalePercent = (300 / 72.0) * 100.0;
        exportOpts.horizontalScale = scalePercent;
        exportOpts.verticalScale   = scalePercent;

        doc.exportFile(destFile, ExportType.PNG24, exportOpts);

        try {
            var ab     = doc.artboards[0];
            var abRect = ab.artboardRect;
            var wPt    = Math.abs(abRect[2] - abRect[0]);
            var hPt    = Math.abs(abRect[1] - abRect[3]);
            $.writeln("Xuat PNG: " + fileName +
                      " | Artboard: " + Math.round(wPt) + "pt x " + Math.round(hPt) + "pt" +
                      " | Output: " + Math.round(wPt * 300/72) + "px x " + Math.round(hPt * 300/72) + "px @ 300 DPI");
        } catch (e) { }
    }

    // =========================================================================
    // QUAN LY FILE NGUON (DONE / ERROR)
    // =========================================================================

    function queueDoneFileForCurrentSheet(queueArray, file, info, doneQty, remainQty) {
        var key = file.fsName;
        for (var i = 0; i < queueArray.length; i++) {
            if (queueArray[i].file.fsName === key) {
                queueArray[i].doneQty  += doneQty;
                queueArray[i].remainQty = remainQty;
                return;
            }
        }
        queueArray.push({ file: file, info: info, doneQty: doneQty, remainQty: remainQty });
    }

    function processQueuedDoneFiles(queueArray, doneFolder) {
        for (var i = 0; i < queueArray.length; i++) {
            try {
                moveFileToDoneFolder(queueArray[i], doneFolder);
            } catch (e) {
                $.writeln("Move done that bai: " + getErrorMessage(e));
            }
        }
    }

    function moveFileToDoneFolder(doneItem, doneFolder) {
        var file = doneItem.file;
        if (!file || !file.exists) return;

        var info      = doneItem.info;
        var remainQty = doneItem.remainQty;
        var finalQty  = doneItem.doneQty;

        var ext      = getExt(cleanFileName(file.name));
        var doneName = buildFileNameWithQty(info, finalQty, ext);
        var dest     = uniqueFileInFolder(doneFolder, doneName);

        var copied = file.copy(dest);
        if (remainQty > 0 && copied) {
            renameFileQty(file, info, remainQty);
        } else if (copied) {
            file.remove();
        }
    }

    function renameFileQty(file, info, remainQty) {
        try {
            var ext     = getExt(cleanFileName(file.name));
            var newName = buildFileNameWithQty(info, remainQty, ext);
            var target  = new File(file.parent.fsName + "/" + newName);
            var n = 2;
            while (target.exists) {
                newName = buildFileNameWithQty(info, remainQty, ext, n);
                target  = new File(file.parent.fsName + "/" + newName);
                n++;
            }
            file.rename(newName);
        } catch (e) { }
    }

    function moveFileToErrorFolder(file, errorFolder) {
        try {
            if (!file.exists) return;
            var dest = uniqueFileInFolder(errorFolder, cleanFileName(file.name));
            if (file.copy(dest)) file.remove();
        } catch (e) { }
    }

    // =========================================================================
    // HAM TIEN ICH (UTILITIES)
    // =========================================================================

    function buildFileNameWithQty(info, qty, ext, suffix) {
        var name = info.id + " - " + info.sizeText + " - " + qty + " - " + info.stt;
        if (suffix && suffix > 1) name += " (" + suffix + ")";
        return name + ext;
    }

    /**
     * Parse ten file theo dinh dang:
     *   FBM_70176_item1_1-side-printed-glass-ornament-3in-glor_qty_4.png
     * - id       : phan truoc "_qty_" (vd: FBM_70176_item1_1-side-printed-glass-ornament-3in-glor)
     * - qty      : so sau "_qty_" (vd: 4)
     * - sizeText : phan con lai (de trong neu khong co)
     * - stt      : chuoi rong (khong dung den trong format moi)
     */
    function parseFileName(fileName) {
        var cleanName = cleanFileName(fileName);
        var base      = stripExt(cleanName);

        // Tach theo "_qty_" (case-insensitive)
        var qtyMatch = base.match(/^(.+)_qty_([0-9]+)$/i);

        var id, qty, sizeText, stt;

        if (qtyMatch) {
            id       = trim(qtyMatch[1]); // phan truoc _qty_
            qty      = parseInt(qtyMatch[2], 10);
            sizeText = "";
            stt      = "";
        } else {
            // Fallback: format cu "id-size-qty-stt"
            var parts = base.split("-");
            for (var i = 0; i < parts.length; i++) parts[i] = trim(parts[i]);
            id       = parts.length > 0 ? parts[0] : base;
            sizeText = parts.length > 1 ? parts[1] : "";
            qty      = parseInt(parts.length > 2 ? parts[2] : "1", 10);
            stt      = parts.length > 3 ? parts[3] : "";
        }

        if (isNaN(qty) || qty < 1) qty = 1;

        return { id: id, sizeText: sizeText, qty: qty, stt: stt, base: base };
    }

    /**
     * Tim layer theo ten - tim DE QUY qua toan bo cay sublayer.
     * Ho tro ca template 1 layer ("front" top-level) va nhieu layer long nhau.
     */
    function getLayerByName(doc, name) {
        function searchIn(layerCollection) {
            for (var i = 0; i < layerCollection.length; i++) {
                var lyr = layerCollection[i];
                if (lyr.name === name) return lyr;
                try {
                    var found = searchIn(lyr.layers);
                    if (found) return found;
                } catch (e) { }
            }
            return null;
        }
        return searchIn(doc.layers);
    }

    function makeTimeFileName() {
        var d = new Date();
        return (d.getMonth() + 1) + "_" + d.getDate() + "_" +
               pad2(d.getHours()) + "_" + pad2(d.getMinutes()) + "_" + pad2(d.getSeconds());
    }

    function getDatedSubFolder(basePath) {
        var d     = new Date();
        var month = d.getMonth() + 1;
        var day   = d.getDate();
        var year  = String(d.getFullYear()).slice(-2);

        var base = new Folder(basePath);
        if (!base.exists) base.create();

        var monthFolder = new Folder(base.fsName + "/thang" + month);
        if (!monthFolder.exists) monthFolder.create();

        var dayStr    = day + "-" + month + "-" + year;
        var dayFolder = new Folder(monthFolder.fsName + "/" + dayStr);
        if (!dayFolder.exists) dayFolder.create();

        return dayFolder;
    }

    function pad2(n) { return n < 10 ? "0" + n : String(n); }

    function cleanFileName(name) {
        var s = String(name);
        try { s = decodeURI(s); } catch (e) { }
        s = s.replace(/%20/g, " ");
        return s;
    }

    function stripExt(name) {
        return String(name).replace(/\.(png|jpg|jpeg|tif|tiff|bmp|psd|ai)(\.(png|jpg|jpeg|tif|tiff|bmp|psd|ai))*$/i, "");
    }

    function getExt(name) {
        var m = String(name).match(/(\.[^\.]+)$/);
        return m ? m[1] : "";
    }

    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
    function getErrorMessage(e) { return e && e.message ? e.message : String(e); }

    function uniqueAiFile(folder, baseName) {
        var f = new File(folder.fsName + "/" + baseName + ".ai");
        var n = 2;
        while (f.exists) {
            f = new File(folder.fsName + "/" + baseName + " (" + n + ").ai");
            n++;
        }
        return f;
    }

    function uniqueFileInFolder(folder, fileName) {
        var base = stripExt(fileName);
        var ext  = getExt(fileName);
        var f    = new File(folder.fsName + "/" + fileName);
        var n = 2;
        while (f.exists) {
            f = new File(folder.fsName + "/" + base + " (" + n + ")" + ext);
            n++;
        }
        return f;
    }

})();
